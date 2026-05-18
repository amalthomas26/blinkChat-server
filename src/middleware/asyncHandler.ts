import { Request, Response, NextFunction, RequestHandler } from "express";

type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

export const asyncHandler =
  (fn: AsyncHandler): RequestHandler =>
  (req, res, next) => {
   return Promise.resolve(fn(req, res, next)).catch(next);
  };


  //requesHandler = fucntion that express can use as a middleware/controller