import { Request, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

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
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req: Request): string => {
    return ipKeyGenerator(req.ip || "unknown_ip");
  },
});

export const otpSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req: Request): string => {
    const email =
      typeof req.body?.email === "string" && req.body.email.trim() !== ""
        ? req.body.email.toLowerCase()
        : "anonymous";
    const ip = ipKeyGenerator(req.ip || "unknown_ip");
    return `otp_send_${ip}_${email}`;
  },
})


export const otpVerifyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req: Request): string => {
    return ipKeyGenerator(req.ip || "unknown_ip");
  },
});

export const forgotPasswordLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req: Request): string => {
    const email =
      typeof req.body?.email === "string" && req.body.email.trim() !== ""
        ? req.body.email.toLowerCase()
        : "anonymous";
    const ip = ipKeyGenerator(req.ip || "unknown_ip");
    return `forgot_${ip}_${email}`;
  },
});

export const resetPasswordLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req: Request): string => {
    return ipKeyGenerator(req.ip || "unknown_ip");
  },
});

export const twoFALimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: { success: false, message: "Too many 2FA attempts. Try again later." },
});
