import { Request, Response, NextFunction } from "express";
import multer from "multer";

import { runtimeConfig as config } from "../config/env";
import { ApiError } from "../utils/ApiError";

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  void _next;
  let statusCode = 500;
  let message = "Internal Server Error";

if (err instanceof multer.MulterError) {
  const multerMessage =
    err.code === "LIMIT_FILE_SIZE"
      ? `File too large. Maximum size is ${config.upload.maxSizeMb}MB`
      : "Upload error";
   res.status(400).json({ success: false, message: multerMessage });
   return;
}


  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
  } else if (err instanceof Error) {
    message =
      process.env.NODE_ENV === "production" ? "Internal Server Error" : err.message;
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
