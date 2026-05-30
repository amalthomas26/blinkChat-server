import mongoose, { Schema, Document, Types } from "mongoose";

import { CallType, CallStatus } from "./call.types";

export interface ICall extends Document {
  callerId: Types.ObjectId;
  receiverId: Types.ObjectId;
  callType: CallType;
  status: CallStatus;
  startedAt: Date | null;
  endedAt: Date | null;
  duration: number | null;
  participantsHash: string;
  acceptedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const callSchema = new Schema<ICall>(
  {
    callerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    callType: {
      type: String,
      enum: Object.values(CallType),
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(CallStatus),
      default: CallStatus.INITIATED,
      required: true,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    endedAt: {
      type: Date,
      default: null,
    },
    duration: {
      type: Number,
      default: null,
    },
    participantsHash: {
      type: String,
      required: true,
    },
    acceptedAt:{
      type:Date,
      default:null
    },
  },
  {
    timestamps: true,
  },
);

callSchema.index(
  { participantsHash: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: {
        $in: [CallStatus.INITIATED,CallStatus.RINGING, CallStatus.ACCEPTED, CallStatus.ONGOING,
         CallStatus.RECONNECTING
        ],
      },
    },
  },
); //For a given participantsHash,
//ONLY ONE ACTIVE CALL can exist at any point in time.

callSchema.index({ callerId: 1, createdAt: -1 });
callSchema.index({ receiverId: 1, createdAt: -1 });

callSchema.pre("validate", function () {
  if (!this.participantsHash && this.callerId && this.receiverId) {
    const sorted = [
      this.callerId.toString(),
      this.receiverId.toString(),
    ].sort();
    this.participantsHash = sorted.join("_");
  }
});

export default mongoose.model<ICall>("Call", callSchema);
