import { Router } from "express";
import {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  googleAuth,
  forgotPasswordController,
  resetPasswordController,
  verifyLogin2FAController,
  changePasswordController,
  getSessionsController,
  revokeSessionController,
  revokeAllSessionsController,
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
router.use("/otp", otpRoutes);

//Public (unauthenticated) routes
router.post("/register", registerLimiter, register);
router.post("/login", loginLimiter, login);
router.post("/verify-2fa", loginLimiter, verifyLogin2FAController);
router.post("/google", googleAuth);
router.post("/refresh", refreshLimiter, refresh);
router.post("/logout", logout);

router.post("/forgot-password", forgotPasswordLimiter, forgotPasswordController);
router.post("/reset-password", resetPasswordLimiter, resetPasswordController);

//Protected (authenticated) routes
router.post("/logout-all", protect, logoutAll);
router.patch("/change-password", protect, changePasswordController);

// Session management
router.get("/sessions", protect, getSessionsController);
router.delete("/sessions", protect, revokeAllSessionsController);
router.delete("/sessions/:sessionId", protect, revokeSessionController);

export default router;
