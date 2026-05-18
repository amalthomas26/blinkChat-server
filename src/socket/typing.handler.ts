import { ensureJoinedConversationRoom } from "./conversation-room.guard";
import { AuthenticatedSocket, TypingPayload } from "./socket.types";

// conversationId → socketIds
const typingStore = new Map<string, Set<string>>();

// key: socketId-conversationId → timeout
const typingTimers = new Map<string, NodeJS.Timeout>();

const TYPING_TIMEOUT = 3000;

export const registerTypingHandlers = (socket: AuthenticatedSocket) => {
  const userId = socket.data.userId;
  const socketId = socket.id;

  socket.on("typing_start", async (data: TypingPayload) => {
    try {
      const { conversationId } = data || {};
      if (!conversationId || !userId) return;
      await ensureJoinedConversationRoom(socket, conversationId);

      let users = typingStore.get(conversationId);

      if (!users) {
        users = new Set();
        typingStore.set(conversationId, users);
      }

      const isNew = !users.has(socketId);
      if (isNew) {
        users.add(socketId);

        socket.to(conversationId).emit("user_typing", {
          userId,
          conversationId,
        });
      }

      const key = `${socketId}-${conversationId}`;

      const existing = typingTimers.get(key);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        handleTypingStop(socket, conversationId, socketId, userId);
      }, TYPING_TIMEOUT);

      typingTimers.set(key, timer);
    } catch (err) {
      console.error("[typing_start error]", err);
    }
  });

  socket.on("typing_stop", async (data: TypingPayload) => {
    try {
      const { conversationId } = data || {};
      if (!conversationId || !userId) return;
      await ensureJoinedConversationRoom(socket, conversationId);

      handleTypingStop(socket, conversationId, socketId, userId);
    } catch (err) {
      console.error("[typing_stop error]", err);
    }
  });

  socket.on("disconnect", () => {
    try {
      const entries = Array.from(typingStore.entries());

      for (const [conversationId, users] of entries) {
        if (!users.has(socketId)) continue;

        handleTypingStop(socket, conversationId, socketId, userId);
      }

      const timerKeys = Array.from(typingTimers.keys());

      for (const key of timerKeys) {
        if (key.startsWith(`${socketId}-`)) {
          const timer = typingTimers.get(key);
          if (timer) clearTimeout(timer);
          typingTimers.delete(key);
        }
      }
    } catch (err) {
      console.error("[disconnect typing cleanup error]", err);
    }
  });
};

const handleTypingStop = (
  socket: AuthenticatedSocket,
  conversationId: string,
  socketId: string,
  userId: string,
) => {
  const users = typingStore.get(conversationId);
  if (!users) return;

  if (!users.has(socketId)) return;

  users.delete(socketId);

  if (users.size === 0) {
    typingStore.delete(conversationId);
  }

  socket.to(conversationId).emit("user_stopped_typing", {
    userId,
    conversationId,
  });

  const key = `${socketId}-${conversationId}`;
  const timer = typingTimers.get(key);

  if (timer) clearTimeout(timer);
  typingTimers.delete(key);
};

// Typing is tracked per socket session so parallel tabs do not overwrite each other.
