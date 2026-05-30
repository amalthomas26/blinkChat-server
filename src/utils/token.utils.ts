import crypto from "crypto";

import jwt, { SignOptions } from "jsonwebtoken";

export interface TokenPayload {
  userId: string;
}

export const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not defined");
  }
  return secret;
};

export const getRefreshSecret = (): string => {
  const secret = process.env.REFRESH_TOKEN_SECRET;
  if (!secret) {
    throw new Error("REFRESH_TOKEN_SECRET is not defined");
  }
  return secret;
};

// Separate secret for OTP proof tokens (email verification, password reset, 2FA).
// Set OTP_PROOF_SECRET in your .env for proper secret separation.
// Falls back to JWT_SECRET for backwards compatibility if not configured.
export const getOtpProofSecret = (): string => {
  return process.env.OTP_PROOF_SECRET || getJwtSecret();
};

export const generateAccessToken = (payload: TokenPayload): string => {
  const options: SignOptions = {
    expiresIn:
      (process.env.JWT_EXPIRES_IN as SignOptions["expiresIn"]) || "15m",
    algorithm: "HS256",
  };

  return jwt.sign(
    {
      ...payload,
      type: "access",
    },
    getJwtSecret(), 
    options,
  );
};

export const generateRefreshToken = (): string => {
  return crypto.randomBytes(64).toString("hex");
};

export const hashToken = (token: string): string => {
  return crypto
    .createHash("sha256")
    .update(token + getRefreshSecret()) // ✅ FIX
    .digest("hex");
};