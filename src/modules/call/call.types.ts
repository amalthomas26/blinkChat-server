
export enum CallType {
  AUDIO = "audio",
  VIDEO = "video",
}

export enum CallStatus {
  INITIATED = "initiated",
  RINGING = "ringing",
  ACCEPTED = "accepted",
  ONGOING = "ongoing",
  RECONNECTING = "reconnecting",
  ENDED = "ended",
  REJECTED = "rejected",
  MISSED = "missed",
  CANCELLED = "cancelled",
  FAILED = "failed", // Added for WebRTC failures
}

export const VALID_TRANSITIONS: Record<CallStatus, CallStatus[]> = {
  //For every current call status, what are the only valid next statuses?
  [CallStatus.INITIATED]: [
    CallStatus.RINGING,
    CallStatus.ACCEPTED,
    CallStatus.REJECTED,
    CallStatus.CANCELLED,
    CallStatus.MISSED,
  ],
  [CallStatus.RINGING]: [
    CallStatus.ACCEPTED,
    CallStatus.REJECTED,
    CallStatus.CANCELLED,
    CallStatus.MISSED,
  ],
  [CallStatus.ACCEPTED]: [
    CallStatus.ONGOING,
    CallStatus.ENDED,
    CallStatus.RECONNECTING,
    CallStatus.FAILED,
  ],
  [CallStatus.ONGOING]: [
    CallStatus.ENDED, 
    CallStatus.RECONNECTING,
    CallStatus.FAILED,
  ],
  [CallStatus.RECONNECTING]: [
    CallStatus.ONGOING, 
    CallStatus.ENDED,
    CallStatus.FAILED,
  ],

  [CallStatus.ENDED]: [],
  [CallStatus.REJECTED]: [],
  [CallStatus.MISSED]: [],
  [CallStatus.CANCELLED]: [],
  [CallStatus.FAILED]: [],
};

// ─── Service Input DTOs ─────────────────────────────────

export interface InitiateCallInput {
  callerId: string;
  receiverId: string;
  callType: CallType;
}

export interface AcceptCallInput {
  callId: string;
  userId: string;
}

export interface RejectCallInput {
  callId: string;
  userId: string;
}

export interface EndCallInput {
  callId: string;
  userId: string;
}

// ─── Service Output DTOs ────────────────────────────────

export interface InitiateCallResult {
  callId: string;
  callerId: string;
  receiverId: string;
  callType: CallType;
  status: CallStatus;
  createdAt: Date;
}

export interface AcceptCallResult {
  callId: string;
  callerId: string;
  receiverId: string;
  callType: CallType;
  acceptedAt: Date; 
}

export interface EndCallResult {
  callId: string;
  callerId: string;
  receiverId: string;
  callType: CallType;
  endedBy: string;
  status: CallStatus;
  endedAt: Date;
  duration: number | null; // seconds
}

export interface UserDisconnectResult {
  callId: string;
  otherUserId: string;
  /** true  → call moved to RECONNECTING; false → call terminated */
  isReconnecting: boolean;
  status: CallStatus;
}

// ─── WebRTC Relay DTOs ──────────────────────────────────

export interface RelaySDPInput {
  callId: string;
  userId: string;
  sdp: string;
}

export interface RelayICEInput {
  callId: string;
  userId: string;
  candidate: unknown;
}

export interface RelayIceRestartInput {
  callId: string;
  userId: string;
}

export interface RelayTarget {
  targetUserId: string;
  callId: string;
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceConfigDto {
  iceServers: IceServer[];
  iceTransportPolicy: "all" | "relay";
};

// ─── Socket Event Payloads (Sent to Frontend) ───────────

export interface CallIncomingPayload {
  callId: string;
  callerId: string;
  callerName: string;
  callerAvatar: string;
  callType: CallType;
  createdAt: Date; 
};

export interface CallAcceptedPayload {
  callId: string;
  acceptedAt: Date; 
};

export interface CallRejectedPayload {
  callId: string;
  rejectedAt: Date; 
};

export interface CallEndedPayload {
  callId: string;
  reason: "ended" | "missed" | "rejected" | "cancelled" | "busy" | "error" | "failed";
  endedAt: Date; 
  duration: number | null; 
};

export interface CallBusyPayload {
  callId: string;
  receiverId: string;
};

// ─── Reliability & Failure Payloads ───

export interface CallReconnectingPayload {
  callId: string;
  reconnectingUserId: string; 
  timeoutSeconds: number; 
};

export interface CallFailedPayload {
  callId: string;
  reason: string; 
  failedAt: Date;
};

// ─── WebRTC Signaling Payloads ───

export interface WebRTCOfferPayload {
  callId: string;
  sdp: string;
};

export interface WebRTCAnswerPayload {
  callId: string;
  sdp: string;
};

export interface WebRTCIceCandidatePayload {
  callId: string;
  candidate: unknown;
};

export interface WebRTCRestartIcePayload {
  callId: string;
  userId: string; // the peer who is initiating the ICE restart
};
