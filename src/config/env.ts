import type { CorsOptions } from "cors";
import type { CookieOptions } from "express";

type SameSite = NonNullable<CookieOptions["sameSite"]>;

const DEV_FRONTEND_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

const normalizeOrigin = (origin: string) => origin.trim().replace(/\/$/, "");

const parseBoolean = (value?: string): boolean | undefined => {
  if (!value) return undefined;

  const normalized = value.trim().toLowerCase();

  if (normalized === "true") return true;
  if (normalized === "false") return false;

  throw new Error(`Invalid boolean value: ${value}`);
};

const parseSameSite = (value?: string): SameSite | undefined => {
  if (!value) return undefined;

  const normalized = value.trim().toLowerCase();

  if (
    normalized === "lax" ||
    normalized === "strict" ||
    normalized === "none"
  ) {
    return normalized;
  }

  throw new Error(`Invalid COOKIE_SAME_SITE value: ${value}`);
};

const parseOrigins = (env: NodeJS.ProcessEnv) => {
  const rawOrigins = [
    env.FRONTEND_ORIGINS,
    env.FRONTEND_ORIGIN,
    env.CLIENT_ORIGIN,
    env.CLIENT_URL,
  ]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.split(","))
    .map(normalizeOrigin)
    .filter((value) => value.length > 0);

  return [...new Set(rawOrigins)];
};

const isSecureOrigin = (origin: string) => origin.startsWith("https://");

const isLocalOrigin = (origin: string) => {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
};

const resolveAllowedOrigins = (env: NodeJS.ProcessEnv, isProduction: boolean) => {
  const configuredOrigins = parseOrigins(env);

  if (configuredOrigins.length > 0) {
    return configuredOrigins;
  }

  if (isProduction) {
    throw new Error(
      "FRONTEND_ORIGIN or FRONTEND_ORIGINS must be configured in production",
    );
  }

  return DEV_FRONTEND_ORIGINS;
};

const resolveSameSite = (env: NodeJS.ProcessEnv, allowedOrigins: string[]) => {
  const configuredSameSite = parseSameSite(env.COOKIE_SAME_SITE);
  if (configuredSameSite) return configuredSameSite;

  const shouldUseCrossSiteCookies =
    allowedOrigins.length > 0 &&
    allowedOrigins.every(
      (origin) => isSecureOrigin(origin) && !isLocalOrigin(origin),
    );

  return shouldUseCrossSiteCookies ? "none" : "lax";
};

const buildCookieBaseOptions = (
  env: NodeJS.ProcessEnv,
  sameSite: SameSite,
): CookieOptions => {
  const configuredSecure = parseBoolean(env.COOKIE_SECURE);
  const secure = configuredSecure ?? sameSite === "none";

  if (sameSite === "none" && !secure) {
    throw new Error("COOKIE_SECURE must be true when COOKIE_SAME_SITE=none");
  }

  const cookieDomain = env.COOKIE_DOMAIN?.trim() || undefined;
  const refreshCookiePath = env.REFRESH_COOKIE_PATH?.trim() || "/";

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: refreshCookiePath,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  };
};

export const buildRuntimeConfig = (env: NodeJS.ProcessEnv) => {
  const isProduction = env.NODE_ENV === "production";
  const allowedOrigins = resolveAllowedOrigins(env, isProduction);
  const sameSite = resolveSameSite(env, allowedOrigins);
  const cookieBaseOptions = buildCookieBaseOptions(env, sameSite);
  const refreshCookieMaxAge = 7 * 24 * 60 * 60 * 1000;

  const corsOptions: CorsOptions = {
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }

      const normalizedOrigin = normalizeOrigin(origin);

      if (allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }

      return callback(
        new Error(`Origin ${normalizedOrigin} is not allowed by CORS`),
      );
    },
    credentials: true,
  };

  return {
    allowedOrigins,
    corsOptions,
    socketCorsOptions: {
      origin: allowedOrigins,
      credentials: true,
    },
    refreshCookieName: "refreshToken",
    refreshTokenCookieOptions: {
      ...cookieBaseOptions,
      maxAge: refreshCookieMaxAge,
    } as CookieOptions,
    clearRefreshTokenCookieOptions: {
      ...cookieBaseOptions,
    } as CookieOptions,
        cloudinary: {
      cloudName: env.CLOUDINARY_CLOUD_NAME!,
      apiKey: env.CLOUDINARY_API_KEY!,
      apiSecret: env.CLOUDINARY_API_SECRET!,
      baseUrl: env.CLOUDINARY_BASE_URL!,
    },
      upload: {
      maxSizeMb: Number(env.MAX_UPLOAD_SIZE_MB ?? 10),
      allowedMimeTypes: (env.ALLOWED_UPLOAD_MIME_TYPES ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    },
  };
};

export const runtimeConfig = buildRuntimeConfig(process.env);
export const corsOptions = runtimeConfig.corsOptions;
export const socketCorsOptions = runtimeConfig.socketCorsOptions;
export const refreshCookieName = runtimeConfig.refreshCookieName;
export const refreshTokenCookieOptions =
  runtimeConfig.refreshTokenCookieOptions;
export const clearRefreshTokenCookieOptions =
  runtimeConfig.clearRefreshTokenCookieOptions;


  //the gatekeeper that decided who can talk to your backend and how authentication
  //cookies behave

//   It acts as a central control layer for:

// CORS (who can access backend)
// Cookies (auth security)
// Environment variables parsing
// Upload + Cloudinary config
