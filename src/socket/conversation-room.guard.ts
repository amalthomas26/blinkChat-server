import { getConversationForUser } from "../modules/conversation/conversation.service";
import { ApiError } from "../utils/ApiError";

import {
  AuthenticatedSocket,
  ConversationAccessErrorPayload,
} from "./socket.types";

const toAccessErrorPayload = (
  conversationId: string,
  err: unknown,
): ConversationAccessErrorPayload => {
  if (err instanceof ApiError) {
    if (err.statusCode === 403) {
      return {
        conversationId,
        code: "CONVERSATION_ACCESS_DENIED",
        message: err.message,
      };
    }

    if (err.statusCode === 404) {
      return {
        conversationId,
        code:
          err.message === "Invalid conversationId"
            ? "INVALID_CONVERSATION_ID"
            : "CONVERSATION_NOT_FOUND",
        message: err.message,
      };
    }
  }

  return {
    conversationId,
    code: "CONVERSATION_ACCESS_ERROR",
    message: err instanceof Error ? err.message : "Conversation access failed",
  };
};

export const ensureJoinedConversationRoom = async (
  socket: AuthenticatedSocket,
  conversationId: string,
) => {
  if (socket.rooms.has(conversationId)) {
    return;
  }

  try {
    await getConversationForUser(conversationId, socket.data.userId);
    socket.join(conversationId);
  } catch (err) {
    const payload = toAccessErrorPayload(conversationId, err);
    socket.emit("conversation_access_error", payload);
    throw err;
  }
};
