import { Request, Response } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import {
  registerUser,
  loginUser,
  refreshTokenService,
  logoutUser,
  logoutAllSessions,
} from "./auth.service";
import {
  clearRefreshTokenCookieOptions,
  refreshCookieName,
  refreshTokenCookieOptions,
} from "../../config/env";
import { googleAuthService } from "./auth.service";

type RegisterInput = {
  name: string;
  email: string;
  password: string;
  username?: string;
  verifiedToken: string;
};

type LoginInput = {
  email: string;
  password: string;
};

export const register = asyncHandler(
  async (req: Request<{}, {}, RegisterInput>, res: Response) => {
    const user = await registerUser(req.body);

    return res.status(201).json({
      success: true,
      data: user,
    });
  },
);

export const login = asyncHandler(
  async (req: Request<{}, {}, LoginInput>, res: Response) => {
    const result = await loginUser(req.body, {
      device: req.headers["x-device"] as string,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.cookie(
      refreshCookieName,
      result.refreshToken,
      refreshTokenCookieOptions,
    );

    return res.status(200).json({
      success: true,
      data: {
        accessToken: result.accessToken,
        user: result.user,
      },
    });
  },
);

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[refreshCookieName];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Authentication failed",
    });
  }

  const data = await refreshTokenService(token);

  res.cookie(refreshCookieName, data.refreshToken, refreshTokenCookieOptions);

  return res.status(200).json({
    success: true,
    data: {
      accessToken: data.accessToken,
    },
  });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[refreshCookieName];

  if (token) {
    await logoutUser(token);
  }

  res.clearCookie(refreshCookieName, clearRefreshTokenCookieOptions);

  return res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
});

export const logoutAll = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user.id;

  await logoutAllSessions(userId);

  res.clearCookie(refreshCookieName, clearRefreshTokenCookieOptions);

  return res.status(200).json({
    success: true,
    message: "Logged out from all devices",
  });
});

export const googleAuth = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.body;

  const result = await googleAuthService(token, {
    device: req.headers["x-device"] as string,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  });

  res.cookie(refreshCookieName, result.refreshToken, refreshTokenCookieOptions);

  return res.status(200).json({
    success: true,
    data: {
      accessToken: result.accessToken,
      user: result.user,
    },
  });
});
