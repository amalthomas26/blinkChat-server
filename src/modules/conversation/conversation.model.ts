import mongoose, { Schema, Document } from "mongoose";

export interface IConversation extends Document {
  participants: mongoose.Types.ObjectId[];
  isGroup: boolean;
  groupName?: string;
  groupDescription?:string,
  groupAvatar?: string | null;
  groupAvatarPublicId?: string | null;
  groupAdmin?: mongoose.Types.ObjectId;
  maxParticipants?: number;

  lastMessage?: mongoose.Types.ObjectId;

  pinnedMessages?:mongoose.Types.ObjectId[];

  participantsHash?: string;

  createdAt: Date;
  updatedAt: Date;
}

const conversationSchema = new Schema<IConversation>(
  {
    participants: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],

    isGroup: {
      type: Boolean,
      default: false,
    },

    groupName: {
      type: String,
    },
    groupDescription:{
      type:String,
      maxLength: 1000,
    },
    groupAvatar: {
      type: String,
      default: null,
    },
    groupAvatarPublicId: {
      type: String,
      default: null,
    },
    maxParticipants: {
      type: Number,
      default: 256,
    },

    groupAdmin: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },

    lastMessage: {
      type: Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    pinnedMessages:[
      {
        type:Schema.Types.ObjectId,
        ref:"Message"
      },
    ],

    participantsHash: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

// ---------------- INDEXES ----------------

conversationSchema.index(
  { participantsHash: 1 },
  {
    unique: true,
    partialFilterExpression: { isGroup: false },
  },
);

conversationSchema.index({ updatedAt: -1 });

// generate deterministic hash for 1-1 chats
conversationSchema.pre("validate", function () {
  if (!this.isGroup && this.participants.length === 2) {
    const sorted = this.participants.map((id) => id.toString()).sort();

    this.participantsHash = sorted.join("_");
  }
});

export default mongoose.model<IConversation>(
  "Conversation",
  conversationSchema,
);
