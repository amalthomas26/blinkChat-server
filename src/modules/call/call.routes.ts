import { Router } from "express";
import { fetchIceConfig, fetchCallHistory } from "./call.controller";
import { protect } from "../../middleware/auth";

const router = Router();

router.get("/ice-config", protect, fetchIceConfig);
router.get("/call-history", protect, fetchCallHistory);

export default router;
