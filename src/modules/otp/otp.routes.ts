// server/src/modules/otp/otp.routes.ts

import { Router } from "express";

import { otpSendLimiter, otpVerifyLimiter } from "../../middleware/rateLimiter";

import { sendOtpController, verifyOtpController } from "./otp.controller";

const router = Router();

// No auth required — these are pre-login endpoints
router.post("/send", otpSendLimiter, sendOtpController);
router.post("/verify", otpVerifyLimiter, verifyOtpController);

export default router;


