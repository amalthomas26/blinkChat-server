import mongoose, { Schema, Document } from "mongoose";

export interface IRefreshToken extends Document {
  userId: mongoose.Types.ObjectId;
  sessionId: string;
  token: string;
  expiresAt: Date;
  isRevoked: boolean;
  lastUsedAt?: Date;
  device?: string;
  ip?: string;
  userAgent?: string;
}

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    isRevoked: {
      //even if token is valid we can manually kill it
      type: Boolean,
      default: false,
      index: true,
    },
    lastUsedAt: {
      type: Date,
    },
    device: {
      type: String,
      default: "unknown",
    },
    ip: {
      type: String,
      default: "unknown",
    },
    userAgent: {
      type: String,
      default: "unknown",
    },
  },
  {
    timestamps: true,
  },
);

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
//this creates a TTL index (Time-TO_live ) ,mongodb wiil automatically
//delete documents when expiresAt time is reached

export default mongoose.model<IRefreshToken>(
  "RefreshToken",
  refreshTokenSchema,
);
