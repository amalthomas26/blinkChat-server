import mongoose, { Schema, Document } from "mongoose";

export enum MessageType {
  TEXT = "text",
  IMAGE = "image",
  AUDIO = "audio",
  VIDEO = "video",
  FILE = "file",
  CALL = "call",
  SYSTEM = "system",
}

export interface IDeliveredTo {
  userId: mongoose.Types.ObjectId;
  deliveredAt: Date;
}

export interface IMessage extends Document {
  conversation: mongoose.Types.ObjectId;
  sender: mongoose.Types.ObjectId;

  clientTempId?: string;

  content?: string;

  mediaUrl?: string;
  mediaPublicId?: string | null;
  audioDuration?: number;

  // Call log metadata (only when type === 'call')
  callMeta?: {
    callType: "audio" | "video";
    status: "ended" | "missed" | "rejected" | "cancelled" | "failed";
    duration: number | null;
  };
  thumbnailUrl?: string;
  fileName?: string;
  fileSize?: number;

  type: MessageType;

  deliveredTo: IDeliveredTo[];

  reactions?:{userId:mongoose.Types.ObjectId;emoji:string}[]

  replyTo?:mongoose.Types.ObjectId | null;

  replyToSnapshot?:{
    senderId:mongoose.Types.ObjectId;
    type:MessageType;
    content?:string;
    mediaUrl?:string;
  };
  forwardedFrom?:{
    originalSenderId:mongoose.Types.ObjectId;
    originalSenderName:string;
    originalMessageId:mongoose.Types.ObjectId;
    originalConversationId:mongoose.Types.ObjectId;
  };

  isEdited: boolean;
  isDeleted: boolean;

  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<IMessage>(
  {
    conversation: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    sender: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    clientTempId: {
      type: String,
    },

    content: {
      type: String,
      trim: true,
    },

    mediaUrl: String,
    thumbnailUrl: String,
    fileName: String,
    mediaPublicId: {
      type: String,
      default: null,
    },
    fileSize: Number,
    audioDuration:{
      type:Number,
      min:0
    },

    callMeta: {
      callType: { type: String, enum: ["audio", "video"] },
      status: { type: String, enum: ["ended", "missed", "rejected", "cancelled", "failed"] },
      duration: { type: Number, default: null },
    },

    type: {
      type: String,
      enum: Object.values(MessageType),
      required: true,
    },

    deliveredTo: [
      {
        userId: {
          type: Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        deliveredAt: {
          type: Date,
          required: true,
        },
      },
    ],
    reactions:[
      {
        userId:{type:Schema.Types.ObjectId,ref:"User",required:true},
        emoji:{type:String,required:true,maxlength:2},
      },

    ],
    replyTo:{
      type:Schema.Types.ObjectId,
      ref:"Message",
      default:null,
    },

    replyToSnapshot:{
      senderId:{type:Schema.Types.ObjectId,ref:"User"},
      type:{type:String,enum:Object.values(MessageType)},
      content:{type:String},
      mediaUrl:{type:String},
    },
    forwardedFrom:{
     originalSenderId:{type:Schema.Types.ObjectId,ref:"User"},
     originalSenderName:{type:String},
     originalMessageId:{type:Schema.Types.ObjectId,ref:"Message"},
     originalConversationId:{type:Schema.Types.ObjectId,ref:"Conversation"},
    },

    isEdited: {
      type: Boolean,
      default: false,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

messageSchema.index(
  { clientTempId: 1, sender: 1 },
  { unique: true, sparse: true },
);

messageSchema.index({ conversation: 1, createdAt: -1 });

messageSchema.index({ conversation: 1, _id: 1 });

messageSchema.index({ sender: 1, createdAt: -1 });

messageSchema.index(
  { conversation: 1, isDeleted: 1 },
  { partialFilterExpression: { isDeleted: false } },
);

messageSchema.index(
  {content:"text"},
  {partialFilterExpression:{isDeleted:false}}
);

messageSchema.index({ "deliveredTo.userId": 1 });

export default mongoose.model<IMessage>("Message", messageSchema);
