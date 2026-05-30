/**
 * Call Service — Pure Unit Tests (fully mocked, no MongoDB)
 */
import mongoose from "mongoose";

// ─── Mock presenceStore ───────────────────────────────────
const mockPresence = {
  isOnline: jest.fn().mockReturnValue(true),
  isInCall: jest.fn().mockReturnValue(false),
  setInCall: jest.fn(),
  clearCallState: jest.fn(),
  getCurrentCallId: jest.fn().mockReturnValue(null),
  getSockets: jest.fn().mockReturnValue([]),
};
jest.mock("../../../socket/presence.store", () => ({
  presenceStore: mockPresence,
}));

// ─── Mock Block model ─────────────────────────────────────
jest.mock("../../../modules/user/block.model", () => ({
  Block: { exists: jest.fn().mockResolvedValue(null) },
}));

// ─── Mock User model ──────────────────────────────────────
const mockUserLean = jest.fn();
const mockUserSelect = jest.fn().mockReturnValue({ lean: mockUserLean });
const mockUserFindById = jest.fn().mockReturnValue({ select: mockUserSelect });
jest.mock("../../../modules/user/user.model", () => ({
  User: { findById: mockUserFindById },
}));

// ─── Mock Call model ──────────────────────────────────────
const mockCallLean = jest.fn();
const mockCallFindById = jest.fn().mockReturnValue({ lean: mockCallLean });
const mockCallFindOneAndUpdate = jest.fn().mockReturnValue({ lean: mockCallLean });
const mockCallCreate = jest.fn();

jest.mock("../../../modules/call/call.model", () => {
  const mock = {
    findById: mockCallFindById,
    findOneAndUpdate: mockCallFindOneAndUpdate,
    create: mockCallCreate,
    updateOne: jest.fn(),
  };
  return { __esModule: true, default: mock };
});

// ─── Mock objectId util ───────────────────────────────────
jest.mock("../../../utils/objectId", () => ({
  isValidObjectId: jest.fn((id: string) => mongoose.Types.ObjectId.isValid(id)),
}));

// ─── Import service AFTER mocks ───────────────────────────
import {
  initiateCall,
  acknowledgeRinging,
  acceptCall,
  rejectCall,
  endCall,
  failCall,
  relaySdpOffer,
  relaySdpAnswer,
  relayIceCandidate,
  relayIceRestart,
  handleUserReconnect,
  handleUserDisconnect,
  getCallerInfo,
  getIceConfig,
  timeoutManager,
} from "../../../modules/call/call.service";
import { CallStatus, CallType } from "../../../modules/call/call.types";
import { Block } from "../../../modules/user/block.model";

// ─── helpers ──────────────────────────────────────────────
const oid = () => new mongoose.Types.ObjectId().toString();
const callerId = oid();
const receiverId = oid();

const makeCallDoc = (overrides: Record<string, unknown> = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  callerId: new mongoose.Types.ObjectId(callerId),
  receiverId: new mongoose.Types.ObjectId(receiverId),
  callType: CallType.AUDIO,
  status: CallStatus.INITIATED,
  startedAt: null,
  endedAt: null,
  duration: null,
  createdAt: new Date(),
  ...overrides,
});

// ─── Reset between tests ─────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();
  mockPresence.isOnline.mockReturnValue(true);
  mockPresence.isInCall.mockReturnValue(false);
  mockPresence.getCurrentCallId.mockReturnValue(null);
  mockUserLean.mockResolvedValue({ _id: receiverId, name: "Receiver" });
});

afterEach(() => {
  timeoutManager.clear(`ring_${callerId}`);
  timeoutManager.clear(`reconnect_${callerId}`);
});

// ═══════════════════════════════════════════════════════════
// initiateCall
// ═══════════════════════════════════════════════════════════
describe("initiateCall", () => {
  it("should create call and set presence", async () => {
    const doc = makeCallDoc();
    mockCallCreate.mockResolvedValue(doc);

    const result = await initiateCall({ callerId, receiverId, callType: CallType.AUDIO });

    expect(result.callId).toBe(doc._id.toString());
    expect(result.status).toBe(CallStatus.INITIATED);
    expect(mockPresence.setInCall).toHaveBeenCalledTimes(2);
    expect(mockCallCreate).toHaveBeenCalledWith(
      expect.objectContaining({ callerId, receiverId, status: CallStatus.INITIATED }),
    );
  });

  it("should reject invalid IDs", async () => {
    await expect(
      initiateCall({ callerId: "bad", receiverId: "bad", callType: CallType.AUDIO }),
    ).rejects.toThrow("Invalid user Ids");
  });

  it("should reject self-call", async () => {
    await expect(
      initiateCall({ callerId, receiverId: callerId, callType: CallType.AUDIO }),
    ).rejects.toThrow("Cannot call yourself");
  });

  it("should reject if receiver not found", async () => {
    mockUserLean.mockResolvedValue(null);
    await expect(
      initiateCall({ callerId, receiverId, callType: CallType.AUDIO }),
    ).rejects.toThrow("User not found");
  });

  it("should reject if block exists", async () => {
    (Block.exists as jest.Mock).mockResolvedValueOnce({ _id: "x" });
    await expect(
      initiateCall({ callerId, receiverId, callType: CallType.AUDIO }),
    ).rejects.toThrow("Cannot call this user");
  });

  it("should reject if receiver is offline", async () => {
    mockPresence.isOnline.mockImplementation((id: string) => id !== receiverId);
    await expect(
      initiateCall({ callerId, receiverId, callType: CallType.AUDIO }),
    ).rejects.toThrow("User is offline");
  });

  it("should reject if caller already in call", async () => {
    mockPresence.isInCall.mockImplementation((id: string) => id === callerId);
    await expect(
      initiateCall({ callerId, receiverId, callType: CallType.AUDIO }),
    ).rejects.toThrow("You are already in a call");
  });

  it("should reject if receiver is busy", async () => {
    mockPresence.isInCall.mockImplementation((id: string) => id === receiverId);
    await expect(
      initiateCall({ callerId, receiverId, callType: CallType.AUDIO }),
    ).rejects.toThrow("User is busy");
  });

  it("should handle duplicate call (11000 error)", async () => {
    const err = Object.assign(new Error("dup"), { code: 11000 });
    mockCallCreate.mockRejectedValue(err);
    await expect(
      initiateCall({ callerId, receiverId, callType: CallType.AUDIO }),
    ).rejects.toThrow("An active call already exists");
  });
});

// ═══════════════════════════════════════════════════════════
// acknowledgeRinging
// ═══════════════════════════════════════════════════════════
describe("acknowledgeRinging", () => {
  it("should transition INITIATED → RINGING", async () => {
    const doc = makeCallDoc({ status: CallStatus.INITIATED });
    mockCallLean.mockResolvedValueOnce(doc); // findById
    mockCallLean.mockResolvedValueOnce({ ...doc, status: CallStatus.RINGING }); // findOneAndUpdate

    await acknowledgeRinging(doc._id.toString(), receiverId);

    expect(mockCallFindOneAndUpdate).toHaveBeenCalled();
  });

  it("should be idempotent for RINGING", async () => {
    const doc = makeCallDoc({ status: CallStatus.RINGING });
    mockCallLean.mockResolvedValue(doc);

    await acknowledgeRinging(doc._id.toString(), receiverId);
    expect(mockCallFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("should reject non-receiver", async () => {
    const doc = makeCallDoc();
    mockCallLean.mockResolvedValue(doc);

    await expect(acknowledgeRinging(doc._id.toString(), callerId)).rejects.toThrow(
      "Only receiver can acknowledge ringing",
    );
  });

  it("should reject invalid callId", async () => {
    await expect(acknowledgeRinging("bad", receiverId)).rejects.toThrow("Invalid call Id");
  });

  it("should reject missing call", async () => {
    mockCallLean.mockResolvedValue(null);
    await expect(acknowledgeRinging(oid(), receiverId)).rejects.toThrow("Call not found");
  });
});

// ═══════════════════════════════════════════════════════════
// acceptCall
// ═══════════════════════════════════════════════════════════
describe("acceptCall", () => {
  it("should transition to ACCEPTED and return acceptedAt", async () => {
    const doc = makeCallDoc({ status: CallStatus.RINGING });
    const updated = { ...doc, status: CallStatus.ACCEPTED, acceptedAt: new Date() };
    mockCallLean.mockResolvedValueOnce(doc);
    mockCallLean.mockResolvedValueOnce(updated);

    const result = await acceptCall({ callId: doc._id.toString(), userId: receiverId });

    expect(result.callId).toBe(doc._id.toString());
    expect(result.acceptedAt).toBeInstanceOf(Date);
  });

  it("should reject non-receiver", async () => {
    const doc = makeCallDoc();
    mockCallLean.mockResolvedValue(doc);

    await expect(
      acceptCall({ callId: doc._id.toString(), userId: callerId }),
    ).rejects.toThrow("Only the receiver can accept a call");
  });
});

// ═══════════════════════════════════════════════════════════
// rejectCall
// ═══════════════════════════════════════════════════════════
describe("rejectCall", () => {
  it("should transition to REJECTED and clear presence", async () => {
    const doc = makeCallDoc({ status: CallStatus.RINGING });
    const updated = { ...doc, status: CallStatus.REJECTED, endedAt: new Date() };
    mockCallLean.mockResolvedValueOnce(doc);
    mockCallLean.mockResolvedValueOnce(updated);

    const result = await rejectCall({ callId: doc._id.toString(), userId: receiverId });

    expect(result.status).toBe(CallStatus.REJECTED);
    expect(result.duration).toBeNull();
    expect(mockPresence.clearCallState).toHaveBeenCalledTimes(2);
  });

  it("should reject non-receiver", async () => {
    const doc = makeCallDoc();
    mockCallLean.mockResolvedValue(doc);

    await expect(
      rejectCall({ callId: doc._id.toString(), userId: callerId }),
    ).rejects.toThrow("Only the receiver can reject a call");
  });
});

// ═══════════════════════════════════════════════════════════
// endCall
// ═══════════════════════════════════════════════════════════
describe("endCall", () => {
  it("should CANCEL when caller ends during RINGING", async () => {
    const doc = makeCallDoc({ status: CallStatus.RINGING });
    const updated = { ...doc, status: CallStatus.CANCELLED };
    mockCallLean.mockResolvedValueOnce(doc);
    mockCallLean.mockResolvedValueOnce(updated);

    const result = await endCall({ callId: doc._id.toString(), userId: callerId });
    expect(result.status).toBe(CallStatus.CANCELLED);
  });

  it("should MISS when receiver ends during RINGING", async () => {
    const doc = makeCallDoc({ status: CallStatus.RINGING });
    const updated = { ...doc, status: CallStatus.MISSED };
    mockCallLean.mockResolvedValueOnce(doc);
    mockCallLean.mockResolvedValueOnce(updated);

    const result = await endCall({ callId: doc._id.toString(), userId: receiverId });
    expect(result.status).toBe(CallStatus.MISSED);
  });

  it("should END during ONGOING", async () => {
    const startedAt = new Date(Date.now() - 60000);
    const doc = makeCallDoc({ status: CallStatus.ONGOING, startedAt });
    const updated = { ...doc, status: CallStatus.ENDED };
    mockCallLean.mockResolvedValueOnce(doc);
    mockCallLean.mockResolvedValueOnce(updated);

    const result = await endCall({ callId: doc._id.toString(), userId: callerId });
    expect(result.status).toBe(CallStatus.ENDED);
    expect(result.duration).toBeGreaterThanOrEqual(59);
  });

  it("should be idempotent for terminal states", async () => {
    const doc = makeCallDoc({ status: CallStatus.ENDED, endedAt: new Date() });
    mockCallLean.mockResolvedValue(doc);

    const result = await endCall({ callId: doc._id.toString(), userId: callerId });
    expect(result.status).toBe(CallStatus.ENDED);
    expect(mockCallFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("should reject non-participant", async () => {
    const doc = makeCallDoc();
    mockCallLean.mockResolvedValue(doc);

    await expect(endCall({ callId: doc._id.toString(), userId: oid() })).rejects.toThrow(
      "You are not a participant in this call",
    );
  });
});

// ═══════════════════════════════════════════════════════════
// failCall
// ═══════════════════════════════════════════════════════════
describe("failCall", () => {
  it("should transition to FAILED and clear presence", async () => {
    const doc = makeCallDoc({ status: CallStatus.ONGOING });
    const updated = { ...doc, status: CallStatus.FAILED };
    mockCallLean.mockResolvedValueOnce(doc);
    mockCallLean.mockResolvedValueOnce(updated);

    const result = await failCall(doc._id.toString(), callerId, "Network error");
    expect(result.status).toBe(CallStatus.FAILED);
    expect(mockPresence.clearCallState).toHaveBeenCalledTimes(2);
  });

  it("should reject missing call", async () => {
    mockCallLean.mockResolvedValue(null);
    await expect(failCall(oid(), callerId, "reason")).rejects.toThrow("Call not found");
  });
});

// ═══════════════════════════════════════════════════════════
// WebRTC Relay
// ═══════════════════════════════════════════════════════════
describe("WebRTC Relay", () => {
  const activeDoc = () => makeCallDoc({ status: CallStatus.ACCEPTED });
  const inactiveDoc = () => makeCallDoc({ status: CallStatus.INITIATED });

  describe("relaySdpOffer", () => {
    it("should return target in active state", async () => {
      mockCallLean.mockResolvedValue(activeDoc());
      const target = await relaySdpOffer({ callId: oid(), userId: callerId, sdp: "o" });
      expect(target.targetUserId).toBe(receiverId);
    });

    it("should reject in non-active state", async () => {
      mockCallLean.mockResolvedValue(inactiveDoc());
      await expect(
        relaySdpOffer({ callId: oid(), userId: callerId, sdp: "o" }),
      ).rejects.toThrow("Cannot relay SDP");
    });
  });

  describe("relaySdpAnswer", () => {
    it("should transition ACCEPTED → ONGOING on answer", async () => {
      const doc = activeDoc();
      const updated = { ...doc, status: CallStatus.ONGOING };
      mockCallLean.mockResolvedValueOnce(doc);
      mockCallLean.mockResolvedValueOnce(updated);

      const target = await relaySdpAnswer({ callId: doc._id.toString(), userId: receiverId, sdp: "a" });
      expect(target.targetUserId).toBe(callerId);
      expect(mockCallFindOneAndUpdate).toHaveBeenCalled();
    });
  });

  describe("relayIceCandidate", () => {
    it("should relay in active state", async () => {
      mockCallLean.mockResolvedValue(activeDoc());
      const target = await relayIceCandidate({ callId: oid(), userId: callerId, candidate: {} });
      expect(target.targetUserId).toBe(receiverId);
    });

    it("should reject in non-active state", async () => {
      mockCallLean.mockResolvedValue(inactiveDoc());
      await expect(
        relayIceCandidate({ callId: oid(), userId: callerId, candidate: {} }),
      ).rejects.toThrow("Cannot relay ICE");
    });
  });

  describe("relayIceRestart", () => {
    it("should relay in active state", async () => {
      mockCallLean.mockResolvedValue(activeDoc());
      const target = await relayIceRestart({ callId: oid(), userId: callerId });
      expect(target.targetUserId).toBe(receiverId);
    });

    it("should reject in non-active state", async () => {
      mockCallLean.mockResolvedValue(inactiveDoc());
      await expect(
        relayIceRestart({ callId: oid(), userId: callerId }),
      ).rejects.toThrow("Cannot relay ICE restart");
    });
  });
});

// ═══════════════════════════════════════════════════════════
// handleUserReconnect
// ═══════════════════════════════════════════════════════════
describe("handleUserReconnect", () => {
  it("should transition RECONNECTING → ONGOING", async () => {
    const doc = makeCallDoc({ status: CallStatus.RECONNECTING });
    const updated = { ...doc, status: CallStatus.ONGOING };
    mockCallLean.mockResolvedValueOnce(doc);
    mockCallLean.mockResolvedValueOnce(updated);

    await handleUserReconnect(doc._id.toString(), callerId);
    expect(mockCallFindOneAndUpdate).toHaveBeenCalled();
  });

  it("should no-op if already ONGOING", async () => {
    const doc = makeCallDoc({ status: CallStatus.ONGOING });
    mockCallLean.mockResolvedValue(doc);

    await handleUserReconnect(doc._id.toString(), callerId);
    expect(mockCallFindOneAndUpdate).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════
// handleUserDisconnect
// ═══════════════════════════════════════════════════════════
describe("handleUserDisconnect", () => {
  const noopCb = jest.fn();

  it("should return null if no active call", async () => {
    const result = await handleUserDisconnect(callerId, noopCb);
    expect(result).toBeNull();
  });

  it("should CANCEL when caller disconnects during INITIATED", async () => {
    const doc = makeCallDoc({ status: CallStatus.INITIATED });
    const updated = { ...doc, status: CallStatus.CANCELLED };
    mockPresence.getCurrentCallId.mockReturnValue(doc._id.toString());
    mockCallLean.mockResolvedValueOnce(doc);
    mockCallLean.mockResolvedValueOnce(updated);

    const result = await handleUserDisconnect(callerId, noopCb);
    expect(result!.isReconnecting).toBe(false);
    expect(result!.status).toBe(CallStatus.CANCELLED);
  });

  it("should MISS when receiver disconnects during RINGING", async () => {
    const doc = makeCallDoc({ status: CallStatus.RINGING });
    const updated = { ...doc, status: CallStatus.MISSED };
    mockPresence.getCurrentCallId.mockReturnValue(doc._id.toString());
    mockCallLean.mockResolvedValueOnce(doc);
    mockCallLean.mockResolvedValueOnce(updated);

    const result = await handleUserDisconnect(receiverId, noopCb);
    expect(result!.isReconnecting).toBe(false);
    expect(result!.status).toBe(CallStatus.MISSED);
  });

  it("should enter RECONNECTING on mid-call disconnect", async () => {
    const doc = makeCallDoc({ status: CallStatus.ONGOING });
    const updated = { ...doc, status: CallStatus.RECONNECTING };
    mockPresence.getCurrentCallId.mockReturnValue(doc._id.toString());
    mockCallLean.mockResolvedValueOnce(doc);
    mockCallLean.mockResolvedValueOnce(updated);

    const result = await handleUserDisconnect(callerId, noopCb);
    expect(result!.isReconnecting).toBe(true);
    expect(result!.status).toBe(CallStatus.RECONNECTING);
  });

  it("should return null for terminal state", async () => {
    const doc = makeCallDoc({ status: CallStatus.ENDED });
    mockPresence.getCurrentCallId.mockReturnValue(doc._id.toString());
    mockCallLean.mockResolvedValue(doc);

    const result = await handleUserDisconnect(callerId, noopCb);
    expect(result).toBeNull();
    expect(mockPresence.clearCallState).toHaveBeenCalledWith(callerId);
  });

  it("should return null if call doc missing", async () => {
    mockPresence.getCurrentCallId.mockReturnValue(oid());
    mockCallLean.mockResolvedValue(null);

    const result = await handleUserDisconnect(callerId, noopCb);
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
// getCallerInfo
// ═══════════════════════════════════════════════════════════
describe("getCallerInfo", () => {
  it("should return name and avatar", async () => {
    mockUserLean.mockResolvedValue({ name: "John", avatar: "http://img/j.jpg" });
    const info = await getCallerInfo(callerId);
    expect(info.name).toBe("John");
    expect(info.avatar).toBe("http://img/j.jpg");
  });

  it("should default for missing user", async () => {
    mockUserLean.mockResolvedValue(null);
    const info = await getCallerInfo(oid());
    expect(info.name).toBe("Unknown");
    expect(info.avatar).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════
// getIceConfig
// ═══════════════════════════════════════════════════════════
describe("getIceConfig", () => {
  it("should return STUN servers by default", () => {
    const config = getIceConfig(callerId);
    expect(config.iceServers.length).toBeGreaterThanOrEqual(2);
    expect(config.iceTransportPolicy).toBe("all");
  });

  it("should include TURN if env vars set", () => {
    process.env.TURN_URL = "turn:example.com";
    process.env.TURN_USERNAME = "user";
    process.env.TURN_CREDENTIAL = "pass";

    const config = getIceConfig(callerId);
    expect(config.iceServers.length).toBe(3);

    delete process.env.TURN_URL;
    delete process.env.TURN_USERNAME;
    delete process.env.TURN_CREDENTIAL;
  });
});
