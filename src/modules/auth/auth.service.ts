import crypto from "crypto";
import mongoose from "mongoose";
import { ApiError } from "../../utils/ApiError";
import { validatePassword } from "../../utils/validatePassword";
import {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
} from "../../utils/token.utils";
import { User } from "../user/user.model";
import RefreshToken from "./refreshToken.model";
import { OAuth2Client } from "google-auth-library";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const REFRESH_TOKEN_DAYS = 7;
const MAX_SESSIONS = 5;

export const registerUser = async (data: {
  name: string;
  email: string;
  password: string;
}) => {
  const { name, email, password } = data;

  if (!name) throw new ApiError(400, "Name is required");
  if (!email) throw new ApiError(400, "Email is required");
  if (!password) throw new ApiError(400, "Password is required");

  if (!validatePassword(password)) {
    throw new ApiError(
      400,
      "Password must be atleast 8 characters, include one uppercase, number, symbol",
    );
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existingUser = await User.findOne({ email: normalizedEmail });

  if (existingUser) {
    if (existingUser.provider !== "local") {
      throw new ApiError(400, "Use Google login");
    }
    throw new ApiError(400, "User already exists");
  }

  const user = await User.create({
    name,
    email: normalizedEmail,
    password,
    provider: "local",
  });

  return {
    id: user._id,
    name: user.name,
    email: user.email,
    avatar: user.avatar || "",
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
) => {
  const { email, password } = data;

  if (!email) throw new ApiError(400, "Email is required");
  if (!password) throw new ApiError(400, "Password is required");

  const normalizedEmail = email.trim().toLowerCase();

  const user = await User.findOne({ email: normalizedEmail }).select(
    "+password",
  );

  if (!user) throw new ApiError(400, "Invalid credentials");

  if (user.provider !== "local") {
    throw new ApiError(400, "Use Google login");
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) throw new ApiError(401, "Invalid credentials");

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

  let payload;
  try {
    const response = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${googleToken}` },
      },
    );

    if (!response.ok) {
      throw new ApiError(400, "Invalid Google token");
    }

    payload = await response.json();
  } catch (error) {
    throw new ApiError(400, "Failed to fetch Google user info");
  }

  if (!payload || !payload.email) {
    throw new ApiError(400, "Invalid Google token");
  }

  const normalizedEmail = payload.email.trim().toLowerCase();

  let user = await User.findOne({ email: normalizedEmail });

  if (user) {
    if (user.provider !== "google") {
      throw new ApiError(
        400,
        "User already exists with local login please sign in with your password.",
      );
    }
  } else {
    user = await User.create({
      name: payload.name || "Google user",
      email: normalizedEmail,
      provider: "google",
      googleId: payload.sub,
      avatar: payload.picture || "",
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
    },
  };
};
