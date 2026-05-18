import { Router } from "express";
import { register, login, refresh, logout, logoutAll } from "./auth.controller";
import { protect } from "../../middleware/auth";
import {
  loginLimiter,
  registerLimiter,
  refreshLimiter,
} from "../../middleware/rateLimiter";
import { googleAuth } from "./auth.controller";

const router = Router();

router.post("/register", registerLimiter, register);
router.post("/login", loginLimiter, login);
router.post("/google", googleAuth);
router.post("/refresh", refreshLimiter, refresh);

router.post("/logout", logout);
router.post("/logout-all", protect, logoutAll);

export default router;
