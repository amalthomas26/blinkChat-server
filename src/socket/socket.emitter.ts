import type { TypedIO } from "./socket.types";
import type { MessageDto } from "../modules/message/message.types";
import { isValidObjectId } from "../utils/objectId";
import Conversation from "../modules/conversation/conversation.model";
import { presenceStore } from "./presence.store";

const safeEmit = (fn: () => void, context: string) => {
  try {
    fn();
  } catch (err) {
    console.error(`[socket emit error] ${context}`, err);
  }
};

export const emitMessage = async (
  io: TypedIO,
  conversationId: string,
  payload: MessageDto,
) => {
  if (!conversationId || !isValidObjectId(conversationId)) return;

  safeEmit(() => {
    io.to(conversationId).emit("receive_message", payload);
  }, "emitMessage_room");

  try {
    const conversation = await Conversation.findById(conversationId)
      .select("participants")
      .lean<{ participants: unknown[] }>();

    if (conversation?.participants) {
      for (const participantId of conversation.participants) {
        const socketIds = presenceStore.getSockets(participantId.toString());
        for (const socketId of socketIds) {
          io.to(socketId).emit("receive_message", payload);
        }
      }
    }
  } catch (err) {
    console.error("[socket emit error] emitMessage_participants", err);
  }
};
