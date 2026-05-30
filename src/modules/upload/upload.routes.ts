import { Router } from "express";

import { protect } from "../../middleware/auth";
import { uploadMiddleware } from "../../middleware/upload.middleware";

import { uploadFileController } from "./upload.controller";

const router = Router();

router.use(protect);

router.post("/", uploadMiddleware.single("file"), uploadFileController);

export default router;
