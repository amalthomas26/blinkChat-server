import bcrypt from "bcryptjs";
import mongoose, { Schema, Document, Model } from "mongoose";

import type { AuthProvider } from "../auth/auth.types";

export interface IUserDocument extends Document {
  name: string;
  email: string;
  password?: string;
  username?: string;
  provider: AuthProvider;
  googleId?: string;
  avatar?: string;
  avatarPublicId?: string | null;
  bio?: string;
  isEmailVerified: boolean;
  passwordChangedAt?: Date;
  status?: "online" | "offline" | "away";
  lastSeen?: Date;
  twoFactorEnabled: boolean;

  notificationPrefs: {
    browserNotifications: boolean;
    sounds: boolean;
    muteAll: boolean;
  };

  privacyPrefs: {
    showOnlineStatus: boolean;
    showLastSeen: boolean;
  }


  createdAt: Date;
  updatedAt: Date;

  comparePassword(candidatePassword: string): Promise<boolean>;
}

const userSchema = new Schema<IUserDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please use a valid email"],
    },
    password: {
      type: String,
      minlength: 8,
      select: false,
    },
    provider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true,
    },
    username: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
      match: [/^[a-z0-9_]{3,30}$/, "Username must be 3-30 characters: lowercase letters, numbers, underscores only"],
      index: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: true,
      index: true
    },
    passwordChangedAt: {
      type: Date,
      default: null,
    },
    avatar: {
      type: String,
      default: "",
    },
    avatarPublicId: {
      type: String,
      default: null,
    },
    bio: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["online", "offline", "away"],
      default: "offline",
    },
    lastSeen: {
      type: Date,
      index: true,
      default: null,
    },
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    notificationPrefs: {
      browserNotifications: { type: Boolean, default: true },
      sounds: { type: Boolean, default: true },
      muteAll: { type: Boolean, default: false },
    },
    privacyPrefs: {
      showOnlineStatus: { type: Boolean, default: true },
      showLastSeen: { type: Boolean, default: true },
    },
  },
  {
    timestamps: true,
  },
);



userSchema.pre("save", async function () {
  if (this.provider !== "local") return;
  if (!this.isModified("password")) return;

  if (!this.password) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.index({ status: 1 });
userSchema.index({ name: 1 });

export const User: Model<IUserDocument> =
  (mongoose.models.User as Model<IUserDocument>) ||
  mongoose.model<IUserDocument>("User", userSchema);
