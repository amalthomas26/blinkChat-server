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
