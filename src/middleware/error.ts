import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/ApiError";
import multer from "multer";
import { runtimeConfig as config } from "../config/env";

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  let statusCode = 500;
  let message = "Internal Server Error";

if (err instanceof multer.MulterError) {
  const message =
    err.code === "LIMIT_FILE_SIZE"
      ? `File too large. Maximum size is ${config.upload.maxSizeMb}MB`
      : "Upload error";
   res.status(400).json({ success: false, message });
   return;
}


  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
  } else if (err instanceof Error) {
    message = err.message;
  }

  res.status(statusCode).json({
    success: false,
    message,
    stack:
      process.env.NODE_ENV === "production"
        ? null
        : err instanceof Error
          ? err.stack
          : null,
  });
};
