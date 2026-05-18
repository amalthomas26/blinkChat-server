import type { CorsOptions } from "cors";

import { buildRuntimeConfig } from "../../config/env";

const evaluateCorsOrigin = async (
  corsOptions: CorsOptions,
  origin?: string,
): Promise<boolean> => {
  const { origin: originHandler } = corsOptions;

  if (typeof originHandler !== "function") {
    throw new Error("Expected dynamic CORS origin handler");
  }

  return new Promise<boolean>((resolve, reject) => {
    originHandler(origin, (error, allowed) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(Boolean(allowed));
    });
  });
};

describe("Runtime config", () => {
  it("uses safe local defaults in development", async () => {
    const config = buildRuntimeConfig({
      NODE_ENV: "development",
    });

    expect(config.allowedOrigins).toEqual([
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ]);
    expect(config.refreshTokenCookieOptions.sameSite).toBe("lax");
    expect(config.refreshTokenCookieOptions.secure).toBe(false);
    await expect(
      evaluateCorsOrigin(config.corsOptions, "http://localhost:5173"),
    ).resolves.toBe(true);
  });

  it("uses cross-site cookies for secure production origins", async () => {
    const config = buildRuntimeConfig({
      NODE_ENV: "production",
      FRONTEND_ORIGINS:
        "https://app.example.com, https://admin.example.com/",
      COOKIE_DOMAIN: ".example.com",
    });

    expect(config.allowedOrigins).toEqual([
      "https://app.example.com",
      "https://admin.example.com",
    ]);
    expect(config.refreshTokenCookieOptions.sameSite).toBe("none");
    expect(config.refreshTokenCookieOptions.secure).toBe(true);
    expect(config.refreshTokenCookieOptions.domain).toBe(".example.com");
    await expect(
      evaluateCorsOrigin(config.corsOptions, "https://app.example.com"),
    ).resolves.toBe(true);
    await expect(
      evaluateCorsOrigin(config.corsOptions, "https://evil.example.com"),
    ).rejects.toThrow(
      "Origin https://evil.example.com is not allowed by CORS",
    );
  });

  it("fails fast in production when no frontend origin is configured", () => {
    expect(() =>
      buildRuntimeConfig({
        NODE_ENV: "production",
      }),
    ).toThrow(
      "FRONTEND_ORIGIN or FRONTEND_ORIGINS must be configured in production",
    );
  });

  it("keeps localhost cookies same-site even when env is production", () => {
    const config = buildRuntimeConfig({
      NODE_ENV: "production",
      FRONTEND_ORIGIN: "http://localhost:5173",
    });

    expect(config.refreshTokenCookieOptions.sameSite).toBe("lax");
    expect(config.refreshTokenCookieOptions.secure).toBe(false);
  });
});
