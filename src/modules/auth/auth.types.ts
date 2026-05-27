export type AuthProvider = "local" | "google";

export interface IUser {
  _id?: string;
  name: string;
  email: string;
  password?: string;
  provider: AuthProvider;
  googleId?: string;
  avatar?: string;
  bio?: string;

  status?:"online" | "offline" | "away"
  lastSeen?: Date;


  createdAt?: Date;
  updatedAt?: Date;
}

// loginUser now returns one of two shapes depending on 2FA status
export type LoginResult =
  | {
      requires2FA: false;
      accessToken: string;
      refreshToken: string;
      sessionId: string;
      user: {
        id: unknown;
        name: string;
        email: string;
        avatar: string;
        isEmailVerified: boolean;
      };
    }
  | {
      requires2FA: true;
      email: string;
    };

    export interface SessionDto {
  sessionId: string;
  device: string;
  ip: string;
  userAgent: string;
  lastUsedAt: Date;
  createdAt: Date;
  isCurrent: boolean;
}