import {Types} from "mongoose";

export interface UserProfileDto {
  id: string;
  name: string;
  email: string;
  username?: string | null;
  avatar: string | null;
  bio: string | null;
  status: "online" | "offline" | "away";
  lastSeen: Date | null;
  provider: "local" | "google";
  isEmailVerified: boolean;
  createdAt: Date;
}

export interface PublicUserProfileDto {
  id: string;
  name: string;
  avatar: string;
  bio: string;
  status: "online" | "offline" | "away";
  lastSeen: Date | null;
  createdAt: Date;
}

export interface UserSearchResultDto {
  id: string;
  name: string;
  avatar: string;
  status: "online" | "offline" | "away";
}


export type UserProfileSource = {
  id: Types.ObjectId | string;
  name: string;
  email: string;
  username?: string | null;
  avatar?: string | null;
  bio?: string | null;
  status: "online" | "offline" | "away";
  lastSeen: Date | null;
  provider: "local" | "google";
  isEmailVerified: boolean;
  createdAt: Date;
};


export interface UpdateProfileInput {
  name?: string;
  bio?: string;
  avatar?: string;
  avatarPublicId?: string;
  username?: string;
}
// Why this interface?
//This is your contract with the frontend. Every field is explicitly typed. password, googleId, __v, and _id are absent by design — they never enter this type
