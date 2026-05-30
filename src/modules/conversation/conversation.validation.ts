import { Request, Response, NextFunction } from "express";

import { isValidObjectId } from "../../utils/objectId";

export const validateStartConversation = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const { receiverId } = req.body as { receiverId: string };

  if (!receiverId) {
    return res.status(400).json({
      success: false,
      error: "receiverId is required",
    });
  }

  if (!isValidObjectId(receiverId)) {
    return res.status(400).json({
      success: false,
      error: "Invalid receiverId",
    });
  }

  next();
};
