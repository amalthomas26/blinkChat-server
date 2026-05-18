import mongoose, { Types } from "mongoose";
import Message, { IMessage, MessageType } from "./message.model";
import Conversation from "../conversation/conversation.model";
import { ConversationParticipant } from "../conversation/conversationParticipant.model";
import { ApiError } from "../../utils/ApiError";
import { isValidObjectId } from "../../utils/objectId";
import {
  ensureConversationMembershipForUser,
  getConversationForUser,
} from "../conversation/conversation.service";
import {
  MessageDto,
  DeleteMessageResult,
  SendMessageInput,
  SendMessageResult,
  MEDIA_TYPES,
  SearchMessagesInput,
  SearchMessagesResult,
  ForwardMessageInput,
} from "./message.types";
import type { ConversationListMessageDto } from "../conversation/conversation.types";
import { runtimeConfig as config } from "../../config/env";
import { deleteFile } from "../upload/upload.service";
import { Block } from "../user/block.model";
import { User } from "../user/user.model";

type MarkDeliveredInput = {
  userId: string;
  conversationId: string;
  messageIds: string[];
};

type LeanMessage = {
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

type MessageRecord = LeanMessage | IMessage;

type ConversationPreviewMessageRecord = {
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

const toObjectId = (value: string, label: string) => {
  if (!isValidObjectId(value)) {
    throw new ApiError(400, `Invalid ${label}`);
  }
  return new Types.ObjectId(value);
};

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

const toMessageDtos = (messages: MessageRecord[]) => messages.map(toMessageDto);

const toConversationListMessageDto = (
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

const isDuplicateKeyError = (err: unknown): err is { code: number } =>
  typeof err === "object" &&
  err !== null &&
  "code" in err &&
  (err as { code?: number }).code === 11000;

const normalizeDeliveredInput = (input: MarkDeliveredInput) => {
  return {
    userId: input.userId,
    conversationId: input.conversationId,
    messageIds: [...new Set(input.messageIds)],
  };
};

const MAX_TEXT_LENGTH = 8000;
const MAX_MEDIA_URL_LENGTH = 500;

export const validateMessage = (data: SendMessageInput) => {
  const { type, content, mediaUrl, mediaPublicId } = data;

  if (!type) throw new ApiError(400, "Message type is required");

  if (type === MessageType.TEXT) {
    if (!content?.trim()) {
      throw new ApiError(400, "Text must have content");
    }
    if (content.length > MAX_TEXT_LENGTH) {
      throw new ApiError(
        400,
        `Message too long (max ${MAX_TEXT_LENGTH} characters)`,
      );
    }
    return;
  }
  if (!MEDIA_TYPES.includes(type as (typeof MEDIA_TYPES)[number]))
    throw new ApiError(400, "Invalid message type");

  if (!mediaUrl)
    throw new ApiError(400, "Media url is required for media messages");

  if (mediaUrl.length > MAX_MEDIA_URL_LENGTH)
    throw new ApiError(
      400,
      `
Media url too long (max ${MAX_MEDIA_URL_LENGTH} characters),
    `,
    );

  const cloudinaryBase = config.cloudinary.baseUrl;

  if (!mediaUrl.startsWith(cloudinaryBase))
    throw new ApiError(400, "Media url must be from the authorized CDN");

  if (!mediaPublicId?.trim())
    throw new ApiError(
      400,
      "Media public id is required when media url is present",
    );

  if (type === MessageType.AUDIO) {
    if (
      typeof data.audioDuration !== "number" ||
      !Number.isFinite(data.audioDuration) ||
      data.audioDuration <= 0
    ) {
      throw new ApiError(400, "Audio duration must be a positive number");
    }
  }
};

const findExistingMessageByClientTempId = async (
  sender: Types.ObjectId,
  conversationId: string,
  clientTempId: string,
) => {
  return Message.findOne({
    clientTempId,
    sender,
    conversation: conversationId,
  });
};

const persistMessageRecord = async (
  senderId: string,
  data: SendMessageInput,
) => {
  if (!isValidObjectId(senderId)) {
    throw new ApiError(400, "Invalid sender ID");
  }

  const {
    conversationId,
    content,
    type,
    mediaUrl,
    mediaPublicId,
    thumbnailUrl,
    fileName,
    fileSize,
    audioDuration,
    clientTempId,
    replyTo,
  } = data;

  if (!conversationId) throw new ApiError(400, "Conversation ID required");

  if (!isValidObjectId(conversationId)) {
    throw new ApiError(400, "Invalid conversation ID");
  }

  validateMessage(data);

  const conversation = await getConversationForUser(conversationId, senderId);
  const userObjectId = toObjectId(senderId, "sender ID");

  if (!conversation.isGroup) {
    const recipientId = conversation.participants.find(
      (p: { toString: () => string }) => p.toString() !== senderId,
    );

    if (recipientId) {
      const blockExists = await Block.exists({
        $or: [
          { blocker: recipientId, blocked: userObjectId },
          { blocker: userObjectId, blocked: recipientId },
        ],
      });

      if (blockExists)
        throw new ApiError(
          403,
          "Cannot send message. A block exists between the users.",
        );
    }
  }
  let replyToObjectId: Types.ObjectId | undefined;

  let replyToSnapshot:
    | {
        senderId: Types.ObjectId;
        type: MessageType;
        content?: string;
        mediaUrl?: string;
      }
    | undefined;

  if (replyTo) {
    if (!isValidObjectId(replyTo)) {
      throw new ApiError(400, "Invalid replyTo messageId");
    }

    const parent = await Message.findOne({
      _id: new Types.ObjectId(replyTo),
      conversation: conversation._id,
    })
      .select("sender type content mediaUrl  isDeleted")
      .lean();

    if (!parent)
      throw new ApiError(
        404,
        "Cannot reply:parent message not found in this conversation",
      );

    replyToObjectId = new Types.ObjectId(replyTo);
    replyToSnapshot = {
      senderId: parent.sender,
      type: parent.type,
      content: parent.isDeleted ? undefined : parent.content,
      mediaUrl: parent.isDeleted ? undefined : parent.mediaUrl,
    };
  }

  try {
    const message = await Message.create({
      conversation: conversation._id,
      sender: userObjectId,
      clientTempId,
      content,
      type,
      mediaUrl,
      mediaPublicId,
      thumbnailUrl,
      fileName,
      fileSize,
      audioDuration,
      replyTo: replyToObjectId ?? null,
      replyToSnapshot: replyToSnapshot,
      deliveredTo: [
        {
          userId: userObjectId,
          deliveredAt: new Date(),
        },
      ],
    });

    await Conversation.updateOne(
      { _id: conversation._id },
      {
        $set: {
          lastMessage: message._id,
          updatedAt: message.createdAt,
        },
      },
    );

    return {
      message,
      wasCreated: true,
    };
  } catch (err) {
    if (!clientTempId || !isDuplicateKeyError(err)) {
      throw err;
    }

    const existing = await findExistingMessageByClientTempId(
      userObjectId,
      conversationId,
      clientTempId,
    );

    if (!existing) {
      throw err;
    }

    return {
      message: existing,
      wasCreated: false,
    };
  }
};

export const sendMessage = async (
  senderId: string,
  data: SendMessageInput,
): Promise<SendMessageResult> => {
  const result = await persistMessageRecord(senderId, data);

  return {
    message: toMessageDto(result.message),
    wasCreated: result.wasCreated,
  };
};

export const fetchMessages = async (
  userId: string,
  conversationId: string,
  { before, limit = 20 }: { before?: string; limit?: number },
) => {
  if (!isValidObjectId(userId)) throw new ApiError(400, "Invalid user ID");
  if (!isValidObjectId(conversationId)) {
    throw new ApiError(400, "Invalid conversation ID");
  }

  if (before && !isValidObjectId(before))
    throw new ApiError(400, "Invalid cursor");

  const safeLimit = Math.max(1, Number(limit) || 20);

  await ensureConversationMembershipForUser(conversationId, userId);

  const query: Record<string, unknown> = {
    conversation: new Types.ObjectId(conversationId),
    isDeleted: false,
  };

  if (before) {
    query._id = { $lt: new Types.ObjectId(before) };
  }

  const messages = await Message.find(query)
    .sort({ _id: -1 })
    .limit(safeLimit + 1)
    .select(
      "_id conversation sender clientTempId content mediaUrl mediaPublicId thumbnailUrl fileName fileSize audioDuration type createdAt deliveredTo reactions replyTo replyToSnapshot forwardedFrom",
    )
    .lean<LeanMessage[]>();

  const hasNextPage = messages.length > safeLimit;

  return {
    messages: toMessageDtos(
      hasNextPage ? messages.slice(0, safeLimit) : messages,
    ),
    hasNextPage,
  };
};

export async function markMessagesDelivered(input: MarkDeliveredInput) {
  const { userId, conversationId, messageIds } = normalizeDeliveredInput(input);

  if (
    !isValidObjectId(userId) ||
    !isValidObjectId(conversationId) ||
    !Array.isArray(messageIds) ||
    messageIds.length === 0 ||
    messageIds.some((id) => !isValidObjectId(id))
  ) {
    throw new ApiError(400, "Invalid input");
  }

  const userObjectId = toObjectId(userId, "user ID");
  const conversationObjectId = toObjectId(conversationId, "conversation ID");
  const messageObjectIds = messageIds.map((id) => new Types.ObjectId(id));

  const isParticipant = await ConversationParticipant.exists({
    userId: userObjectId,
    conversationId: conversationObjectId,
  });

  if (!isParticipant) {
    throw new ApiError(403, "Unauthorized");
  }

  const result = await Message.updateMany(
    {
      _id: { $in: messageObjectIds },
      conversation: conversationObjectId,
      "deliveredTo.userId": { $ne: userObjectId },
    },
    {
      $addToSet: {
        deliveredTo: {
          userId: userObjectId,
          deliveredAt: new Date(),
        },
      },
    },
  );

  return {
    updatedCount: result.modifiedCount,
    messageIds,
  };
}

export const syncMessages = async (
  userId: string,
  conversationId: string,
  lastMessageId?: string,
  limit: number = 20,
) => {
  if (
    !isValidObjectId(userId) ||
    !isValidObjectId(conversationId) ||
    (lastMessageId !== undefined && !isValidObjectId(lastMessageId))
  ) {
    throw new ApiError(400, "Invalid input");
  }

  const userObjectId = toObjectId(userId, "user ID");
  const conversationObjectId = toObjectId(conversationId, "conversation ID");

  await ensureConversationMembershipForUser(conversationObjectId, userId);

  const query: Record<string, unknown> = {
    conversation: conversationObjectId,
    isDeleted: false,
  };

  if (lastMessageId) {
    query._id = { $gt: new Types.ObjectId(lastMessageId) };
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);

  const messages = await Message.find(query)
    .sort({ _id: 1 })
    .limit(safeLimit + 1)
    .select(
      "_id conversation sender clientTempId content mediaUrl mediaPublicId thumbnailUrl fileName fileSize audioDuration type createdAt deliveredTo reactions replyTo replyToSnapshot forwardedFrom",
    )
    .lean<LeanMessage[]>();

  const hasNextPage = messages.length > safeLimit;

  return {
    messages: toMessageDtos(
      hasNextPage ? messages.slice(0, safeLimit) : messages,
    ),
    hasNextPage,
  };
};

export const markConversationAsRead = async ({
  userId,
  conversationId,
  messageId,
}: {
  userId: string;
  conversationId: string;
  messageId: string;
}) => {
  if (
    !isValidObjectId(userId) ||
    !isValidObjectId(conversationId) ||
    !isValidObjectId(messageId)
  ) {
    throw new ApiError(400, "Invalid IDs");
  }

  const userObjectId = toObjectId(userId, "user ID");
  const conversationObjectId = toObjectId(conversationId, "conversation ID");
  const messageObjectId = new Types.ObjectId(messageId);

  const participant = await ConversationParticipant.findOne({
    userId: userObjectId,
    conversationId: conversationObjectId,
  }).select("lastSeenMessageId");

  if (!participant) throw new ApiError(403, "Unauthorized");

  const targetMessage = await Message.exists({
    _id: messageObjectId,
    conversation: conversationObjectId,
    isDeleted: false,
  });

  if (!targetMessage) {
    throw new ApiError(404, "Message not found");
  }

  const result = await ConversationParticipant.updateOne(
    {
      userId: userObjectId,
      conversationId: conversationObjectId,
      $or: [
        { lastSeenMessageId: null },
        { lastSeenMessageId: { $lt: messageObjectId } },
      ],
    },
    {
      $set: { lastSeenMessageId: messageObjectId },
    },
  );

  return {
    updated: result.modifiedCount > 0,
    conversationId,
    userId,
    lastSeenMessageId: messageId,
  };
};

const getCloudinaryResourceType = (
  type: MessageType,
): "image" | "video" | "raw" => {
  if (type === MessageType.IMAGE) return "image";
  if (type === MessageType.VIDEO || type === MessageType.AUDIO) return "video";
  return "raw";
};

export const deleteMessage = async (
  messageId: string,
  userId: string,
): Promise<DeleteMessageResult> => {
  if (!isValidObjectId(messageId))
    throw new ApiError(400, "Invalid message ID");
  if (!isValidObjectId(userId)) throw new ApiError(400, "Invalid user ID");

  const message = await Message.findById(messageId).lean();

  if (!message) throw new ApiError(404, "Message not found");

  if (message.sender.toString() !== userId)
    throw new ApiError(403, "You can only delete your own messages");

  if (message.isDeleted) throw new ApiError(400, "Message is already deleted");

  if (message.mediaPublicId) {
    try {
      await deleteFile(
        message.mediaPublicId,
        getCloudinaryResourceType(message.type),
      );
    } catch (err) {
      console.error(
        `[deleteMessage] Cloudinary deletion failed for publicId:
        ${message.mediaPublicId}
        `,
        err,
      );
    }
  }

  await Message.updateOne(
    { _id: messageId },
    {
      $set: {
        isDeleted: true,
        content: null,
        mediaUrl: null,
        mediaPublicId: null,
        thumbnailUrl: null,
        fileName: null,
      },
    },
  );

  const conversationId = message.conversation.toString();

  const conversation = await Conversation.findById(conversationId)
    .select("lastMessage")
    .lean();

  let lastMessageChanged = false;
  let lastMessage: ConversationListMessageDto | null = null;
  const updatedAt = new Date().toISOString();

  if (conversation?.lastMessage?.toString() === messageId) {
    const previousMessage = await Message.findOne({
      conversation: message.conversation,
      isDeleted: false,
      _id: { $ne: messageId },
    })
      .sort({ _id: -1 }) //newest first
      .select(
        "_id sender type content mediaUrl thumbnailUrl fileName fileSize createdAt",
      )
      .lean<ConversationPreviewMessageRecord | null>();

    await Conversation.updateOne(
      { _id: conversationId },
      { $set: { lastMessage: previousMessage?._id ?? null } },
    );

    lastMessageChanged = true;
    lastMessage = previousMessage
      ? toConversationListMessageDto(previousMessage)
      : null;
  }

  return {
    messageId,
    conversationId,
    deletedMessageSenderId: message.sender.toString(),
    lastMessageChanged,
    lastMessage,
    updatedAt,
  };
};

export const reactToMessage = async (
  messageId: string,
  userId: string,
  emoji: string,
): Promise<void> => {
  if (!isValidObjectId(messageId)) throw new ApiError(400, "Invalid messageId");

  if (!isValidObjectId(userId)) throw new ApiError(400, "Invalid userId");

  if (!emoji || [...emoji].length > 2) throw new ApiError(400, "Invalid emoji");

  const userObjectId = new mongoose.Types.ObjectId(userId);
  const messageObjectId = new mongoose.Types.ObjectId(messageId);

  const messageExists = await Message.exists({
    _id: messageObjectId,
    isDeleted: false,
  });

  if (!messageExists) throw new ApiError(404, "Message not found or deleted");

  await Message.updateOne(
    { _id: messageObjectId },
    { $pull: { reactions: { userId: userObjectId } } },
  );

  await Message.updateOne(
    { _id: messageObjectId },
    { $push: { reactions: { userId: userObjectId, emoji } } },
  );
};

export const removeReaction = async (
  messageId: string,
  userId: string,
): Promise<void> => {
  if (!isValidObjectId(messageId)) throw new ApiError(400, "Invalid messageId");

  if (!isValidObjectId(userId)) throw new ApiError(400, "Invalid userId");

  const userObjectId = new mongoose.Types.ObjectId(userId);
  const messageObjectId = new mongoose.Types.ObjectId(messageId);

  const result = await Message.updateOne(
    { _id: messageObjectId, isDeleted: false },
    {
      $pull: { reactions: { userId: userObjectId } },
    },
  );

  if (result.matchedCount === 0)
    throw new ApiError(404, "message not found or already deleted");
};

export const searchMessages = async (
  userId: string,
  conversationId: string,
  input: SearchMessagesInput,
): Promise<SearchMessagesResult> => {
  if (!isValidObjectId(userId)) throw new ApiError(400, "Invalid user ID");

  if (!isValidObjectId(conversationId))
    throw new ApiError(400, "Invalid conversation ID");

  const trimmedQuery = input.query?.trim();

  if (!trimmedQuery || trimmedQuery.length < 2)
    throw new ApiError(400, "Search query must be at least 2 characters");

  if (trimmedQuery.length > 200)
    throw new ApiError(400, "Search query too long(max 200 characters)");

  if (input.before && !isValidObjectId(input.before))
    throw new ApiError(400, "Invalid cursor");

  await ensureConversationMembershipForUser(conversationId, userId);

  const safeLimit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);

  const filter: Record<string, unknown> = {
    conversation: new Types.ObjectId(conversationId),
    isDeleted: false,
    $text: { $search: trimmedQuery },
  };

  //Cursor-based pagination: fetch messages older than the cursor
  if (input.before) {
    filter._id = { $lt: new Types.ObjectId(input.before) };
  }

  const messages = await Message.find(filter)
    .sort({ _id: 1 })
    .limit(safeLimit + 1)
    .select(
      "_id conversation sender clientTempId content mediaUrl mediaPublicId thumbnailUrl fileName fileSize audioDuration type createdAt deliveredTo reactions replyTo replyToSnapshot",
    )
    .lean<LeanMessage[]>();

  const hasNextPage = messages.length > safeLimit;

  return {
    messages: toMessageDtos(
      hasNextPage ? messages.slice(0, safeLimit) : messages,
    ),
    hasNextPage,
  };
};

export const forwardMessage = async (
  userId: string,
  input: ForwardMessageInput,
): Promise<SendMessageResult> => {
  if (!isValidObjectId(userId)) throw new ApiError(400, "Invalid user ID");

  if (!isValidObjectId(input.sourceMessageId))
    throw new ApiError(400, "Invalid source message ID");

  if (!isValidObjectId(input.targetConversationId))
    throw new ApiError(400, "Invalid target conversation ID");

  const userObjectId = toObjectId(userId, "user ID");

  const originalMessage = await Message.findById(input.sourceMessageId)
    .select(
      "conversation sender content type mediaUrl mediaPublicId thumbnailUrl fileName fileSize audioDuration isDeleted",
    )
    .lean();

  if (!originalMessage) throw new ApiError(404, "Original message not found");

  if (originalMessage.isDeleted)
    throw new ApiError(400, "Cannot forward a deleted message");

  await ensureConversationMembershipForUser(
    originalMessage.conversation.toString(),
    userId,
  );

  const targetConversation = await getConversationForUser(
    input.targetConversationId,
    userId,
  );

  if (!targetConversation.isGroup) {
    const recipientId = targetConversation.participants.find(
      (p: { toString: () => string }) => p.toString() !== userId,
    );
    if (recipientId) {
      const blockExists = await Block.exists({
        $or: [
          { blocker: recipientId, blocked: userObjectId },
          { blocker: userObjectId, blocked: recipientId },
        ],
      });
      if (blockExists)
        throw new ApiError(
          403,
          "Cannot forward to this conversation.A block exists.",
        );
    }
  }
  const originalSender = await User.findById(originalMessage.sender)
    .select("name")
    .lean();

  const originalSenderName = originalSender?.name ?? "Deleted User";

  const forwardedMsg = await Message.create({
    conversation: targetConversation._id,
    sender: userObjectId,
    content: originalMessage.content,
    type: originalMessage.type,
    mediaUrl: originalMessage.mediaUrl,
    mediaPublicId: originalMessage.mediaPublicId,
    thumbnailUrl: originalMessage.thumbnailUrl,
    fileName: originalMessage.fileName,
    fileSize: originalMessage.fileSize,
    audioDuration: originalMessage.audioDuration,
    forwardedFrom: {
      originalSenderId: originalMessage.sender,
      originalSenderName,
      originalMessageId: originalMessage._id,
      originalConversationId: originalMessage.conversation,
    },
    deliveredTo: [{ userId: userObjectId, deliveredAt: new Date() }],
  });

  await Conversation.updateOne(
    { _id: targetConversation._id },
    {
      $set: {
        lastMessage: forwardedMsg._id,
        updatedAt: forwardedMsg.createdAt,
      },
    },
  );

  return {
    message: toMessageDto(forwardedMsg),
    wasCreated: true,
  };
};

/**
 * Called when a call ends. Creates a "call" type message in the shared
 * direct conversation so it appears in the chat thread as a call log.
 * Returns null silently if no conversation exists.
 */
export const createCallLogMessage = async (input: {
  callerId: string;
  receiverId: string;
  callType: "audio" | "video";
  status: "ended" | "missed" | "rejected" | "cancelled" | "failed";
  duration: number | null;
}): Promise<{
  message: MessageDto;
  conversationId: string;
  participantIds: string[];
} | null> => {
  try {
    const { callerId, receiverId, callType, status, duration } = input;

    const conversation = await Conversation.findOne({
      isGroup: false,
      participants: {
        $all: [new Types.ObjectId(callerId), new Types.ObjectId(receiverId)],
      },
    }).lean();

    if (!conversation) return null;

    const conversationId = conversation._id.toString();
    const callerObjectId = new Types.ObjectId(callerId);

    const durationStr =
      duration && duration > 0
        ? ` · ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}`
        : "";
    const callLabel = callType === "video" ? "Video" : "Voice";

    const content =
      status === "ended"
        ? `${callLabel} call${durationStr}`
        : status === "missed"
          ? `Missed ${callLabel.toLowerCase()} call`
          : status === "rejected"
            ? `${callLabel} call declined`
            : status === "cancelled"
              ? `${callLabel} call cancelled`
              : `${callLabel} call failed`;

    const message = await Message.create({
      conversation: conversation._id,
      sender: callerObjectId,
      type: MessageType.CALL,
      content,
      callMeta: { callType, status, duration },
      deliveredTo: [{ userId: callerObjectId, deliveredAt: new Date() }],
    });

    await Conversation.updateOne(
      { _id: conversation._id },
      { $set: { lastMessage: message._id, updatedAt: message.createdAt } },
    );

    return {
      message: toMessageDto(message),
      conversationId,
      participantIds: [callerId, receiverId],
    };
  } catch (err) {
    console.error("[createCallLogMessage] failed:", err);
    return null;
  }
};

