import { Router } from "express";

import { protect } from "../../middleware/auth";

import { fetchIceConfig, fetchCallHistory } from "./call.controller";

const router = Router();

router.get("/ice-config", protect, fetchIceConfig);
router.get("/call-history", protect, fetchCallHistory);

export default router;
