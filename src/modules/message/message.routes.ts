import { Router } from "express";

import { protect } from "../../middleware/auth";

import {
  sendMessage,
  getMessages,
  deleteMessageController,
  reactToMessageController,
  removeReactionController,
  searchMessagesController,
  forwardMessageController,
} from ".//message.controller";

const router = Router();

router.use(protect);



router.get("/conversation/:conversationId/search", searchMessagesController);

router.post("/", sendMessage);
router.post("/forward", forwardMessageController);
router.get("/conversation/:conversationId", getMessages);

router.post("/:id/reactions", reactToMessageController);
router.delete("/:id/reactions", removeReactionController);

router.delete("/:id", deleteMessageController);

export default router;
