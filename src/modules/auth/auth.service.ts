import crypto from "crypto";

import { OAuth2Client } from "google-auth-library";
import mongoose from "mongoose";

import { ApiError } from "../../utils/ApiError";
import {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
} from "../../utils/token.utils";
import { validatePassword } from "../../utils/validatePassword";
import { sendOtp, verifyOtp, validateVerifiedToken } from "../otp/otp.service";
import { User } from "../user/user.model";

import { LoginResult, SessionDto } from "./auth.types";
import RefreshToken from "./refreshToken.model";


const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const REFRESH_TOKEN_DAYS = 7;
const MAX_SESSIONS = 5;

export const registerUser = async (data: {
  name: string;
  email: string;
  password: string;
  username?: string;
  verifiedToken: string
}) => {
  const { name, email, password, username, verifiedToken } = data;

  if (!name) throw new ApiError(400, "Name is required");
  if (!email) throw new ApiError(400, "Email is required");
  if (!password) throw new ApiError(400, "Password is required");
  if (!verifiedToken) throw new ApiError(400, "Email verification is required");

  const normalizedEmail = email.trim().toLowerCase();

  // Validate the OTP proof token — checks JWT signature, purpose, and email match.
  // Without this, any truthy string would bypass the OTP gate entirely.
  validateVerifiedToken(verifiedToken, "email_verification", normalizedEmail);

  if (!validatePassword(password)) {
    throw new ApiError(
      400,
      "Password must be at least 8 characters, include one uppercase, number, symbol",
    );
  }

  const existingUser = await User.findOne({ email: normalizedEmail });

  if (existingUser) {
    if (existingUser.provider !== "local") {
      throw new ApiError(400, "Use Google login");
    }
    throw new ApiError(400, "User already exists");
  }

  if (username) {
    const trimmedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(trimmedUsername)) {
      throw new ApiError(
        400,
        "Username must be 3-30 characters: lowercase letters, numbers, underscores only",
      );
    }
    const usernameExists = await User.findOne({ username: trimmedUsername });
    if (usernameExists) {
      throw new ApiError(409, "Username is already taken");
    }
  }




  const user = await User.create({
    name,
    email: normalizedEmail,
    password,
    username: username?.trim().toLowerCase() || undefined,
    provider: "local",
    isEmailVerified: true,
  });

  return {
    id: user._id,
    name: user.name,
    email: user.email,
    avatar: user.avatar || "",
    isEmailVerified: user.isEmailVerified,
  };
};

export const loginUser = async (
  data: {
    email: string;
    password: string;
  },
  meta: {
    device?: string;
    ip?: string;
    userAgent?: string;
  },
): Promise<LoginResult> => {
  const { email, password } = data;

  if (!email) throw new ApiError(400, "Email is required");
  if (!password) throw new ApiError(400, "Password is required");

  const normalizedEmail = email.trim().toLowerCase();

  const user = await User.findOne({ email: normalizedEmail }).select(
    "+password",
  );

  if (!user) throw new ApiError(400, "Invalid credentials");

  if (user.provider !== "local") {
    throw new ApiError(400, "This account uses Google sign-in. Please click 'Continue with Google' to log in.");
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) throw new ApiError(401, "Invalid credentials");

  // 2FA check 
  // Password is valid. If 2FA is enabled, send OTP instead of
  // issuing tokens. The user must complete the second step via
  // POST /auth/verify-2fa.
  if (user.twoFactorEnabled) {
    await sendOtp(normalizedEmail, "login_2fa");

    return {
      requires2FA: true,
      email: normalizedEmail,
    };
  }
  //

  // No 2FA issue tokens immediately (existing flow)
  const accessToken = generateAccessToken({
    userId: user._id.toString(),
  });

  const sessionId = crypto.randomUUID();

  const rawRefreshToken = generateRefreshToken();
  const hashed = hashToken(rawRefreshToken);

  const activeSessions = await RefreshToken.countDocuments({
    userId: user._id,
    isRevoked: false,
  });

  if (activeSessions >= MAX_SESSIONS) {
    await RefreshToken.findOneAndUpdate(
      { userId: user._id, isRevoked: false },
      { isRevoked: true },
      { sort: { createdAt: 1 } },
    );
  }

  await RefreshToken.create({
    userId: user._id,
    sessionId,
    token: hashed,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 86400000),
    lastUsedAt: new Date(),
    device: meta.device || "unknown",
    ip: meta.ip || "unknown",
    userAgent: meta.userAgent || "unknown",
  });

  return {
    requires2FA: false,
    accessToken,
    refreshToken: rawRefreshToken,
    sessionId,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      avatar: user.avatar || "",
      isEmailVerified: user.isEmailVerified,
    },
  };
};

export const verifyLogin2FA = async (
  data: {
    email: string;
    otp: string;
  },
  meta: {
    device?: string;
    ip?: string;
    userAgent?: string;
  },
) => {
  const { email, otp } = data;
  if (!email) throw new ApiError(400, "Email is required");
  if (!otp) throw new ApiError(400, "OTP code is required");
  const normalizedEmail = email.trim().toLowerCase();
  // Verify the OTP — this throws if invalid/expired/too many attempts
  await verifyOtp(normalizedEmail, otp, "login_2fa");
  // OTP is valid — now find the user and issue tokens
  const user = await User.findOne({ email: normalizedEmail });
  if (!user) throw new ApiError(404, "User not found");
  // Edge case: if 2FA was disabled between the login attempt and OTP
  // verification, we still honor the flow and issue tokens.
  const accessToken = generateAccessToken({
    userId: user._id.toString(),
  });
  const sessionId = crypto.randomUUID();
  const rawRefreshToken = generateRefreshToken();
  const hashed = hashToken(rawRefreshToken);
  // Enforce max sessions
  const activeSessions = await RefreshToken.countDocuments({
    userId: user._id,
    isRevoked: false,
  });
  if (activeSessions >= MAX_SESSIONS) {
    await RefreshToken.findOneAndUpdate(
      { userId: user._id, isRevoked: false },
      { isRevoked: true },
      { sort: { createdAt: 1 } },
    );
  }
  await RefreshToken.create({
    userId: user._id,
    sessionId,
    token: hashed,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 86400000),
    lastUsedAt: new Date(),
    device: meta.device || "unknown",
    ip: meta.ip || "unknown",
    userAgent: meta.userAgent || "unknown",
  });
  return {
    accessToken,
    refreshToken: rawRefreshToken,
    sessionId,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      avatar: user.avatar || "",
      isEmailVerified: user.isEmailVerified,
    },
  };
};


export const refreshTokenService = async (token: string) => {
  if (!token) {
    throw new ApiError(401, "Authentication failed");
  }

  const hashed = hashToken(token);

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const existing = await RefreshToken.findOneAndUpdate(
      {
        token: hashed,
        isRevoked: false,
        expiresAt: { $gt: new Date() },
      },
      { isRevoked: true },
      { new: false, session },
    );

    if (!existing) {
      const reused = await RefreshToken.findOne({ token: hashed });

      if (reused && reused.isRevoked) {
        await RefreshToken.updateMany(
          { sessionId: reused.sessionId },
          { isRevoked: true },
          { session },
        );
      }

      throw new ApiError(401, "Authentication failed");
    }

    const newRaw = generateRefreshToken();
    const newHashed = hashToken(newRaw);

    await RefreshToken.create(
      [
        {
          userId: existing.userId,
          sessionId: existing.sessionId,
          token: newHashed,
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 86400000),
          lastUsedAt: new Date(),
          device: existing.device,
          ip: existing.ip,
          userAgent: existing.userAgent,
        },
      ],
      { session },
    );

    await RefreshToken.updateOne(
      { _id: existing._id },
      { lastUsedAt: new Date() },
      { session },
    );

    const accessToken = generateAccessToken({
      userId: existing.userId.toString(),
    });

    await session.commitTransaction();

    return {
      accessToken,
      refreshToken: newRaw,
    };
  } catch (err) {
    console.error("REFRESH TOKEN ERROR:", err);
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

export const logoutUser = async (token: string) => {
  if (!token) return;

  const hashed = hashToken(token);

  const existing = await RefreshToken.findOne({ token: hashed });

  if (!existing) return;

  await RefreshToken.updateMany(
    { sessionId: existing.sessionId },
    { isRevoked: true },
  );
};

export const logoutAllSessions = async (userId: string) => {
  await RefreshToken.updateMany({ userId }, { isRevoked: true });
};

export const googleAuthService = async (
  googleToken: string,
  meta: { device?: string; ip?: string; userAgent?: string },
) => {
  if (!googleToken) throw new ApiError(400, "Google token is required");

  // Cryptographically verify the ID token using Google's public keys.
  // This also validates the 'aud' claim matches our GOOGLE_CLIENT_ID,
  // preventing tokens issued for other apps from being accepted here.
  let payload: import("google-auth-library").TokenPayload | undefined;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: googleToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    throw new ApiError(400, "Invalid Google token");
  }

  if (!payload || !payload.email) {
    throw new ApiError(400, "Invalid Google token");
  }

  const normalizedEmail = payload.email.trim().toLowerCase();

  let user = await User.findOne({ email: normalizedEmail });

  if (user) {
    if (user.provider === "local") {
      // The user previously registered with email/password but is now signing
      // in with Google (which has already verified this email address).
      // Safely link the Google identity to the existing account.
      user.provider = "google";
      user.googleId = payload.sub;
      // Optionally update avatar from Google if none is set
      if (!user.avatar && payload.picture) {
        user.avatar = payload.picture;
      }
      await user.save();
    }
    // If provider is already "google", fall through normally.
  } else {
    user = await User.create({
      name: payload.name || "Google user",
      email: normalizedEmail,
      provider: "google",
      googleId: payload.sub,
      avatar: payload.picture || "",
      isEmailVerified: true,
    });
  }

  const accessToken = generateAccessToken({
    userId: user._id.toString(),
  });

  const sessionId = crypto.randomUUID();
  const rawRefreshToken = generateRefreshToken();
  const hashed = hashToken(rawRefreshToken);

  const activeSessions = await RefreshToken.countDocuments({
    userId: user._id,
    isRevoked: false,
  });

  if (activeSessions >= MAX_SESSIONS) {
    await RefreshToken.findOneAndUpdate(
      { userId: user._id, isRevoked: false },
      { isRevoked: true },
      { sort: { createdAt: 1 } },
    );
  }

  await RefreshToken.create({
    userId: user._id,
    sessionId,
    token: hashed,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 86400000),
    lastUsedAt: new Date(),
    device: meta.device || "unknown",
    ip: meta.ip || "unknown",
    userAgent: meta.userAgent || "unknown",
  });

  return {
    accessToken,
    refreshToken: rawRefreshToken,
    sessionId,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      avatar: user.avatar || "",
      isEmailVerified: user.isEmailVerified,
    },
  };
};

export const forgotPassword = async (email: string): Promise<void> => {

  if (!email) throw new ApiError(400, "Email is required");


  const normalizedEmail = email.trim().toLowerCase();

  const user = await User.findOne({ email: normalizedEmail }).select(
    "provider",
  );

  if (!user) {
    return;
  }

  if (user.provider !== "local") {
    return;
  }

  await sendOtp(normalizedEmail, "forgot_password");

};


export const resetPassword = async (data: {
  email: string;
  newPassword: string;
  verifiedToken: string;
}): Promise<void> => {
  const { email, newPassword, verifiedToken } = data;

  if (!email) throw new ApiError(400, "Email is required");
  if (!newPassword) throw new ApiError(400, "New password is required");
  if (!verifiedToken)
    throw new ApiError(400, "Verification token is required");

  const normalizedEmail = email.trim().toLowerCase();

  validateVerifiedToken(verifiedToken, "forgot_password", normalizedEmail);

  if (!validatePassword(newPassword))
    throw new ApiError(
      400,
      "Password must be at least 8 characters, include one uppercase, number, symbol",
    );


  const user = await User.findOne({ email: normalizedEmail }).select(
    "+password provider",
  );


  if (!user) throw new ApiError(404, "User not found");

  if (user.provider !== "local")
    throw new ApiError(400, "Use Google login")


  user.password = newPassword;


  user.passwordChangedAt = new Date();


  await user.save();

  await logoutAllSessions(user._id.toString());
};

export const changePassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> => {

  if (!userId) throw new ApiError(400, "User ID is required");
  if (!currentPassword) throw new ApiError(400, "Current password is required");
  if (!newPassword) throw new ApiError(400, "New password is required");

  if (currentPassword === newPassword) {
    throw new ApiError(400, "New Password must be different from current password"
    );
  }

  if (!validatePassword(newPassword)) {
    throw new ApiError(
      400,
      "Password must be at least 8 characters, include one uppercase, number, symbol",
    );
  }


  const user = await User.findById(userId).select("+password provider")

  if (!user) throw new ApiError(404, "User not found");


  if (user.provider !== "local")
    throw new ApiError(400, "Cannot change password for Google login accounts");


  const isMatch = await user.comparePassword(currentPassword);


  if (!isMatch)
    throw new ApiError(401, "Current password is incorrect");


  user.password = newPassword;
  user.passwordChangedAt = new Date();
  await user.save();

  await logoutAllSessions(userId);
}


export const getSessions= async (
  userId: string,
  currentSessionToken?: string,
): Promise<SessionDto[]> => {

  // Find the current session's sessionId so we can mark it
  let currentSessionId: string | null = null;
  if (currentSessionToken) {
    const hashed = hashToken(currentSessionToken);
    const currentDoc = await RefreshToken.findOne({
      token: hashed,
      userId,
    }).select("sessionId");
    currentSessionId = currentDoc?.sessionId ?? null;
  }
  // Aggregate: group by sessionId, take the latest document per group
  const sessions = await RefreshToken.aggregate([
    {
      $match: {
        userId: new (await import("mongoose")).Types.ObjectId(userId),
        isRevoked: false,
        expiresAt: { $gt: new Date() },
      },
    },
    { $sort: { lastUsedAt: -1 } },
    {
      $group: {
        _id: "$sessionId",
        sessionId: { $first: "$sessionId" },
        device: { $first: "$device" },
        ip: { $first: "$ip" },
        userAgent: { $first: "$userAgent" },
        lastUsedAt: { $first: "$lastUsedAt" },
        createdAt: { $first: "$createdAt" },
      },
    },
    { $sort: { lastUsedAt: -1 } },
  ]);
  return sessions.map((s) => ({
    sessionId: s.sessionId,
    device: s.device || "Unknown",
    ip: s.ip || "Unknown",
    userAgent: s.userAgent || "Unknown",
    lastUsedAt: s.lastUsedAt,
    createdAt: s.createdAt,
    isCurrent: s.sessionId === currentSessionId,
  }));

}

export const revokeSession = async (
  userId: string,
  targetSessionId: string,
  currentSessionToken?: string,
): Promise<void> => {
  if (!targetSessionId) throw new ApiError(400, "Session ID is required");
  // Check if trying to revoke current session
  if (currentSessionToken) {
    const hashed = hashToken(currentSessionToken);
    const currentDoc = await RefreshToken.findOne({
      token: hashed,
      userId,
    }).select("sessionId");
    if (currentDoc?.sessionId === targetSessionId) {
      throw new ApiError(400, "Cannot revoke your current session. Use logout instead.");
    }
  }
  // Verify the session belongs to this user
  const session = await RefreshToken.findOne({
    sessionId: targetSessionId,
    userId,
    isRevoked: false,
  });
  if (!session) throw new ApiError(404, "Session not found");
  // Revoke all tokens with this sessionId
  await RefreshToken.updateMany(
    { sessionId: targetSessionId, userId },
    { isRevoked: true },
  );
};
