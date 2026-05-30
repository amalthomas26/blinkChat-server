import { Request, Response } from "express";

import { asyncHandler } from "../../middleware/asyncHandler";
import { ApiError } from "../../utils/ApiError";

import { uploadFile } from "./upload.service";

export const uploadFileController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.file) throw new ApiError(400, "No file uploaded");

    if (req.file.size === 0) throw new ApiError(400, "uploaded file is empty");

    const userId = req.user!.id;

    const result = await uploadFile(
      req.file.buffer,
      req.file.mimetype,
      "blinkChat",
      userId,
    );

    return res.status(201).json({
      success: true,
      data: result,
    });
  },
);
