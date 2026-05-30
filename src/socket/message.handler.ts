import Conversation from "../modules/conversation/conversation.model";
import { MessageType } from "../modules/message/message.model";
import {
  sendMessage as sendMessageService,
  markMessagesDelivered,
  markConversationAsRead,
  syncMessages,
  deleteMessage,
} from "../modules/message/message.service";
import { ApiError } from "../utils/ApiError";
import { isValidObjectId } from "../utils/objectId";

import { emitMessage } from "./socket.emitter";
import { AuthenticatedSocket, TypedIO } from "./socket.types";
import { SendMessagePayload, MessagePayload } from "./socket.types";




type DeliveryPayload = {
  conversationId: string;
  messageIds: string[];
};

type ReadPayload = {
  conversationId: string;
  lastSeenMessageId: string;
};

type SyncPayload = {
  conversationId: string;
  lastMessageId?: string;
  limit?: number;
};

type ApiResponse<T = unknown> =
  | {
      success: true;
      data: T;
      clientTempId?: string;
      meta?: Record<string, unknown>;
    }
  | { success: false; error: string; clientTempId?: string };

const logError = (context: string, err: unknown) => {
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(`[${context}]`, message, err);
};

export const registerMessageHandlers = (
  io: TypedIO,
  socket: AuthenticatedSocket,
) => {
  const userId = socket.data.userId;

  socket.on(
    "send_message",
    async (
      payload: SendMessagePayload,
      callback?: (res: ApiResponse<MessagePayload>) => void,
    ) => {
      const clientTempId = payload?.clientTempId;

      try {
        const result = await sendMessageService(userId, {
          conversationId: payload?.conversationId ?? "",
          content: payload?.content,
          clientTempId,
          type: payload?.type ?? MessageType.TEXT,
          mediaUrl: payload?.mediaUrl,
          thumbnailUrl: payload?.thumbnailUrl,
          fileName: payload?.fileName,
          fileSize: payload?.fileSize,
          audioDuration: payload?.audioDuration,
          mediaPublicId: payload?.mediaPublicId,
          replyTo:payload?.replyTo,
        });

        if (result.wasCreated) {
          emitMessage(io, result.message.conversationId, result.message);
        }

        return callback?.({
          success: true,
          data: result.message,
          clientTempId: result.message.clientTempId,
        });
      } catch (err) {
        logError("send_message", err);

        return callback?.({
          success: false,
          error: err instanceof Error ? err.message : "SEND_MESSAGE_FAILED",
          clientTempId,
        });
      }
    },
  );
  socket.on("delete_message", async (payload, callback) => {
    const userId = socket.data.userId;

    if (!payload?.messageId || typeof payload.messageId !== "string")
      return callback({ success: false, error: "messageId is required" });

    try {
      const result = await deleteMessage(payload.messageId, userId);

      io.to(result.conversationId).emit("message_deleted", result);

      callback({ success: true, data: result });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        return callback({ success: false, error: err.message });
      }
      console.error("[delete_message]unexpected error", err);
      callback({ success: false, error: "Failed to delete message" });
    }
  });

  socket.on(
    "messages_delivered",
    async (
      data: DeliveryPayload,
      callback?: (
        res: ApiResponse<{ updatedCount: number; messageIds: string[] }>,
      ) => void,
    ) => {
      try {
        const { conversationId, messageIds } = data;

        if (!isValidObjectId(conversationId)) {
          return callback?.({
            success: false,
            error: "INVALID_CONVERSATION_ID",
          });
        }

        if (!Array.isArray(messageIds) || messageIds.length === 0) {
          return callback?.({
            success: false,
            error: "INVALID_MESSAGE_IDS",
          });
        }

        const result = await markMessagesDelivered({
          userId,
          conversationId,
          messageIds,
        });

        const { updatedCount, messageIds: deliveredMessageIds } = result;

        if (updatedCount > 0) {
          io.to(conversationId).emit("messages_delivered_update", {
            conversationId,
            messageIds: deliveredMessageIds,
          });
        }

        return callback?.({
          success: true,
          data: {
            updatedCount,
            messageIds: deliveredMessageIds,
          },
        });
      } catch (err) {
        logError("messages_delivered", err);

        return callback?.({
          success: false,
          error: err instanceof Error ? err.message : "DELIVERY_UPDATE_FAILED",
        });
      }
    },
  );

  socket.on(
    "messages_read",
    async (
      data: ReadPayload,
      callback?: (res: ApiResponse<{ updatedCount: number }>) => void,
    ) => {
      try {
        const { conversationId, lastSeenMessageId } = data;

        if (
          !isValidObjectId(conversationId) ||
          !isValidObjectId(lastSeenMessageId)
        ) {
          return callback?.({
            success: false,
            error: "INVALID_INPUT",
          });
        }

        const result = await markConversationAsRead({
          userId,
          conversationId,
          messageId: lastSeenMessageId,
        });

        const updatedCount = result.updated ? 1 : 0;

        if (updatedCount > 0) {
          const conversation = await Conversation.findById(conversationId)
            .select("isGroup")
            .lean<{ isGroup: boolean }>();

          if (conversation && !conversation.isGroup) {
            io.to(conversationId).emit("messages_read_update", {
              conversationId,
              lastSeenMessageId,
              readerId: userId,
            });
          }
        }

        return callback?.({
          success: true,
          data: { updatedCount },
        });
      } catch (err) {
        logError("messages_read", err);

        return callback?.({
          success: false,
          error: err instanceof Error ? err.message : "READ_UPDATE_FAILED",
        });
      }
    },
  );


  socket.on(
    "sync_messages",
    async (
      data: SyncPayload,
      callback?: (res: ApiResponse<MessagePayload[]>) => void,
    ) => {
      try {
        const { conversationId, lastMessageId, limit = 20 } = data;

        if (!isValidObjectId(conversationId)) {
          return callback?.({
            success: false,
            error: "INVALID_CONVERSATION_ID",
          });
        }

        const safeLimit = Math.min(Math.max(limit, 1), 50);

        const result = await syncMessages(
          userId,
          conversationId,
          lastMessageId,
          safeLimit,
        );

        return callback?.({
          success: true,
          data: result.messages,
          meta: {
            hasMore: result.hasNextPage,
          },
        });
      } catch (err) {
        logError("sync_messages", err);

        return callback?.({
          success: false,
          error: err instanceof Error ? err.message : "SYNC_FAILED",
        });
      }
    },
  );
};
