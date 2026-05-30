import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

import { ApiError } from "../utils/ApiError";
import { getJwtSecret } from "../utils/token.utils";

import { asyncHandler } from "./asyncHandler";

interface JwtPayload {
  userId: string;
  type?: string;
}

export const protect = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    let token: string | undefined;

    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith("Bearer")) {
      token = authHeader.split(" ")[1];
    }
    if (!token) throw new ApiError(401, "Not authorized, no token");

    let decoded: JwtPayload;

    try {
      decoded = jwt.verify(token, getJwtSecret()) as JwtPayload;
    } catch {
      throw new ApiError(401, "Invalid token");
    }

    // Reject non-access tokens (e.g. OTP proof tokens that share the same
    // signing secret when OTP_PROOF_SECRET is not configured separately).
    if (!decoded.userId || decoded.type !== "access") {
      throw new ApiError(401, "Invalid token");
    }

    req.user = {
      id: decoded.userId,
    };
    next();
  },
);

