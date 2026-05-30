import mongoose, { Schema, Document } from "mongoose";

export interface IConversationParticipant {
  conversationId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  lastSeenMessageId?: mongoose.Types.ObjectId | null;
  role:"admin" | "member";
  isPinned:boolean;
  pinnedAt:Date|null;
  isMuted:boolean;
  mutedUntill:Date|null;
  createdAt: Date;
  updatedAt: Date;
}

export type ConversationParticipantDocument = IConversationParticipant &
  Document;

const schema = new Schema<ConversationParticipantDocument>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
      validate: {
        validator: mongoose.Types.ObjectId.isValid,
        message: "Invalid conversationId",
      },
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
      validate: {
        validator: mongoose.Types.ObjectId.isValid,
        message: "Invalid userId",
      },
    },
    lastSeenMessageId: {
      type: Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    role:{
      type:String,
      enum:["admin","member"],
      default:"member"
    },
    isPinned:{
      type:Boolean,
      default:false,
    },
    pinnedAt:{
      type:Date,
      default:null,
    },
    isMuted:{
      type:Boolean,
      default:false,

    },
    mutedUntill:{
      type:Date,
      default:null,
    },
  },
  { timestamps: true },
);

schema.index({conversationId:1,role:1})

schema.index({ conversationId: 1, userId: 1 }, { unique: true });

schema.index({ userId: 1, conversationId: 1 });

schema.index(
  { conversationId: 1, lastSeenMessageId: 1 },
  { partialFilterExpression: { lastSeenMessageId: { $exists: true } } },
);

schema.index({ updatedAt: -1 });
schema.index({userId:1,isPinned:-1,pinnedAt:-1});

schema.set("toJSON", {
  transform: (
    _doc,
    ret: IConversationParticipant & {
      _id?: mongoose.Types.ObjectId;
      __v?: unknown;
      id?: string;
    },
  ) => {
    if (ret.__v !== undefined) delete ret.__v;
    if (ret._id) {
      ret.id = ret._id.toString();
      delete ret._id;
    }
    return ret;
  },
});

export const ConversationParticipant =
  mongoose.model<ConversationParticipantDocument>(
    "ConversationParticipant",
    schema,
  );
