import {
  initiateCall,
  acknowledgeRinging,
  acceptCall,
  rejectCall,
  endCall,
  relaySdpOffer,
  relaySdpAnswer,
  relayIceCandidate,
  relayIceRestart,
  getCallerInfo,
} from "../modules/call/call.service";
import { CallStatus } from "../modules/call/call.types";
import { createCallLogMessage } from "../modules/message/message.service";
import type { MessageDto } from "../modules/message/message.types";

import { presenceStore } from "./presence.store";
import {
  AuthenticatedSocket,
  ServerToClientEvents,
  TypedIO,
} from "./socket.types";

const logError = (context: string, err: unknown) => {
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(`[${context}]`, message, err);
};

const emitToUser = <E extends keyof ServerToClientEvents>(
  io: TypedIO,
  userId: string,
  event: E,
  payload: Parameters<ServerToClientEvents[E]>[0],
): void => {
  const socketIds = presenceStore.getSockets(userId);
  for (const socketId of socketIds) {
    const operator = io.to(socketId) as unknown as {
      emit: (
        eventName: E,
        payload: Parameters<ServerToClientEvents[E]>[0]
      ) => void;
    };
    operator.emit(event, payload);
  }
};

export const registerCallHandlers = (
  io: TypedIO,
  socket: AuthenticatedSocket,
) => {
  const userId = socket.data.userId;

  socket.on("call:initiate", async (payload, callback) => {
    try {
      const receiverId = payload?.receiverId;
      const callType = payload?.callType;

      if (!receiverId || !callType) {
        return callback?.({
          success: false,
          error: "receiverId and callType are required",
        });
      }

      console.log(
        "[call:initiate] from:",
        userId,
        "to:",
        receiverId,
        "type:",
        callType,
      );

      const result = await initiateCall(
        { callerId: userId, receiverId, callType },
        async (cId, c, r) => {
          const missedPayload = {
            callId: cId,
            reason: "missed" as const,
            duration: null,
            endedAt: new Date(),
          };
          emitToUser(io, c, "call:ended", missedPayload);
          emitToUser(io, r, "call:ended", missedPayload);

          // Log the missed call as a chat message
          const log = await createCallLogMessage({
            callerId: c,
            receiverId: r,
            callType,
            status: "missed",
            duration: null,
          });
          if (log) {
            for (const pid of log.participantIds) {
              emitToUser(io, pid, "receive_message", log.message as MessageDto);
            }
          }
        },
      );
      const callerInfo = await getCallerInfo(userId);

      console.log(
        "[call:initiate] success, emitting call:incoming to:",
        result.receiverId,
      );

      emitToUser(io, result.receiverId, "call:incoming", {
        callId: result.callId,
        callerId: userId,
        callerName: callerInfo.name,
        callerAvatar: callerInfo.avatar,
        callType: result.callType,
        createdAt: result.createdAt,
      });

      return callback?.({ success: true, data: { callId: result.callId } });
    } catch (err) {
      logError("call:initiate", err);
      return callback?.({
        success: false,
        error: err instanceof Error ? err.message : "Error",
      });
    }
  });

  socket.on("call:ringing", async (payload, callback) => {
    try {
      const { callId, callerId } = payload ?? {};
      if (!callId || !callerId)
        return callback?.({
          success: false,
          error: "callId and callerId are required",
        });

      await acknowledgeRinging(callId, userId);

      // Forward the ringing confirmation back to the caller
      emitToUser(io, callerId, "call:ringing", { callId });

      return callback?.({ success: true, data: null });
    } catch (err) {
      logError("call:ringing", err);
      return callback?.({
        success: false,
        error: err instanceof Error ? err.message : "Error",
      });
    }
  });

  socket.on("call:accept", async (payload, callback) => {
    try {
      const { callId } = payload ?? {};
      if (!callId)
        return callback?.({ success: false, error: "callId is required" });

      const result = await acceptCall({ callId, userId });

      emitToUser(io, result.callerId, "call:accepted", {
        callId: result.callId,
        acceptedAt: result.acceptedAt,
      });

      return callback?.({ success: true, data: { callId: result.callId } });
    } catch (err) {
      logError("call:accept", err);
      return callback?.({
        success: false,
        error: err instanceof Error ? err.message : "Error",
      });
    }
  });

  socket.on("call:reject", async (payload, callback) => {
    try {
      const { callId } = payload ?? {};
      if (!callId)
        return callback?.({ success: false, error: "callId is required" });

      const result = await rejectCall({ callId, userId });

      emitToUser(io, result.callerId, "call:rejected", {
        callId: result.callId,
        rejectedAt: result.endedAt,
      });

      emitToUser(io, result.callerId, "call:ended", {
        callId: result.callId,
        reason: "rejected",
        duration: null,
        endedAt: result.endedAt,
      });

      // Log rejected call as a chat message
      const rejectLog = await createCallLogMessage({
        callerId: result.callerId,
        receiverId: userId,
        callType: result.callType,
        status: "rejected",
        duration: null,
      });
      if (rejectLog) {
        for (const pid of rejectLog.participantIds) {
          emitToUser(
            io,
            pid,
            "receive_message",
            rejectLog.message as MessageDto,
          );
        }
      }

      return callback?.({ success: true, data: null });
    } catch (err) {
      logError("call:reject", err);
      return callback?.({
        success: false,
        error: err instanceof Error ? err.message : "Error",
      });
    }
  });

  socket.on("call:end", async (payload, callback) => {
    try {
      const { callId } = payload ?? {};
      if (!callId)
        return callback?.({ success: false, error: "callId is required" });

      const result = await endCall({ callId, userId });

      const reasonMap: Record<string, "cancelled" | "missed" | "ended"> = {
        [CallStatus.CANCELLED]: "cancelled",
        [CallStatus.MISSED]: "missed",
      };
      const reason = reasonMap[result.status] ?? "ended";
      const otherUserId =
        result.callerId === userId ? result.receiverId : result.callerId;

      emitToUser(io, otherUserId, "call:ended", {
        callId: result.callId,
        reason,
        duration: result.duration,
        endedAt: result.endedAt,
      });

      // Log ended call as a chat message
      const endLog = await createCallLogMessage({
        callerId: result.callerId,
        receiverId: result.receiverId,
        callType: result.callType,
        status:
          reason === "cancelled" || reason === "missed" ? reason : "ended",
        duration: result.duration,
      });
      if (endLog) {
        for (const pid of endLog.participantIds) {
          emitToUser(io, pid, "receive_message", endLog.message as MessageDto);
        }
      }

      return callback?.({ success: true, data: null });
    } catch (err) {
      logError("call:end", err);
      return callback?.({
        success: false,
        error: err instanceof Error ? err.message : "Error",
      });
    }
  });

  // ─── WEBRTC SIGNALING ─────────────────────────────────

  socket.on("webrtc:offer", async (payload, callback) => {
    try {
      const { callId, sdp } = payload ?? {};
      if (!callId || !sdp)
        return callback?.({ success: false, error: "Missing payload" });

      const target = await relaySdpOffer({ callId, userId, sdp });

      emitToUser(io, target.targetUserId, "webrtc:offer", {
        callId: target.callId,
        sdp,
      });

      return callback?.({ success: true, data: null });
    } catch (err) {
      logError("webrtc:offer", err);
      return callback?.({
        success: false,
        error: err instanceof Error ? err.message : "Error",
      });
    }
  });

  socket.on("webrtc:answer", async (payload, callback) => {
    try {
      const { callId, sdp } = payload ?? {};
      if (!callId || !sdp)
        return callback?.({ success: false, error: "Missing payload" });

      const target = await relaySdpAnswer({ callId, userId, sdp });

      emitToUser(io, target.targetUserId, "webrtc:answer", {
        callId: target.callId,
        sdp,
      });

      return callback?.({ success: true, data: null });
    } catch (err) {
      logError("webrtc:answer", err);
      return callback?.({
        success: false,
        error: err instanceof Error ? err.message : "Error",
      });
    }
  });

  socket.on("webrtc:ice-candidate", async (payload, callback) => {
    try {
      const { callId, candidate } = payload ?? {};
      if (!callId)
        return callback?.({ success: false, error: "Missing payload" });

      const target = await relayIceCandidate({ callId, userId, candidate });

      emitToUser(io, target.targetUserId, "webrtc:ice-candidate", {
        callId: target.callId,
        candidate,
      });

      return callback?.({ success: true, data: null });
    } catch (err) {
      logError("webrtc:ice-candidate", err);
      return callback?.({
        success: false,
        error: err instanceof Error ? err.message : "Error",
      });
    }
  });

  socket.on("webrtc:restart-ice", async (payload, callback) => {
    try {
      const { callId } = payload ?? {};
      if (!callId)
        return callback?.({ success: false, error: "Missing callId" });

      const target = await relayIceRestart({ callId, userId });

      emitToUser(io, target.targetUserId, "webrtc:restart-ice", {
        callId,
        userId,
      });

      return callback?.({ success: true, data: null });
    } catch (err) {
      logError("webrtc:restart-ice", err);
      return callback?.({
        success: false,
        error: err instanceof Error ? err.message : "Error",
      });
    }
  });
};
