import Conversation from "../modules/conversation/conversation.model";
import type { MessageDto } from "../modules/message/message.types";
import { isValidObjectId } from "../utils/objectId";

import { presenceStore } from "./presence.store";
import type { TypedIO } from "./socket.types";

const safeEmit = (fn: () => void, context: string) => {
  try {
    fn();
  } catch (err) {
    console.error(`[socket emit error] ${context}`, err);
  }
};

// Added generic helper to fan out any event to all participants' individual sockets,
// bypassing the room requirement (fixes group events not showing when chat is closed).
export const emitToConversation = async (
  io: TypedIO,
  conversationId: string,
  event: string,
  payload: any,
) => {
  if (!conversationId || !isValidObjectId(conversationId)) return;

  // 1. Emit to the room (for any clients actively viewing this chat)
  safeEmit(() => {
    io.to(conversationId).emit(event as any, payload);
  }, `emitToConversation_room_${event}`);

  // 2. Broadcast to every participant's socket ID directly (fixes stale background state)
  try {
    const conversation = await Conversation.findById(conversationId)
      .select("participants")
      .lean<{ participants: { toString(): string }[] }>();

    if (conversation?.participants) {
      for (const participantId of conversation.participants) {
        const socketIds = presenceStore.getSockets(participantId.toString());
        for (const socketId of socketIds) {
          io.to(socketId).emit(event as any, payload);
        }
      }
    }
  } catch (err) {
    console.error(`[socket emit error] emitToConversation_participants_${event}`, err);
  }
};

// Refactored emitMessage to call the new generic emitToConversation helper
export const emitMessage = async (
  io: TypedIO,
  conversationId: string,
  payload: MessageDto,
) => {
  return emitToConversation(io, conversationId, "receive_message", payload);
};
