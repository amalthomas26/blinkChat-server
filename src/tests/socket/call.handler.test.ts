import { createServer } from "http";

import { Server } from "socket.io";
import { io as Client, Socket as ClientSocket } from "socket.io-client";

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
} from "../../modules/call/call.service";
import { CallType } from "../../modules/call/call.types";
import { registerCallHandlers } from "../../socket/call.handler";
import { presenceStore } from "../../socket/presence.store";
import type {
  ApiResponse,
  AuthenticatedSocket,
  ClientToServerEvents,
  ServerToClientEvents,
  TypedIO,
} from "../../socket/socket.types";

// ─── Mock the entire call service ─────────────────────────

jest.mock("../../modules/call/call.service", () => ({
  initiateCall: jest.fn(),
  acknowledgeRinging: jest.fn(),
  acceptCall: jest.fn(),
  rejectCall: jest.fn(),
  endCall: jest.fn(),
  relaySdpOffer: jest.fn(),
  relaySdpAnswer: jest.fn(),
  relayIceCandidate: jest.fn(),
  relayIceRestart: jest.fn(),
  getCallerInfo: jest.fn(),
}));

jest.setTimeout(30000);

const expectSuccess = <T>(response: ApiResponse<T>): T => {
  expect(response.success).toBe(true);
  if (!response.success) {
    throw new Error(`Expected success response, received: ${response.error}`);
  }
  return response.data;
};

const expectFailure = <T>(response: ApiResponse<T>): string => {
  expect(response.success).toBe(false);
  if (response.success) {
    throw new Error("Expected failure response");
  }
  return response.error;
};

// ─── Test constants ───────────────────────────────────────
const callerId = "507f1f77bcf86cd799439011";
const receiverId = "507f1f77bcf86cd799439022";
const callId = "507f1f77bcf86cd799439033";

let ioServer: Server<ClientToServerEvents, ServerToClientEvents>;
let callerSocket: ClientSocket<ServerToClientEvents, ClientToServerEvents>;
let receiverSocket: ClientSocket<ServerToClientEvents, ClientToServerEvents>;
let httpServer: ReturnType<typeof createServer>;

// ─── Setup / Teardown ─────────────────────────────────────
beforeAll((done) => {
  httpServer = createServer();
  ioServer = new Server(httpServer);

  ioServer.on("connection", (socket) => {
    // Assign userId based on connection order
    const userId = socket.handshake.query.userId as string;
    socket.data.userId = userId;

    // Register the user in presenceStore so emitToUser works
    presenceStore.add(userId, socket.id);

    registerCallHandlers(
      ioServer as unknown as TypedIO,
      socket as unknown as AuthenticatedSocket,
    );
  });

  httpServer.listen(() => {
    const address = httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind test HTTP server");
    }
    const port = address.port;
    let connected = 0;
    const onConnect = () => {
      connected++;
      if (connected === 2) done();
    };

    callerSocket = Client(`http://localhost:${port}`, {
      query: { userId: callerId },
    });
    receiverSocket = Client(`http://localhost:${port}`, {
      query: { userId: receiverId },
    });

    callerSocket.on("connect", onConnect);
    receiverSocket.on("connect", onConnect);
  });
});

afterAll(() => {
  ioServer.close();
  callerSocket.close();
  receiverSocket.close();
  httpServer.close();
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────
// call:initiate
// ─────────────────────────────────────────────────────────
describe("Socket - call:initiate", () => {
  it("should initiate a call and emit call:incoming to receiver", (done) => {
    const now = new Date();

    (initiateCall as jest.Mock).mockResolvedValue({
      callId,
      callerId,
      receiverId,
      callType: CallType.AUDIO,
      status: "initiated",
      createdAt: now,
    });

    (getCallerInfo as jest.Mock).mockResolvedValue({
      name: "Caller Name",
      avatar: "https://img.test/avatar.jpg",
    });

    receiverSocket.once("call:incoming", (payload) => {
      expect(payload.callId).toBe(callId);
      expect(payload.callerId).toBe(callerId);
      expect(payload.callerName).toBe("Caller Name");
      expect(payload.callerAvatar).toBe("https://img.test/avatar.jpg");
      expect(payload.callType).toBe("audio");
      done();
    });

    callerSocket.emit(
      "call:initiate",
      { receiverId, callType: CallType.AUDIO },
      (response) => {
        const data = expectSuccess(response);
        expect(data.callId).toBe(callId);
      },
    );
  });

  it("should return error if receiverId is missing", (done) => {
    callerSocket.emit(
      "call:initiate",
      {
        callType: CallType.AUDIO,
      } as unknown as Parameters<ClientToServerEvents["call:initiate"]>[0],
      (response) => {
        expect(expectFailure(response)).toContain(
          "receiverId and callType are required",
        );
        done();
      },
    );
  });

  it("should return service error in callback", (done) => {
    (initiateCall as jest.Mock).mockRejectedValue(new Error("User is busy"));

    callerSocket.emit(
      "call:initiate",
      { receiverId, callType: CallType.AUDIO },
      (response) => {
        expect(expectFailure(response)).toBe("User is busy");
        done();
      },
    );
  });
});

// ─────────────────────────────────────────────────────────
// call:ringing
// ─────────────────────────────────────────────────────────
describe("Socket - call:ringing", () => {
  it("should acknowledge ringing and forward to caller", (done) => {
    (acknowledgeRinging as jest.Mock).mockResolvedValue(undefined);

    callerSocket.once("call:ringing", (payload) => {
      expect(payload.callId).toBe(callId);
      expect(acknowledgeRinging).toHaveBeenCalledWith(callId, receiverId);
      done();
    });

    receiverSocket.emit(
      "call:ringing",
      { callId, callerId },
      (response) => {
        expect(response.success).toBe(true);
      },
    );
  });

  it("should return error if callId is missing", (done) => {
    receiverSocket.emit(
      "call:ringing",
      { callerId } as unknown as Parameters<ClientToServerEvents["call:ringing"]>[0],
      (response) => {
        expect(expectFailure(response)).toContain(
          "callId and callerId are required",
        );
        done();
      },
    );
  });
});

// ─────────────────────────────────────────────────────────
// call:accept
// ─────────────────────────────────────────────────────────
describe("Socket - call:accept", () => {
  it("should accept call and emit call:accepted to caller", (done) => {
    const acceptedAt = new Date();

    (acceptCall as jest.Mock).mockResolvedValue({
      callId,
      callerId,
      receiverId,
      callType: CallType.AUDIO,
      acceptedAt,
    });

    callerSocket.once("call:accepted", (payload) => {
      expect(payload.callId).toBe(callId);
      expect(payload.acceptedAt).toBeTruthy();
      done();
    });

    receiverSocket.emit(
      "call:accept",
      { callId },
      (response) => {
        const data = expectSuccess(response);
        expect(data.callId).toBe(callId);
      },
    );
  });
});

// ─────────────────────────────────────────────────────────
// call:reject
// ─────────────────────────────────────────────────────────
describe("Socket - call:reject", () => {
  it("should reject call and emit call:rejected + call:ended to caller", (done) => {
    const endedAt = new Date();

    (rejectCall as jest.Mock).mockResolvedValue({
      callId,
      callerId,
      receiverId,
      endedBy: receiverId,
      status: "rejected",
      endedAt,
      duration: null,
    });

    let rejectedReceived = false;

    callerSocket.once("call:rejected", (payload) => {
      expect(payload.callId).toBe(callId);
      rejectedReceived = true;
    });

    callerSocket.once("call:ended", (payload) => {
      expect(payload.callId).toBe(callId);
      expect(payload.reason).toBe("rejected");
      expect(payload.duration).toBeNull();
      // Both events should fire
      setTimeout(() => {
        expect(rejectedReceived).toBe(true);
        done();
      }, 50);
    });

    receiverSocket.emit(
      "call:reject",
      { callId },
      (response) => {
        expect(response.success).toBe(true);
      },
    );
  });
});

// ─────────────────────────────────────────────────────────
// call:end
// ─────────────────────────────────────────────────────────
describe("Socket - call:end", () => {
  it("should end call and emit call:ended with reason=ended to the other user", (done) => {
    const endedAt = new Date();

    (endCall as jest.Mock).mockResolvedValue({
      callId,
      callerId,
      receiverId,
      endedBy: callerId,
      status: "ended",
      endedAt,
      duration: 120,
    });

    receiverSocket.once("call:ended", (payload) => {
      expect(payload.callId).toBe(callId);
      expect(payload.reason).toBe("ended");
      expect(payload.duration).toBe(120);
      done();
    });

    callerSocket.emit(
      "call:end",
      { callId },
      (response) => {
        expect(response.success).toBe(true);
      },
    );
  });

  it("should map cancelled status to reason=cancelled", (done) => {
    (endCall as jest.Mock).mockResolvedValue({
      callId,
      callerId,
      receiverId,
      endedBy: callerId,
      status: "cancelled",
      endedAt: new Date(),
      duration: null,
    });

    receiverSocket.once("call:ended", (payload) => {
      expect(payload.reason).toBe("cancelled");
      done();
    });

    callerSocket.emit("call:end", { callId }, () => {});
  });

  it("should map missed status to reason=missed", (done) => {
    (endCall as jest.Mock).mockResolvedValue({
      callId,
      callerId,
      receiverId,
      endedBy: receiverId,
      status: "missed",
      endedAt: new Date(),
      duration: null,
    });

    callerSocket.once("call:ended", (payload) => {
      expect(payload.reason).toBe("missed");
      done();
    });

    receiverSocket.emit("call:end", { callId }, () => {});
  });
});

// ─────────────────────────────────────────────────────────
// WebRTC signaling: offer, answer, ice-candidate, restart
// ─────────────────────────────────────────────────────────
describe("Socket - WebRTC Signaling", () => {
  it("should relay webrtc:offer to the target user", (done) => {
    (relaySdpOffer as jest.Mock).mockResolvedValue({
      targetUserId: receiverId,
      callId,
    });

    receiverSocket.once("webrtc:offer", (payload) => {
      expect(payload.callId).toBe(callId);
      expect(payload.sdp).toBe("offer-sdp-data");
      done();
    });

    callerSocket.emit(
      "webrtc:offer",
      { callId, sdp: "offer-sdp-data" },
      (response) => {
        expect(response.success).toBe(true);
      },
    );
  });

  it("should relay webrtc:answer to the target user", (done) => {
    (relaySdpAnswer as jest.Mock).mockResolvedValue({
      targetUserId: callerId,
      callId,
    });

    callerSocket.once("webrtc:answer", (payload) => {
      expect(payload.callId).toBe(callId);
      expect(payload.sdp).toBe("answer-sdp-data");
      done();
    });

    receiverSocket.emit(
      "webrtc:answer",
      { callId, sdp: "answer-sdp-data" },
      (response) => {
        expect(response.success).toBe(true);
      },
    );
  });

  it("should relay webrtc:ice-candidate to the target user", (done) => {
    const candidate = { candidate: "candidate-string", sdpMid: "0" };

    (relayIceCandidate as jest.Mock).mockResolvedValue({
      targetUserId: receiverId,
      callId,
    });

    receiverSocket.once("webrtc:ice-candidate", (payload) => {
      expect(payload.callId).toBe(callId);
      expect(payload.candidate).toEqual(candidate);
      done();
    });

    callerSocket.emit(
      "webrtc:ice-candidate",
      { callId, candidate },
      (response) => {
        expect(response.success).toBe(true);
      },
    );
  });

  it("should relay webrtc:restart-ice to the target user", (done) => {
    (relayIceRestart as jest.Mock).mockResolvedValue({
      targetUserId: receiverId,
      callId,
    });

    receiverSocket.once("webrtc:restart-ice", (payload) => {
      expect(payload.callId).toBe(callId);
      expect(payload.userId).toBe(callerId);
      done();
    });

    callerSocket.emit(
      "webrtc:restart-ice",
      { callId },
      (response) => {
        expect(response.success).toBe(true);
      },
    );
  });

  it("should return error for webrtc:offer with missing sdp", (done) => {
    callerSocket.emit(
      "webrtc:offer",
      { callId } as unknown as Parameters<ClientToServerEvents["webrtc:offer"]>[0],
      (response) => {
        expect(expectFailure(response)).toContain("Missing payload");
        done();
      },
    );
  });

  it("should return service error for webrtc:answer failure", (done) => {
    (relaySdpAnswer as jest.Mock).mockRejectedValue(
      new Error("Cannot relay SDP in initiated state"),
    );

    receiverSocket.emit(
      "webrtc:answer",
      { callId, sdp: "bad" },
      (response) => {
        expect(expectFailure(response)).toContain("Cannot relay SDP");
        done();
      },
    );
  });
});
