import jwt from "jsonwebtoken";

import { ApiError } from "../utils/ApiError";
import { getJwtSecret } from "../utils/token.utils";

import { AuthenticatedSocket } from "./socket.types";

type SocketNext = (err?: Error) => void;

export const verifySocketToken = (
  socket: AuthenticatedSocket,
  next: SocketNext,
) => {
  try {
    const authHeader = socket.handshake.headers?.authorization;

    const token =
      socket.handshake.auth?.token ||
      (authHeader && authHeader.startsWith("Bearer ")
        ? authHeader?.split(" ")[1]
        : undefined);

    if (!token) {
      return next(new ApiError(401, "AUTH_NO_TOKEN"));
    }

    const decoded = jwt.verify(token, getJwtSecret());

    if (
      !decoded ||
      typeof decoded !== "object" ||
      !("userId" in decoded)
    ) {
      return next(new ApiError(400, "AUTH_INVALID_PAYLOAD"));
    }

    socket.data.userId = (decoded as { userId: string }).userId;

    next();
  } catch {
    next(new ApiError(400, "AUTH_INVALID_TOKEN"));
  }
};
