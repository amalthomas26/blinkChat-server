import { Request, Response, NextFunction } from "express";

import { getIceConfig, getCallHistory } from "./call.service";

export const fetchIceConfig = (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const iceConfig = getIceConfig(userId);
    res.json(iceConfig);
  } catch (error) {
    next(error);
  }
};

export const fetchCallHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));

    const result = await getCallHistory(userId, page, limit);
    res.json(result);
  } catch (error) {
    next(error);
  }
};
