import { Types } from "mongoose";

import type { ConversationListMessageDto } from "../conversation/conversation.types";

import type { IMessage } from "./message.model";
import { MessageType } from "./message.model";
import type { MessageDto } from "./message.types";

// ─── Lean shapes ──────────────────────────────────────────────────────────────
//
// These mirror the fields selected in .lean<>() calls throughout
// message.service.ts. Keeping them here alongside the formatters that consume
// them makes the shapes and their transformations co-located and easy to audit.

export type LeanMessage = {
  _id: Types.ObjectId;
  conversation: Types.ObjectId;
  sender: Types.ObjectId;
  clientTempId?: string;
  content?: string;
  mediaUrl?: string;
  mediaPublicId?: string | null;
  audioDuration?: number;
  thumbnailUrl?: string;
  fileName?: string;
  fileSize?: number;
  callMeta?: {
    callType: "audio" | "video";
    status: "ended" | "missed" | "rejected" | "cancelled" | "failed";
    duration: number | null;
  };
  type: MessageType;
  createdAt: Date;
  updatedAt?: Date;
  deliveredTo: {
    userId: Types.ObjectId;
    deliveredAt: Date;
  }[];
  isDeleted?: boolean;
  reactions?: {
    userId: Types.ObjectId;
    emoji: string;
  }[];
  replyTo?: Types.ObjectId | null;
  replyToSnapshot?: {
    senderId: Types.ObjectId;
    type: MessageType;
    content?: string;
    mediaUrl?: string;
  };
  forwardedFrom?: {
    originalSenderId: Types.ObjectId;
    originalSenderName: string;
    originalMessageId: Types.ObjectId;
    originalConversationId: Types.ObjectId;
  };
};

// Union of a full Mongoose document and the leaner shape returned by .lean().
export type MessageRecord = LeanMessage | IMessage;

// Subset of fields needed to build conversation list previews.
export type ConversationPreviewMessageRecord = {
  _id: Types.ObjectId;
  sender: Types.ObjectId;
  type: MessageType;
  content?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  fileName?: string;
  fileSize?: number;
  createdAt: Date;
};

// ─── DTO formatters ───────────────────────────────────────────────────────────
//
// Pure functions — no DB access, no side effects.
// Extracted here to break the conversation.service ↔ message.service circular
// dependency: conversation.service needs toMessageDto (for getPinnedMessages)
// but cannot import from message.service because message.service already imports
// from conversation.service for membership checks.

export const toMessageDto = (message: MessageRecord): MessageDto => ({
  _id: message._id.toString(),
  conversationId: message.conversation.toString(),
  senderId: message.sender.toString(),
  clientTempId: message.clientTempId,
  type: message.type,
  content: message.content,
  mediaUrl: message.mediaUrl,
  mediaPublicId: message.mediaPublicId ?? undefined,
  audioDuration: message.audioDuration,
  thumbnailUrl: message.thumbnailUrl,
  fileName: message.fileName,
  fileSize: message.fileSize,
  createdAt: message.createdAt.toISOString(),
  deliveredTo: message.deliveredTo.map((delivery) => ({
    userId: delivery.userId.toString(),
    deliveredAt: delivery.deliveredAt.toISOString(),
  })),
  reactions:
    message.reactions?.map((reaction) => ({
      userId: reaction.userId.toString(),
      emoji: reaction.emoji,
    })) || [],
  replyTo: message.replyTo?.toString(),
  replyToSnapshot: message.replyToSnapshot?.senderId
    ? {
        senderId: message.replyToSnapshot.senderId.toString(),
        type: message.replyToSnapshot.type,
        content: message.replyToSnapshot.content,
        mediaUrl: message.replyToSnapshot.mediaUrl,
      }
    : undefined,
  forwardedFrom: message.forwardedFrom?.originalSenderId
    ? {
        originalSenderId: message.forwardedFrom.originalSenderId.toString(),
        originalSenderName: message.forwardedFrom.originalSenderName,
        originalMessageId: message.forwardedFrom.originalMessageId.toString(),
        originalConversationId:
          message.forwardedFrom.originalConversationId.toString(),
      }
    : undefined,
});

export const toConversationListMessageDto = (
  message: ConversationPreviewMessageRecord,
): ConversationListMessageDto => ({
  id: message._id.toString(),
  senderId: message.sender.toString(),
  type: message.type,
  content: message.content,
  mediaUrl: message.mediaUrl,
  thumbnailUrl: message.thumbnailUrl,
  fileName: message.fileName,
  fileSize: message.fileSize,
  createdAt: message.createdAt.toISOString(),
});
