import { Router } from "express";

import { protect } from "../../middleware/auth";
import { searchLimiter } from "../../middleware/rateLimiter";

import {
    getMe,
    getUserById,
    searchUsers,
    updateMe,
    getPresence,
    deleteAvatarController,
    blockUserController,
    unblockUserController,
    getBlockedUsersController,
    deleteAccountController,
    toggle2FAController,
    updateNotificationPrefsController,
    updatePrivacyPrefsController,
} from "./user.controller";

const router = Router();

router.use(protect); // cleaner than per route

router.delete("/me", deleteAccountController);

router.get("/", searchLimiter, searchUsers);
router.get("/me", getMe);
router.patch("/me", updateMe);
router.delete("/me/avatar", deleteAvatarController);

// Settings endpoints
router.patch("/me/2fa", toggle2FAController);
router.patch("/me/notification-prefs", updateNotificationPrefsController);
router.patch("/me/privacy-prefs", updatePrivacyPrefsController);

router.get("/presence", getPresence);
router.get("/blocked", getBlockedUsersController);

router.post("/:id/block", blockUserController);
router.delete("/:id/block", unblockUserController);

// ALWAYS LAST (catch-all param route)
router.get("/:id", getUserById);

export default router;
