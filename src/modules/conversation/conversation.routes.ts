import { Router } from "express";

import { protect } from "../../middleware/auth";

import {
  listConversationsController,
  startConversationController,
  getConversationController,
  createGroupController,
  renameGroupController,
  addGroupMemberController,
  removeGroupMemberController,
  leaveGroupController,
  updateGroupAvatarController,
  deleteGroupAvatarController,
  pinMessageController,
  unpinMessageController,
  muteConversationController,
  unmuteConversationController,
  promoteToAdminController,
  demoteAdminController,
  getPinnedMessagesController,
  pinConversationController,
  unpinConversationController,
  updateGroupDescriptionController,
  deleteDirectConversationController,
} from "./conversation.controller";
import { validateStartConversation } from "./conversation.validation";

const router = Router();

router.use(protect);

router.post("/:id/pin", pinConversationController);
router.delete("/:id/pin", unpinConversationController);
router.patch("/:id/mute", muteConversationController);
router.delete("/:id/mute", unmuteConversationController);

router.post("/:id/pins/:messageId", pinMessageController);
router.delete("/:id/pins/:messageId", unpinMessageController);
router.get("/:id/pins", getPinnedMessagesController);

router.post("/group", createGroupController);
router.patch("/:id/name", renameGroupController);
router.patch("/:id/avatar", updateGroupAvatarController);
router.delete("/:id/avatar", deleteGroupAvatarController);

router.post("/:id/members", addGroupMemberController);
router.delete("/:id/members/me", leaveGroupController);
router.delete("/:id/members", removeGroupMemberController);
router.patch("/:id/members/:userId/promote", promoteToAdminController);
router.patch("/:id/members/:userId/demote", demoteAdminController);

router.get("/", listConversationsController);
router.post("/", validateStartConversation, startConversationController);

//  ALWAYS KEEP THIS LAST
router.patch("/:id/description", updateGroupDescriptionController);
router.delete("/:id", deleteDirectConversationController);
router.get("/:id", getConversationController);

export default router;
