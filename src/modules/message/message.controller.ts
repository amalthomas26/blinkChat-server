import { Request, Response } from "express";

import { asyncHandler } from "../../middleware/asyncHandler";
import { emitMessage } from "../../socket/socket.emitter";
import { getIO } from "../../socket/socket.server";
import { ApiError } from "../../utils/ApiError";
import { successResponse } from "../../utils/apiResponse";

import {
  sendMessage as sendMessageService,
  fetchMessages,
  deleteMessage,
  reactToMessage,
  removeReaction,
  searchMessages,
  forwardMessage,
} from "./message.service";

export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  const result = await sendMessageService(req.user.id, req.body);

  if (result.wasCreated) {
    emitMessage(getIO(), result.message.conversationId, result.message);
  }

  res.status(201).json({
    success: true,
    data: result.message,
    clientTempId: result.message.clientTempId,
  });
});

export const getMessages = asyncHandler(async (req: Request, res: Response) => {
  if (!req.params.conversationId) {
    throw new ApiError(400, "Conversation ID required");
  }

  const before = req.query.before as string | undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 20;

  const result = await fetchMessages(req.user.id, req.params.conversationId, {
    before,
    limit,
  });

  res.json(
    successResponse(result.messages, {
      hasMore: result.hasNextPage,
    }),
  );
});

export const deleteMessageController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await deleteMessage(id, userId);

    const io = getIO();

    io.to(result.conversationId).emit("message_deleted", result);

    res.status(200).json({ success: true, data: result });
  },
);

export const reactToMessageController = asyncHandler(async (req, res) => {
  const { id: messageId } = req.params;
  const { emoji, conversationId } = req.body as {
    emoji: string;
    conversationId: string;
  };

  const userId = req.user.id;

  await reactToMessage(messageId, userId, emoji);

  getIO().to(conversationId).emit("message_reaction_added", {
    conversationId,
    messageId,
    userId,
    emoji,
  });

  res.status(200).json({ success: true, message: "Reaction added" });
});

export const removeReactionController = asyncHandler(async (req, res) => {
  const { id: messageId } = req.params;
  const { conversationId } = req.body as { conversationId: string };

  const userId = req.user.id;

  await removeReaction(messageId, userId);

  getIO().to(conversationId).emit("message_reaction_removed", {
    conversationId,
    messageId,
    userId,
  });

  res.status(200).json({ success: true, message: "Reaction removed" });
});

export const searchMessagesController = asyncHandler(
  async (req: Request, res: Response) => {
    const { conversationId } = req.params;
    const query = req.query.q as string;
    const before = req.query.before as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 20;

    const result = await searchMessages(req.user.id, conversationId, {
      query,
      before,
      limit,
    });

    res.json(
      successResponse(result.messages, {
        hasMore: result.hasNextPage,
      }),
    );
  },
);

export const forwardMessageController = asyncHandler(
  async (req: Request, res: Response) => {
    const { sourceMessageId, targetConversationId } = req.body as {
      sourceMessageId: string;
      targetConversationId: string;
    };

    const result = await forwardMessage(req.user.id, {
      sourceMessageId,
      targetConversationId,
    });

    emitMessage(getIO(), result.message.conversationId, result.message);

    res.status(201).json({
      success: true,
      data: result.message,
    });
  },
);
