import { Router } from "express";
import { protect } from "../../middleware/auth";
import { getMe ,getUserById,searchUsers,updateMe,
 getPresence,deleteAvatarController,blockUserController
 ,unblockUserController,getBlockedUsersController,deleteAccountController} 
from "./user.controller";
import {searchLimiter} from "../../middleware/rateLimiter";
const router = Router();

router.use(protect); //cleaner than per route

router.delete("/me", deleteAccountController);

router.get("/", searchLimiter, searchUsers);
router.get("/me", getMe);
router.patch("/me", updateMe);
router.delete("/me/avatar", deleteAvatarController);

router.get("/presence", getPresence);
router.get("/blocked", getBlockedUsersController);

router.post("/:id/block", blockUserController);
router.delete("/:id/block", unblockUserController);

// ALWAYS LAST
router.get("/:id", getUserById);


export default router;
