import { Server as HTTPServer } from "http";
import { Server } from "socket.io";

import { TypedIO, AuthenticatedSocket } from "./socket.types";
import { presenceStore } from "./presence.store";

import { verifySocketToken } from "./socket.auth";
import { registerMessageHandlers } from "./message.handler";
import { registerEvents } from "./socket.event";
import { registerTypingHandlers } from "./typing.handler";
import { updateLastSeen,setUserOnline } from "../modules/user/user.service";
import { ApiError } from "../utils/ApiError";
import { socketCorsOptions } from "../config/env";
import {registerCallHandlers} from "./call.handler";
import {handleUserDisconnect} from "../modules/call/call.service";

let io: TypedIO;

export const initSocket = (server: HTTPServer) => {
  io = new Server(server, {
    cors: socketCorsOptions,
  }) as TypedIO;

  io.use(verifySocketToken);

  io.on("connection", (socket: AuthenticatedSocket) => {
    const userId = socket.data.userId;

    if (!userId) {
      console.warn("[socket] missing userid,disonnecting");
      socket.disconnect();
      return;
    }
    try {
      presenceStore.add(userId, socket.id);

      console.log(" user connected:", {
        userId,
        socketId: socket.id,
      });

      setUserOnline(userId).catch(err =>
        console.error("Failed to set user online in DB",err)
      )

      socket.broadcast.emit("user_online", { userId });
      registerEvents(socket);
      registerMessageHandlers(io, socket);
      registerTypingHandlers(socket);
      registerCallHandlers(io, socket);

      // Presence sync: client calls this on connect/reconnect to get
      // accurate online state instead of relying on missed events.
      socket.on("get_presence", (userIds: unknown, callback: unknown) => {
        if (typeof callback !== "function") return;
        if (!Array.isArray(userIds)) return (callback as (v: string[]) => void)([]);
        const online = (userIds as string[]).filter(
          (id) => typeof id === "string" && presenceStore.isOnline(id),
        );
        (callback as (v: string[]) => void)(online);
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
            socket.broadcast.emit("user_offline", {
              userId: removedUserId,
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
                    reason: callResult.status === "cancelled" ? "cancelled" : "missed",
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
