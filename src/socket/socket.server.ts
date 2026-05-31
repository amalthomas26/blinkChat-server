import { Server as HTTPServer } from "http";

import { Server } from "socket.io";

import { socketCorsOptions } from "../config/env";
import { handleUserDisconnect } from "../modules/call/call.service";
import { Block } from "../modules/user/block.model";
import { User } from "../modules/user/user.model";
import { updateLastSeen, setUserOnline } from "../modules/user/user.service";
import { ApiError } from "../utils/ApiError";

import { registerCallHandlers } from "./call.handler";
import { registerMessageHandlers } from "./message.handler";
import { presenceStore } from "./presence.store";
import { verifySocketToken } from "./socket.auth";
import { registerEvents } from "./socket.event";
import { TypedIO, AuthenticatedSocket } from "./socket.types";
import { registerTypingHandlers } from "./typing.handler";
let io: TypedIO;

export const initSocket = (server: HTTPServer) => {
  io = new Server(server, {
    cors: socketCorsOptions,
  }) as TypedIO;

  io.use(verifySocketToken);

  io.on("connection", (socket: AuthenticatedSocket) => {
    const userId = socket.data.userId;

    if (!userId) {
      console.warn("[socket] missing userid, disconnecting");
      socket.disconnect();
      return;
    }
    try {
      presenceStore.add(userId, socket.id);

      console.log(" user connected:", {
        userId,
        socketId: socket.id,
      });

      setUserOnline(userId).catch((err) =>
        console.error("Failed to set user online in DB", err),
      );

      // Only broadcast online status if the user hasn't disabled showOnlineStatus
      User.findById(userId)
        .select("privacyPrefs")
        .lean()
        .then((user) => {
          if (user?.privacyPrefs?.showOnlineStatus !== false) {
            socket.broadcast.emit("user_online", { userId });
          }
        })
        .catch(() => {
          // If lookup fails, broadcast anyway (fail-safe)
          socket.broadcast.emit("user_online", { userId });
        });
      registerEvents(socket);
      registerMessageHandlers(io, socket);
      registerTypingHandlers(socket);
      registerCallHandlers(io, socket);

      // Presence sync: client calls this on connect/reconnect to get
      // accurate online state instead of relying on missed events.
      socket.on("get_presence", async (userIds: unknown, callback: unknown) => {
        if (typeof callback !== "function") return;
        if (!Array.isArray(userIds))
          return (callback as (v: string[]) => void)([]);

        // First filter to only actually-online users
        const onlineIds = (userIds as string[]).filter(
          (id) => typeof id === "string" && presenceStore.isOnline(id),
        );

        if (onlineIds.length === 0) {
          return (callback as (v: string[]) => void)([]);
        }

        try {
          // Filter out users who have disabled showOnlineStatus
          // AND users who have a block relationship with the requester
          const [visibleUsers, blocks] = await Promise.all([
            User.find({
              _id: { $in: onlineIds },
              "privacyPrefs.showOnlineStatus": { $ne: false },
            })
              .select("_id")
              .lean<{ _id: { toString(): string } }[]>(),

            Block.find({
              $or: [
                { blocker: userId, blocked: { $in: onlineIds } },
                { blocker: { $in: onlineIds }, blocked: userId },
              ],
            })
              .select("blocker blocked")
              .lean<
                {
                  blocker: { toString(): string };
                  blocked: { toString(): string };
                }[]
              >(),
          ]);

          // Build set of IDs that have a block with the requester
          const blockedIds = new Set<string>();
          blocks.forEach((b) => {
            const bid = b.blocker.toString();
            const blkd = b.blocked.toString();
            if (bid !== userId) blockedIds.add(bid);
            if (blkd !== userId) blockedIds.add(blkd);
          });

          const visibleIds = visibleUsers
            .map((u) => u._id.toString())
            .filter((id) => !blockedIds.has(id));

          (callback as (v: string[]) => void)(visibleIds);
        } catch {
          // On DB error, fall back to the unfiltered online list
          (callback as (v: string[]) => void)(onlineIds);
        }
      });

      socket.on("disconnect", async () => {
        try {
          const removedUserId = presenceStore.removeBySocket(socket.id);

          if (!removedUserId) return;

          console.log(" user disconnected", {
            userId: removedUserId,
            socketId: socket.id,
          });
          if (!presenceStore.isOnline(removedUserId)) {
            // Only broadcast offline if the user has showOnlineStatus enabled
            // (if they never appeared online to peers, no need to announce offline)
            User.findById(removedUserId)
              .select("privacyPrefs")
              .lean()
              .then((user) => {
                if (user?.privacyPrefs?.showOnlineStatus !== false) {
                  socket.broadcast.emit("user_offline", {
                    userId: removedUserId,
                  });
                }
              })
              .catch(() => {
                socket.broadcast.emit("user_offline", {
                  userId: removedUserId,
                });
              });

            await updateLastSeen(removedUserId);

            // Clean up any active call for this user
            const callResult = await handleUserDisconnect(
              removedUserId,
              (cId, targetId) => {
                // Reconnect timeout fired — call could not recover
                const sids = presenceStore.getSockets(targetId);
                for (const sid of sids) {
                  io.to(sid).emit("call:failed", {
                    callId: cId,
                    reason: "Connection lost",
                    failedAt: new Date(),
                  });
                }
              },
            );

            if (callResult) {
              const sids = presenceStore.getSockets(callResult.otherUserId);
              if (callResult.isReconnecting) {
                for (const sid of sids) {
                  io.to(sid).emit("call:reconnecting", {
                    callId: callResult.callId,
                    reconnectingUserId: removedUserId,
                    timeoutSeconds: 15,
                  });
                }
              } else {
                for (const sid of sids) {
                  io.to(sid).emit("call:ended", {
                    callId: callResult.callId,
                    reason:
                      callResult.status === "cancelled"
                        ? "cancelled"
                        : "missed",
                    duration: null,
                    endedAt: new Date(),
                  });
                }
              }
            }
          }
        } catch (err) {
          console.error("[disconnect error]", err);
        }
      });
    } catch (err) {
      console.error("[socket setup error]", err);
      socket.disconnect();
    }
  });
  return io;
};

export const getIO = () => {
  if (!io) throw new ApiError(500, "socket not initialized");
  return io;
};

// server.ts (entry)
//    ↓
// auth middleware
//    ↓
// connection
//    ↓
// events layer
//    ↓
// handlers (controller)
//    ↓
// service layer
//    ↓
// DB
