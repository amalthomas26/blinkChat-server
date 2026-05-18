import { Router } from "express";
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
  getPinnedMessagesController,
  pinConversationController,
  unpinConversationController,
} from "./conversation.controller";
import { validateStartConversation } from "./conversation.validation";
import { protect } from "../../middleware/auth";

const router = Router();

router.use(protect);

// ----------------------
//  Conversation-level actions (specific FIRST)
// ----------------------
router.post("/:id/pin", pinConversationController);
router.delete("/:id/pin", unpinConversationController);

// ----------------------
//  Message pinning (more specific than :id)
// ----------------------
router.post("/:id/pins/:messageId", pinMessageController);
router.delete("/:id/pins/:messageId", unpinMessageController);
router.get("/:id/pins", getPinnedMessagesController);

// ----------------------
//  Group operations
// ----------------------
router.post("/group", createGroupController);
router.patch("/:id/name", renameGroupController);
router.patch("/:id/avatar", updateGroupAvatarController);
router.delete("/:id/avatar", deleteGroupAvatarController);

router.post("/:id/members", addGroupMemberController);
router.delete("/:id/members/me", leaveGroupController);
router.delete("/:id/members", removeGroupMemberController);

// ----------------------
//  Conversation CRUD
// ----------------------
router.get("/", listConversationsController);
router.post("/", validateStartConversation, startConversationController);

//  ALWAYS KEEP THIS LAST
router.get("/:id", getConversationController);

export default router;
