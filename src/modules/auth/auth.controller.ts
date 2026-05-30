import { Request, Response } from "express";

import {
  clearRefreshTokenCookieOptions,
  refreshCookieName,
  refreshTokenCookieOptions,
} from "../../config/env";
import { asyncHandler } from "../../middleware/asyncHandler";

import {
  registerUser,
  loginUser,
  refreshTokenService,
  logoutUser,
  logoutAllSessions,
  forgotPassword,
  resetPassword,
  verifyLogin2FA,
  changePassword,
  getSessions,
  revokeSession,
} from "./auth.service";
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

export const register = asyncHandler(async (req: Request, res: Response) => {
  const user = await registerUser(req.body as RegisterInput);

  return res.status(201).json({
    success: true,
    data: user,
  });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await loginUser(req.body as LoginInput, {
    device: req.headers["x-device"] as string,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  });

  //2FA required: return early without tokens
  if (result.requires2FA) {
    return res.status(200).json({
      success: true,
      data: {
        requires2FA: true,
        email: result.email,
      },
    });
  }

  // Normal login (no 2FA)
  res.cookie(refreshCookieName, result.refreshToken, refreshTokenCookieOptions);

  return res.status(200).json({
    success: true,
    data: {
      accessToken: result.accessToken,
      user: result.user,
    },
  });
});

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

export const forgotPasswordController = asyncHandler(
  async (req: Request, res: Response) => {
    const { email } = req.body;

    await forgotPassword(email);

    return res.status(200).json({
      success: true,
      message:
        "If an account with that email exists, a verification code has been sent.",
    });
  },
);

export const resetPasswordController = asyncHandler(
  async (req: Request, res: Response) => {
    const { email, newPassword, verifiedToken } = req.body;
    await resetPassword({ email, newPassword, verifiedToken });
    return res.status(200).json({
      success: true,
      message: "Password has been reset successfully. Please log in.",
    });
  },
);

//2FA verification (second step of login)
export const verifyLogin2FAController = asyncHandler(
  async (req: Request, res: Response) => {
    const { email, otp } = req.body;

    const result = await verifyLogin2FA(
      { email, otp },
      {
        device: req.headers["x-device"] as string,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      },
    );

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

//Change password (authenticated)
export const changePasswordController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    await changePassword(userId, currentPassword, newPassword);

    // Clear the refresh token cookie — user must re-login
    res.clearCookie(refreshCookieName, clearRefreshTokenCookieOptions);

    return res.status(200).json({
      success: true,
      message: "Password changed successfully. Please log in again.",
    });
  },
);

// Get active sessions
export const getSessionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user.id;

    // Pass the current refresh token so we can mark "isCurrent"
    const currentToken = req.cookies?.[refreshCookieName];

    const sessions = await getSessions(userId, currentToken);

    return res.status(200).json({
      success: true,
      data: sessions,
    });
  },
);

//Revoke a specific session
export const revokeSessionController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user.id;
    const { sessionId } = req.params;
    const currentToken = req.cookies?.[refreshCookieName];

    await revokeSession(userId, sessionId, currentToken);

    return res.status(200).json({
      success: true,
      message: "Session revoked successfully",
    });
  },
);

//Revoke all other sessions
export const revokeAllSessionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user.id;

    // Get current session's sessionId before revoking
    const currentToken = req.cookies?.[refreshCookieName];
    let currentSessionId: string | null = null;

    if (currentToken) {
      const { hashToken } = await import("../../utils/token.utils");
      const RefreshToken = (await import("./refreshToken.model")).default;
      const hashed = hashToken(currentToken);
      const currentDoc = await RefreshToken.findOne({
        token: hashed,
        userId,
      }).select("sessionId");
      currentSessionId = currentDoc?.sessionId ?? null;
    }

    // Revoke all sessions EXCEPT the current one
    if (currentSessionId) {
      const RefreshToken = (await import("./refreshToken.model")).default;
      await RefreshToken.updateMany(
        { userId, sessionId: { $ne: currentSessionId }, isRevoked: false },
        { isRevoked: true },
      );
    } else {
      // No current session identifiable → revoke everything
      await logoutAllSessions(userId);
    }

    return res.status(200).json({
      success: true,
      message: "All other sessions have been revoked",
    });
  },
);
