import crypto from "crypto";

import { Types } from "mongoose";

import { presenceStore } from "../../socket/presence.store";
import { ApiError } from "../../utils/ApiError";
import { isValidObjectId } from "../../utils/objectId";
import { Block } from "../user/block.model";
import { User } from "../user/user.model";

import Call, { ICall } from "./call.model";
import {
  CallType,
  CallStatus,
  VALID_TRANSITIONS,
  InitiateCallInput,
  AcceptCallInput,
  RejectCallInput,
  EndCallInput,
  RelaySDPInput,
  RelayICEInput,
  RelayIceRestartInput,
  InitiateCallResult,
  AcceptCallResult,
  EndCallResult,
  UserDisconnectResult,
  RelayTarget,
  IceConfigDto,
  IceServer,
} from "./call.types";


class CallTimeoutManager {
  private timers = new Map<string, NodeJS.Timeout>();

  start(key: string, durationMs: number, onTimeout: () => void): void {
    this.clear(key);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      onTimeout();
    }, durationMs);
    timer.unref();
    this.timers.set(key, timer);
  }

  clear(key: string): void {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  has(key: string): boolean {
    return this.timers.has(key);
  }
}

export const timeoutManager = new CallTimeoutManager();

const transitionCallStatus = async (
  callId: string,
  fromStatus: CallStatus | CallStatus[],
  toStatus: CallStatus,
  extraUpdate: Record<string, unknown> = {},
): Promise<ICall> => {
  const fromStatuses = Array.isArray(fromStatus) ? fromStatus : [fromStatus];

  for (const status of fromStatuses) {
    if (!VALID_TRANSITIONS[status].includes(toStatus))
      throw new ApiError(
        409,
        `Invalid state transition: ${status} → ${toStatus}`,
      );
  }

  const updatedCall = await Call.findOneAndUpdate(
    {
      _id: callId,
      status: { $in: fromStatuses },
    },
    {
      $set: {
        status: toStatus,
        ...extraUpdate,
      },
    },
    { new: true },
  ).lean<ICall>();

  if (!updatedCall)
    throw new ApiError(409, `Call state already changed or call not found`);

  return updatedCall;
};

const clearCallPresence = (callerId: string, receiverId: string): void => {
  presenceStore.clearCallState(callerId);
  presenceStore.clearCallState(receiverId);
};

const getOtherParty = (call: ICall, userId: string): string => {
  const callerStr = call.callerId.toString();
  const receiverStr = call.receiverId.toString();
  return callerStr === userId ? receiverStr : callerStr;
};

export const initiateCall = async (
  input: InitiateCallInput,
  onRingTimeout?: (
    callId: string,
    callerId: string,
    receiverId: string,
  ) => void,
): Promise<InitiateCallResult> => {
  const { callerId, receiverId, callType } = input;

  if (!isValidObjectId(callerId) || !isValidObjectId(receiverId))
    throw new ApiError(400, "Invalid user Ids");

  if (callerId === receiverId) throw new ApiError(400, "Cannot call yourself");

  const receiver = await User.findById(receiverId)
    .select("_id name")
    .lean<{ _id: Types.ObjectId; name: string }>();

  if (!receiver) throw new ApiError(404, "User not found");

  const blockExists = await Block.exists({
    $or: [
      { blocker: callerId, blocked: receiverId },
      { blocker: receiverId, blocked: callerId },
    ],
  });

  if (blockExists) throw new ApiError(403, "Cannot call this user");

  if (!presenceStore.isOnline(receiverId))
    throw new ApiError(422, "User is offline");

  if (presenceStore.isInCall(callerId))
    throw new ApiError(409, "You are already in a call");

  if (presenceStore.isInCall(receiverId))
    throw new ApiError(409, "User is busy");

  let call: ICall;

  try {
    call = await Call.create({
      callerId,
      receiverId,
      callType,
      status: CallStatus.INITIATED,
    });
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === 11000
    ) {
      throw new ApiError(
        409,
        "An active call already exists between these users",
      );
    }

    throw err;
  }

  const callId = call._id.toString();

  presenceStore.setInCall(callerId, callId);
  presenceStore.setInCall(receiverId, callId);

  timeoutManager.start(`ring_${callId}`, 30_000, () => {
    handleCallTimeout(callId, callerId, receiverId)
      .then(() => onRingTimeout?.(callId, callerId, receiverId))
      .catch(console.error);
  });

  return {
    callId,
    callerId: call.callerId.toString(),
    receiverId: call.receiverId.toString(),
    callType: call.callType,
    status: CallStatus.INITIATED,
    createdAt: call.createdAt,
  };
};

export const acknowledgeRinging = async (
  callId: string,
  userId: string,
): Promise<void> => {
  if (!isValidObjectId(callId)) throw new ApiError(400, "Invalid call Id");

  const call = await Call.findById(callId).lean<ICall>();

  if (!call) throw new ApiError(404, "Call not found");

  if (call.receiverId.toString() !== userId)
    throw new ApiError(403, "Only receiver can acknowledge ringing");

  if (call.status === CallStatus.INITIATED) {
    await transitionCallStatus(
      callId,
      CallStatus.INITIATED,
      CallStatus.RINGING,
    );
  }
};

export const acceptCall = async (
  input: AcceptCallInput,
): Promise<AcceptCallResult> => {
  const { callId, userId } = input;

  if (!isValidObjectId(callId)) throw new ApiError(400, "Invalid call Id");

  const call = await Call.findById(callId).lean<ICall>();

  if (!call) throw new ApiError(404, "Call not found");

  if (call.receiverId.toString() !== userId)
    throw new ApiError(403, "Only the receiver can accept a call");

  const now = new Date();

  await transitionCallStatus(
    callId,
    [CallStatus.INITIATED, CallStatus.RINGING],
    CallStatus.ACCEPTED,
    { acceptedAt: now },
  );

  timeoutManager.clear(`ring_${callId}`);

  return {
    callId,
    callerId: call.callerId.toString(),
    receiverId: call.receiverId.toString(),
    callType: call.callType,
    acceptedAt: now,
  };
};

export const rejectCall = async (
  input: RejectCallInput,
): Promise<EndCallResult> => {
  const { callId, userId } = input;

  if (!isValidObjectId(callId)) throw new ApiError(400, "Invalid call Id");

  const call = await Call.findById(callId).lean<ICall>();

  if (!call) throw new ApiError(404, "call not found");

  if (call.receiverId.toString() !== userId)
    throw new ApiError(403, "Only the receiver can reject a call");

  const now = new Date();

  await transitionCallStatus(
    callId,
    [CallStatus.INITIATED, CallStatus.RINGING],
    CallStatus.REJECTED,
    { endedAt: now },
  );

  timeoutManager.clear(`ring_${callId}`);

  clearCallPresence(call.callerId.toString(), call.receiverId.toString());

  return {
    callId,
    callerId: call.callerId.toString(),
    receiverId: call.receiverId.toString(),
    callType: call.callType,
    endedBy: userId,
    status: CallStatus.REJECTED,
    endedAt: now,
    duration: null,
  };
};

const computeDuration = (
  startedAt: Date | null,
  endedAt: Date,
): number | null => {
  if (!startedAt) return null;
  return Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);
};

export const endCall = async (input: EndCallInput): Promise<EndCallResult> => {
  const { callId, userId } = input;

  if (!isValidObjectId(callId)) throw new ApiError(400, "Invalid call ID");

  const call = await Call.findById(callId).lean<ICall>();
  if (!call) throw new ApiError(404, "Call not found");

  const callerStr = call.callerId.toString();
  const receiverStr = call.receiverId.toString();

  if (callerStr !== userId && receiverStr !== userId)
    throw new ApiError(403, "You are not a participant in this call");

  const terminalStates = [
    CallStatus.ENDED,
    CallStatus.REJECTED,
    CallStatus.MISSED,
    CallStatus.CANCELLED,
    CallStatus.FAILED,
  ];

  if (terminalStates.includes(call.status)) {
    clearCallPresence(callerStr, receiverStr);

    return {
      callId,
      callerId: callerStr,
      receiverId: receiverStr,
      callType: call.callType,
      endedBy: userId,
      status: call.status,
      endedAt: call.endedAt || new Date(),
      duration: call.duration ?? null,
    };
  }

  const now = new Date();
  const duration = computeDuration(call.startedAt ?? null, now);

  const isPreLive =
    call.status === CallStatus.INITIATED || call.status === CallStatus.RINGING;

  let finalStatus: CallStatus;
  if (isPreLive && userId === callerStr) {
    finalStatus = CallStatus.CANCELLED;
  } else if (isPreLive) {
    finalStatus = CallStatus.MISSED;
  } else {
    finalStatus = CallStatus.ENDED;
  }

  await transitionCallStatus(callId, call.status, finalStatus, {
    endedAt: now,
    duration,
  });

  timeoutManager.clear(`ring_${callId}`);
  timeoutManager.clear(`reconnect_${callId}`);
  clearCallPresence(callerStr, receiverStr);

  return {
    callId,
    callerId: callerStr,
    receiverId: receiverStr,
    callType: call.callType,
    endedBy: userId,
    status: finalStatus,
    endedAt: now,
    duration: duration,
  };
};

export const failCall = async (
  callId: string,
  userId: string,
  _reason: string,
): Promise<EndCallResult> => {
  void _reason;
  const call = await Call.findById(callId).lean<ICall>();

  if (!call) throw new ApiError(404, "Call not found");

  const now = new Date();
  const duration = computeDuration(call.startedAt ?? null, now);

  await transitionCallStatus(
    callId,
    [CallStatus.ACCEPTED, CallStatus.ONGOING, CallStatus.RECONNECTING],
    CallStatus.FAILED,
    { endedAt: now, duration },
  );

  timeoutManager.clear(`ring_${callId}`);
  timeoutManager.clear(`reconnect_${callId}`);
  clearCallPresence(call.callerId.toString(), call.receiverId.toString());

  return {
    callId,
    callerId: call.callerId.toString(),
    receiverId: call.receiverId.toString(),
    callType: call.callType,
    endedBy: userId,
    status: CallStatus.FAILED,
    endedAt: now,
    duration,
  };
};

export const relaySdpOffer = async (
  input: RelaySDPInput,
): Promise<RelayTarget> => {
  const { callId, userId } = input;
  const call = await Call.findById(callId).lean<ICall>();

  if (!call) throw new ApiError(404, "Call not found");

  const activeStates = [
    CallStatus.ACCEPTED,
    CallStatus.ONGOING,
    CallStatus.RECONNECTING,
  ];

  if (!activeStates.includes(call.status))
    throw new ApiError(409, `Cannot relay SDP in ${call.status} state`);

  return { targetUserId: getOtherParty(call, userId), callId };
};

export const relaySdpAnswer = async (
  input: RelaySDPInput,
): Promise<RelayTarget> => {
  const { callId, userId } = input;

  const call = await Call.findById(callId).lean<ICall>();

  if (!call) throw new ApiError(404, "Call not found");

  if (call.status === CallStatus.ACCEPTED) {
    await transitionCallStatus(
      callId,
      CallStatus.ACCEPTED,
      CallStatus.ONGOING,
      { startedAt: new Date() },
    );
  }

  return { targetUserId: getOtherParty(call, userId), callId };
};

export const relayIceCandidate = async (
  input: RelayICEInput,
): Promise<RelayTarget> => {
  const { callId, userId } = input;

  const call = await Call.findById(callId).lean<ICall>();

  if (!call) throw new ApiError(404, "Call not found");

  const activeStates = [
    CallStatus.ACCEPTED,
    CallStatus.ONGOING,
    CallStatus.RECONNECTING,
  ];

  if (!activeStates.includes(call.status))
    throw new ApiError(409, `Cannot relay ICE in ${call.status} state`);

  return { targetUserId: getOtherParty(call, userId), callId };
};

export const relayIceRestart = async (
  input: RelayIceRestartInput,
): Promise<RelayTarget> => {
  const { callId, userId } = input;

  const call = await Call.findById(callId).lean<ICall>();

  if (!call) throw new ApiError(404, "Call not found");

  const activeStates = [
    CallStatus.ACCEPTED,
    CallStatus.ONGOING,
    CallStatus.RECONNECTING,
  ];
  if (!activeStates.includes(call.status))
    throw new ApiError(409, `Cannot relay ICE restart in ${call.status} state`);

  return { targetUserId: getOtherParty(call, userId), callId };
};

const handleCallTimeout = async (
  callId: string,
  callerId: string,
  receiverId: string,
): Promise<void> => {
  try {
    const call = await Call.findById(callId).lean<ICall>();

    if (
      !call ||
      (call.status !== CallStatus.INITIATED &&
        call.status !== CallStatus.RINGING)
    )
      return;

    await transitionCallStatus(
      callId,
      [CallStatus.INITIATED, CallStatus.RINGING],
      CallStatus.MISSED,
      { endedAt: new Date() },
    );

    clearCallPresence(callerId, receiverId);
  } catch (err) {
    console.error(
      `[call:timeout] Error handling timeout for call ${callId}:`,
      err,
    );
  }
};

export const handleUserReconnect = async (
  callId: string,
  _userId: string,
): Promise<void> => {
  void _userId;
  const call = await Call.findById(callId).lean<ICall>();

  if (!call) throw new ApiError(404, "Call not found");

  if (call.status === CallStatus.RECONNECTING) {
    await transitionCallStatus(
      callId,
      CallStatus.RECONNECTING,
      CallStatus.ONGOING,
    );
    timeoutManager.clear(`reconnect_${callId}`);
  }
};

/**
 * Called when a socket disconnects unexpectedly.
 *
 * Decision tree:
 *  - No active call in presenceStore  → return null (nothing to do)
 *  - Call in INITIATED / RINGING      → terminate immediately (CANCELLED / ENDED)
 *  - Call in ACCEPTED / ONGOING       → move to RECONNECTING, start 15-second timer
 *    • If timer fires → invoke onReconnectTimeout so the handler can emit call:failed
 *
 * Returns a UserDisconnectResult so the socket layer knows what to emit.
 */
export const handleUserDisconnect = async (
  userId: string,
  onReconnectTimeout: (callId: string, otherUserId: string) => void,
): Promise<UserDisconnectResult | null> => {
  const callId = presenceStore.getCurrentCallId(userId);
  if (!callId) return null;

  const call = await Call.findById(callId).lean<ICall>();
  if (!call) {
    presenceStore.clearCallState(userId);
    return null;
  }

  // Already in a terminal state — clean up presence and bail.
  const terminalStates = [
    CallStatus.ENDED,
    CallStatus.REJECTED,
    CallStatus.MISSED,
    CallStatus.CANCELLED,
    CallStatus.FAILED,
  ];
  if (terminalStates.includes(call.status)) {
    presenceStore.clearCallState(userId);
    return null;
  }

  const callerStr = call.callerId.toString();
  const receiverStr = call.receiverId.toString();
  const otherUserId = getOtherParty(call, userId);

  // ─── Pre-connection disconnect: terminate immediately ───────────────────
  const preLiveStates = [CallStatus.INITIATED, CallStatus.RINGING];
  if (preLiveStates.includes(call.status)) {
    const now = new Date();
    const isCancel = userId === callerStr;
    const finalStatus = isCancel ? CallStatus.CANCELLED : CallStatus.MISSED;

    await transitionCallStatus(callId, call.status, finalStatus, {
      endedAt: now,
    });

    timeoutManager.clear(`ring_${callId}`);
    clearCallPresence(callerStr, receiverStr);

    return { callId, otherUserId, isReconnecting: false, status: finalStatus };
  }

  // ─── Mid-call disconnect: enter RECONNECTING, start timer ───────────────
  const midCallStates = [
    CallStatus.ACCEPTED,
    CallStatus.ONGOING,
    CallStatus.RECONNECTING,
  ];
  if (midCallStates.includes(call.status)) {
    // Only transition if not already reconnecting (idempotent).
    if (call.status !== CallStatus.RECONNECTING) {
      await transitionCallStatus(callId, call.status, CallStatus.RECONNECTING);
    }

    // Clear the user from presence — their socket is gone.
    presenceStore.clearCallState(userId);

    // 15-second window for the user to reconnect.
    timeoutManager.start(`reconnect_${callId}`, 15_000, () => {
      failCall(callId, userId, "Reconnection timed out")
        .then(() => clearCallPresence(callerStr, receiverStr))
        .catch(console.error);

      onReconnectTimeout(callId, otherUserId);
    });

    return {
      callId,
      otherUserId,
      isReconnecting: true,
      status: CallStatus.RECONNECTING,
    };
  }

  return null;
};

function generateTurnCredentials(
  userId: string,
): { username: string; credential: string } | null {
  const secret = process.env.TURN_SECRET;
  const ttl = Number(process.env.TURN_TTL_SECONDS ?? 86400);

  if (!secret) return null;

  const expiry = Math.floor(Date.now() / 1000) + ttl;
  const username = `${expiry}:${userId}`;

  const credential = crypto
    .createHmac("sha1", secret)
    .update(username)
    .digest("base64");

  return { username, credential };
}

export const getIceConfig = (userId: string): IceConfigDto => {
  const iceServers: IceServer[] = [
    { urls: process.env.STUN_URL_1 ?? "stun:stun.l.google.com:19302" },
    { urls: process.env.STUN_URL_2 ?? "stun:stun1.l.google.com:19302" },
  ];

  const creds = generateTurnCredentials(userId);
  const turnUrl = process.env.TURN_URL;
  const turnTlsUrl = process.env.TURN_TLS_URL;

  if (creds) {
    if (turnUrl) {
      iceServers.push({
        urls: [`${turnUrl}?transport=udp`, `${turnUrl}?transport=tcp`],
        username: creds.username,
        credential: creds.credential,
      });
    }

    if (turnTlsUrl) {
      iceServers.push({
        urls: [`${turnTlsUrl}?transport=tcp`],
        username: creds.username,
        credential: creds.credential,
      });
    }
  }

  return {
    iceServers,
    iceTransportPolicy: "all",
  };
};

export const getCallerInfo = async (
  callerId: string,
): Promise<{ name: string; avatar: string }> => {
  const user = await User.findById(callerId)
    .select("name avatar")
    .lean<{ name: string; avatar?: string }>();

  return { name: user?.name || "Unknown", avatar: user?.avatar || "" };
};

export const getCallHistory = async (
  userId: string,
  page: number,
  limit: number,
): Promise<{
  calls: Array<{
    _id: string;
    callType: string;
    status: string;
    direction: "outgoing" | "incoming";
    duration: number | null;
    createdAt: Date;
    endedAt: Date | null;
    peer: { _id: string; name: string; avatar: string };
  }>;
  total: number;
  page: number;
  totalPages: number;
}> => {
  type CallHistoryUser = {
    _id: Types.ObjectId;
    name?: string;
    avatar?: string;
  };

  type CallHistoryRecord = {
    _id: Types.ObjectId;
    callerId: Types.ObjectId | CallHistoryUser;
    receiverId: Types.ObjectId | CallHistoryUser;
    callType: CallType;
    status: CallStatus;
    duration: number | null;
    createdAt: Date;
    endedAt: Date | null;
  };

  const isCallHistoryUser = (
    value: Types.ObjectId | CallHistoryUser,
  ): value is CallHistoryUser => "name" in value || "avatar" in value;

  const skip = (page - 1) * limit;

  const filter = {
    $or: [{ callerId: userId }, { receiverId: userId }],
    status: {
      $in: [
        CallStatus.ENDED,
        CallStatus.MISSED,
        CallStatus.REJECTED,
        CallStatus.CANCELLED,
        CallStatus.FAILED,
      ],
    },
  };

  const [calls, total] = await Promise.all([
    Call.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("callerId", "name avatar")
      .populate("receiverId", "name avatar")
      .lean<CallHistoryRecord[]>(),
    Call.countDocuments(filter),
  ]);

  const mapped = calls.map((call) => {
    const callerStr = isCallHistoryUser(call.callerId)
      ? call.callerId._id.toString()
      : call.callerId.toString();
    const isOutgoing = callerStr === userId;
    const peerPopulated = isOutgoing ? call.receiverId : call.callerId;
    const peerObj =
      isCallHistoryUser(peerPopulated)
        ? peerPopulated
        : { _id: peerPopulated, name: "Unknown", avatar: "" };

    return {
      _id: call._id.toString(),
      callType: call.callType,
      status: call.status,
      direction: isOutgoing ? ("outgoing" as const) : ("incoming" as const),
      duration: call.duration ?? null,
      createdAt: call.createdAt,
      endedAt: call.endedAt,
      peer: {
        _id: peerObj._id.toString(),
        name: peerObj.name ?? "Unknown",
        avatar: peerObj.avatar ?? "",
      },
    };
  });

  return {
    calls: mapped,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
};
