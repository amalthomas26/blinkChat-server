import { Router } from "express";
import {
  register, login, refresh, logout, logoutAll,
  googleAuth,
  forgotPasswordController,
  resetPasswordController
} from "./auth.controller";
import { protect } from "../../middleware/auth";
import {
  loginLimiter,
  registerLimiter,
  refreshLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
} from "../../middleware/rateLimiter";

import otpRoutes from "../otp/otp.routes";

const router = Router();


// OTP sub-routes: /api/auth/otp/send, /api/auth/otp/verify
router.use("/otp", otpRoutes)

router.post("/register", registerLimiter, register);
router.post("/login", loginLimiter, login);
router.post("/google", googleAuth);
router.post("/refresh", refreshLimiter, refresh);

router.post("/logout", logout);
router.post("/logout-all", protect, logoutAll);


router.post("/forgot-password", forgotPasswordLimiter, forgotPasswordController);
router.post("/reset-password", resetPasswordLimiter, resetPasswordController);

export default router;
