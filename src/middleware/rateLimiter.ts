import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { Request, Response } from "express";

const rateLimitHandler = (_req: Request, res: Response) => {
  return res.status(429).json({
    success: false,
    message: "Too many requests. Please try again later.",
  });
};

export const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req: Request): string => {
    const email =
      typeof req.body?.email === "string" && req.body.email.trim() !== ""
        ? req.body.email.toLowerCase()
        : "anonymous";

    const ip = ipKeyGenerator(req.ip || "unknown_ip");
    return `${ip}_${email}`;
  },
  skipSuccessfulRequests: true,
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req: Request): string => {
    return ipKeyGenerator(req.ip || "unknown_ip");
  },
});

export const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req: Request): string => {
    return ipKeyGenerator(req.ip || "unknown_ip");
  },
});

export const searchLimiter = rateLimit({
  windowMs:60 * 1000,
  max:30,
  standardHeaders:true,
  legacyHeaders:false,
  handler:rateLimitHandler,
  keyGenerator:(req:Request):string =>{
    return ipKeyGenerator(req.ip || "unknown_ip");
  },
});
