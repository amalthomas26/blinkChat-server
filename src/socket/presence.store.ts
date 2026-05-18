type UserId = string;
type SocketId = string;

interface CallState {
  inCall: boolean;
  currentCallId: string | null;
}

class PresenceStore {

  remove(userId: UserId): void {
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      for (const sid of sockets) {
        this.socketToUser.delete(sid);
      }
      this.userSockets.delete(userId);
    }
    this.userCallState.delete(userId);
  }

  private userSockets = new Map<UserId, Set<SocketId>>(); //only can be accessed in the class
  private socketToUser = new Map<SocketId, UserId>(); //reverse mapping
  private userCallState = new Map<UserId, CallState>();

  add(userId: UserId, socketId: SocketId) {
    const sockets = this.userSockets.get(userId) ?? new Set();

    sockets.add(socketId);
    this.userSockets.set(userId, sockets);

    this.socketToUser.set(socketId, userId);
  }

  removeBySocket(socketId: SocketId): UserId | null {
    const userId = this.socketToUser.get(socketId);
    if (!userId) return null;

    const sockets = this.userSockets.get(userId);
    if (!sockets) return null;

    sockets.delete(socketId);
    this.socketToUser.delete(socketId);

    if (sockets.size === 0) {
      this.userSockets.delete(userId);
    }
    return userId;
  }

  isOnline(userId: UserId): boolean {
    return (this.userSockets.get(userId)?.size ?? 0) > 0;
  }

  getSockets(userId: UserId): SocketId[] {
    return Array.from(this.userSockets.get(userId) ?? []);
  }

  setInCall(userId: UserId, callId: string): void {
    this.userCallState.set(userId, { inCall: true, currentCallId: callId });
  }

  clearCallState(userId: UserId): void {
    this.userCallState.delete(userId);
  }

  isInCall(userId: UserId): boolean {
    return this.userCallState.get(userId)?.inCall ?? false;
  }

  getCurrentCallId(userId: UserId): string | null {
    return this.userCallState.get(userId)?.currentCallId ?? null;
  }

  getCallState(userId: UserId): CallState {
    return (
      this.userCallState.get(userId) ?? { inCall: false, currentCallId: null }
    );
  }
}

export const presenceStore = new PresenceStore();
