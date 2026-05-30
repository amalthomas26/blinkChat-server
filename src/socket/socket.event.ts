import { isValidObjectId } from "../utils/objectId";

import { ensureJoinedConversationRoom } from "./conversation-room.guard";
import { AuthenticatedSocket, JoinConversationResponse } from "./socket.types";

type JoinCallback = (res: JoinConversationResponse) => void;

export const registerEvents = (socket: AuthenticatedSocket) => {
  socket.on(
    "join_conversation",
    async (conversationId: string, callback?: JoinCallback) => {
      try {
        await ensureJoinedConversationRoom(socket, conversationId);

        return callback?.({ success: true });
      } catch (err) {
        return callback?.({
          success: false,
          error: err instanceof Error ? err.message : "Join failed",
        });
      }
    },
  );

  socket.on(
    "leave_conversation",
    (conversationId: string, callback?: JoinCallback) => {
      if (!conversationId || !isValidObjectId(conversationId)) {
        return callback?.({
          success: false,
          error: "Invalid conversationId",
        });
      }
      socket.leave(conversationId);

      return callback?.({ success: true });
    },
  );
};

//define what events a connected user can perform
//handle room membership (join/leave conversation)
