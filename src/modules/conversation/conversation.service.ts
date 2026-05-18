import mongoose, { ClientSession, Types } from "mongoose";
import Conversation, { IConversation } from "./conversation.model";
import { ConversationParticipant } from "./conversationParticipant.model";
import { ApiError } from "../../utils/ApiError";
import { MessageType } from "../message/message.model";
import Message from "../message/message.model";
import { MessageDto } from "../message/message.types";
import { toMessageDto } from "../message/message.service";
import { User } from "../user/user.model";
import { isValidObjectId } from "../../utils/objectId";
import {
  ConversationListItemDto,
  ConversationListMessageDto,
  ConversationListUserDto,
  CreateGroupInput,
  PaginatedConversationListDto,
} from "./conversation.types";
import { runtimeConfig as config } from "../../config/env";
import { deleteFile } from "../upload/upload.service";
import { Block } from "../user/block.model";

type PopulatedConversationUser = {
  _id: Types.ObjectId;
  name: string;
  avatar?: string;
  status?: "online" | "offline" | "away";
  lastSeen?: Date | null;
};

type PopulatedConversationMessage = {
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

type PopulatedConversationRecord = {
  _id: Types.ObjectId;
  isGroup: boolean;
  groupName?: string;
  groupDescription?: string;
  groupAvatar?: string | null;
  maxParticipants?: number;
  lastMessage?: PopulatedConversationMessage | null;
  updatedAt: Date;
};

type ConversationMembershipRecord = {
  conversationId: PopulatedConversationRecord | null;
  lastSeenMessageId?: Types.ObjectId | null;
};

type AggregatedParticipantRow = {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  lastSeenMessageId?: Types.ObjectId | null;
  isPinned: boolean;
  pinnedAt: Date | null;
  isMuted: boolean;
  mutedUntill: Date | null;
  conversation: PopulatedConversationRecord;
};
type CursorPayload = {
  isPinned: boolean;
  pinnedAt: string | null;
  updatedAt: string;
  id: string;
};

type ConversationMembershipAccessRecord = {
  conversationId: Types.ObjectId;
  lastSeenMessageId?: Types.ObjectId | null;
  isPinned: boolean;
  pinnedAt: Date | null;
  isMuted: boolean;
  mutedUntill: Date | null;
};

type ParticipantMembershipRecord = {
  conversationId: Types.ObjectId;
  userId: PopulatedConversationUser | null;
};

const withOptionalSession = <T>(
  query: mongoose.Query<T, any>,
  session?: ClientSession,
) => (session ? query.session(session) : query);

const toConversationUserDto = (
  participant: PopulatedConversationUser,
): ConversationListUserDto => ({
  id: participant._id.toString(),
  name: participant.name,
  avatar: participant.avatar ?? "",
  status: participant.status,
  lastSeen: participant.lastSeen ? participant.lastSeen.toISOString() : null,
});

const toConversationMessageDto = (
  message: PopulatedConversationMessage,
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

const resolveConversationName = ({
  isGroup,
  groupName,
  participants,
  peer,
  currentUserId,
}: {
  isGroup: boolean;
  groupName?: string;
  participants: ConversationListUserDto[];
  peer: ConversationListUserDto | null;
  currentUserId: string;
}) => {
  if (!isGroup) {
    return peer?.name ?? null;
  }

  if (groupName?.trim()) {
    return groupName.trim();
  }

  const otherParticipantNames = participants
    .filter((participant) => participant.id !== currentUserId)
    .map((participant) => participant.name);

  return otherParticipantNames.length > 0
    ? otherParticipantNames.join(", ")
    : "Unnamed group";
};

const hasUnreadLastMessage = ({
  lastMessage,
  lastSeenMessageId,
  currentUserId,
}: {
  lastMessage: ConversationListMessageDto | null;
  lastSeenMessageId?: Types.ObjectId | null;
  currentUserId: string;
}) => {
  if (!lastMessage) {
    return false;
  }

  if (lastMessage.senderId === currentUserId) {
    return false;
  }

  if (!lastSeenMessageId) {
    return true;
  }

  return lastSeenMessageId.toString() !== lastMessage.id;
};

export const startConversation = async (
  userId: string,
  receiverId: string,
): Promise<IConversation> => {
  if (!isValidObjectId(userId)) throw new ApiError(400, "Invalid userId");

  if (!isValidObjectId(receiverId))
    throw new ApiError(400, "Invalid receiverId");

  if (userId === receiverId)
    throw new ApiError(400, "Cannot start conversation with yourself");

  const blockExists = await Block.exists({
    $or: [
      { blocker: userId, blocked: receiverId },
      { blocker: receiverId, blocked: userId },
    ],
  });

  if (blockExists)
    throw new ApiError(
      403,
      "Cannot start conversation. A block exists between the users.",
    );

  const userObj = new mongoose.Types.ObjectId(userId);
  const recvObj = new mongoose.Types.ObjectId(receiverId);

  const participants = [userObj, recvObj].sort((a, b) =>
    a.toString().localeCompare(b.toString()),
  );

  let conversation = await Conversation.findOne({
    participants,
    isGroup: false,
  });

  if (conversation) return conversation;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    conversation = await Conversation.create(
      [
        {
          participants,
          isGroup: false,
        },
      ],
      { session },
    ).then((res) => res[0]);

    const bulkOps = participants.map((userId) => ({
      updateOne: {
        filter: {
          conversationId: conversation!._id,
          userId,
        },
        update: {
          $setOnInsert: {
            conversationId: conversation!._id,
            userId,
            lastSeenMessageId: null,
          },
        },
        upsert: true,
      },
    }));

    await ConversationParticipant.bulkWrite(bulkOps, { session });

    await session.commitTransaction();
    session.endSession();

    if (!conversation) {
      throw new ApiError(500, "Failed to create conversation");
    }

    return conversation;
  } catch (err: unknown) {
    await session.abortTransaction();
    session.endSession();

    if (
      err instanceof Error &&
      "code" in err &&
      (err as { code?: number }).code === 11000
    ) {
      const existing = await Conversation.findOne({
        participants,
        isGroup: false,
      });

      if (existing) return existing;
    }

    throw err;
  }
};

export const getConversationForUser = async (
  conversationId: string,
  userId: string,
  session?: ClientSession,
) => {
  if (!isValidObjectId(conversationId))
    throw new ApiError(404, "Invalid conversationId");
  if (!isValidObjectId(userId)) throw new ApiError(400, "Invalid userId");

  const conversationObjectId = new mongoose.Types.ObjectId(conversationId);

  await ensureConversationMembershipForUser(
    conversationObjectId,
    userId,
    session,
  );

  const conversation = await withOptionalSession(
    Conversation.findById(conversationObjectId),
    session,
  );

  if (!conversation) throw new ApiError(404, "conversation not found");

  return conversation;
};

export const ensureConversationMembershipForUser = async (
  conversationId: string | Types.ObjectId,
  userId: string,
  session?: ClientSession,
): Promise<ConversationMembershipAccessRecord> => {
  if (!isValidObjectId(conversationId))
    throw new ApiError(404, "Invalid conversationId");
  if (!isValidObjectId(userId)) throw new ApiError(400, "Invalid userId");

  const conversationObjectId =
    typeof conversationId === "string"
      ? new mongoose.Types.ObjectId(conversationId)
      : conversationId;
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const membership = await withOptionalSession(
    ConversationParticipant.findOne({
      conversationId: conversationObjectId,
      userId: userObjectId,
    }).select(
      "conversationId lastSeenMessageId isPinned pinnedAt isMuted mutedUntill",
    ),
    session,
  ).lean<ConversationMembershipAccessRecord | null>();

  if (membership) {
    return membership;
  }

  const conversationExists = await withOptionalSession(
    Conversation.exists({ _id: conversationObjectId }),
    session,
  );

  if (!conversationExists) {
    throw new ApiError(404, "conversation not found");
  }

  throw new ApiError(403, "User is not a participant in this conversation");
};

export const listConversationsForUser = async (
  userId: string,
  options?: { limit?: number; cursor?: string },
): Promise<PaginatedConversationListDto> => {
  if (!isValidObjectId(userId)) {
    throw new ApiError(400, "Invalid userId");
  }

  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 50);
  const cursor = options?.cursor;

  let cursorDate: Date | null = null;
  let cursorId: mongoose.Types.ObjectId | null = null;
  let cursorIsPinned: boolean | null = null;
  let cursorPinnedAt: Date | null = null;

  if (cursor !== undefined) {
    try {
      const decoded = JSON.parse(
        Buffer.from(cursor, "base64").toString("utf8"),
      ) as CursorPayload;
      cursorDate = new Date(decoded.updatedAt);
      cursorId = new mongoose.Types.ObjectId(decoded.id);
      cursorIsPinned = decoded.isPinned;
      cursorPinnedAt = decoded.pinnedAt ? new Date(decoded.pinnedAt) : null;

      if (isNaN(cursorDate.getTime())) {
        throw new Error("bad date");
      }
    } catch {
      throw new ApiError(400, "Invalid cursor");
    }
  }

  const userObjectId = new mongoose.Types.ObjectId(userId);

  const pipeline: mongoose.PipelineStage[] = [
    {
      $match: { userId: userObjectId },
    },
    {
      $lookup: {
        from: "conversations",
        localField: "conversationId",
        foreignField: "_id",
        as: "conversation",
      },
    },
    {
      $unwind: {
        path: "$conversation",
        preserveNullAndEmptyArrays: false,
      },
    },
    {
      $lookup: {
        from: "messages",
        localField: "conversation.lastMessage",
        foreignField: "_id",
        as: "lastMessageDoc",
      },
    },
    {
      $unwind: {
        path: "$lastMessageDoc",
        preserveNullAndEmptyArrays: true,
      },
    },
    ...(cursorDate && cursorId && cursorIsPinned !== null
      ? [
          {
            $match: {
              $or: [
                ...(cursorIsPinned
                  ? [
                      { isPinned: false }, // if cursor was pinned, we naturally select all unpinned since they come after
                      {
                        isPinned: true,
                        pinnedAt: { $lt: cursorPinnedAt ?? new Date(0) },
                      },
                      {
                        isPinned: true,
                        pinnedAt: cursorPinnedAt ?? new Date(0),
                        "conversation.updatedAt": { $lt: cursorDate },
                      },
                      {
                        isPinned: true,
                        pinnedAt: cursorPinnedAt ?? new Date(0),
                        "conversation.updatedAt": cursorDate,
                        _id: { $lt: cursorId },
                      },
                    ]
                  : [
                      // cursor was NOT pinned — no pinned rows possible after this point
                      {
                        isPinned: false,
                        "conversation.updatedAt": { $lt: cursorDate },
                      },
                      {
                        isPinned: false,
                        "conversation.updatedAt": cursorDate,
                        _id: { $lt: cursorId },
                      },
                    ]),
              ],
            },
          } satisfies mongoose.PipelineStage,
        ]
      : []),

    {
      $sort: {
        isPinned: -1,
        pinnedAt: -1,
        "conversation.updatedAt": -1,
        _id: -1,
      },
    },
    {
      $limit: limit + 1,
    },
    {
      $lookup: {
        from: "messages",
        let: {
          convId: "$conversationId",
          lastSeen: "$lastSeenMessageId",
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$conversation", "$$convId"] },
                  { $ne: ["$sender", userObjectId] },
                  { $eq: ["$isDeleted", false] },

                  {
                    $or: [
                      { $eq: [{ $type: "$$lastSeen" }, "missing"] },
                      { $eq: ["$$lastSeen", null] },
                      { $gt: ["$_id", "$$lastSeen"] },
                    ],
                  },
                ],
              },
            },
          },
          { $count: "n" },
        ],
        as: "unreadDocs",
      },
    },
  ];

  type RowWithLookup = AggregatedParticipantRow & {
    lastMessageDoc?: PopulatedConversationMessage | null;
    unreadDocs?: { n: number }[];
  };
  const rawRows =
    await ConversationParticipant.aggregate<RowWithLookup>(pipeline);

  const hasNextPage = rawRows.length > limit;
  const pageRows = hasNextPage ? rawRows.slice(0, limit) : rawRows;

  if (pageRows.length === 0) {
    return { conversations: [], hasNextPage: false, nextCursor: null };
  }

  const lastRow = pageRows[pageRows.length - 1];

  const nextCursor = hasNextPage
    ? Buffer.from(
        JSON.stringify({
          isPinned: lastRow.isPinned,
          pinnedAt: lastRow.pinnedAt ? lastRow.pinnedAt.toISOString() : null,
          updatedAt: lastRow.conversation.updatedAt.toISOString(),
          id: lastRow._id.toString(),
        } satisfies CursorPayload),
        "utf8",
      ).toString("base64")
    : null;
  const conversationIds = pageRows.map((row) => row.conversationId);

  const participantMemberships = await ConversationParticipant.find({
    conversationId: { $in: conversationIds },
  })
    .select("conversationId userId")
    .populate<{ userId: PopulatedConversationUser | null }>({
      path: "userId",
      select: "_id name avatar status lastSeen",
    })
    .lean<ParticipantMembershipRecord[]>();

  const participantsByConversation = participantMemberships.reduce(
    (grouped, membership) => {
      if (!membership.userId) {
        return grouped;
      }

      const conversationKey = membership.conversationId.toString();
      const existingParticipants = grouped.get(conversationKey) ?? [];

      existingParticipants.push(toConversationUserDto(membership.userId));
      grouped.set(conversationKey, existingParticipants);

      return grouped;
    },
    new Map<string, ConversationListUserDto[]>(),
  );

  const conversations = pageRows.map((row) => {
    const conversation = row.conversation;

    const participants =
      participantsByConversation
        .get(conversation._id.toString())
        ?.sort(
          (left, right) =>
            left.name.localeCompare(right.name) ||
            left.id.localeCompare(right.id),
        ) ?? [];

    const peer = conversation.isGroup
      ? null
      : (participants.find((participant) => participant.id !== userId) ?? null);

    const actualLastMessage = row.lastMessageDoc ?? null;
    const lastMessage = actualLastMessage
      ? toConversationMessageDto(actualLastMessage)
      : null;

    return {
      id: conversation._id.toString(),
      type: conversation.isGroup ? ("group" as const) : ("direct" as const),
      name: resolveConversationName({
        isGroup: conversation.isGroup,
        groupName: conversation.groupName,
        participants,
        peer,
        currentUserId: userId,
      }),
      groupDescription: conversation.groupDescription ?? null,
      groupAvatar: conversation.groupAvatar ?? null,
      maxParticipants: conversation.maxParticipants,
      peer,
      participants,
      lastMessage,
      unread: {
        hasUnread: hasUnreadLastMessage({
          lastMessage,
          lastSeenMessageId: row.lastSeenMessageId,
          currentUserId: userId,
        }),
        lastSeenMessageId: row.lastSeenMessageId
          ? row.lastSeenMessageId.toString()
          : null,
        unreadCount: row.unreadDocs?.[0]?.n ?? 0,
      },
      isPinned: row.isPinned ?? false,
      isMuted: isCurrentlyMuted(row) ? true : false,
      mutedUntill:
        row.isMuted && row.mutedUntill ? row.mutedUntill.toISOString() : null,
      updatedAt: conversation.updatedAt.toISOString(),
    } satisfies ConversationListItemDto;
  });

  return { conversations, hasNextPage, nextCursor };
};

export const getConversationDetails = async (
  conversationId: string,
  userId: string,
): Promise<ConversationListItemDto> => {
  if (!isValidObjectId(conversationId))
    throw new ApiError(400, "invalid conversationId");
  if (!isValidObjectId(userId)) throw new ApiError(400, "Invalid userId");

  const membership = await ensureConversationMembershipForUser(
    conversationId,
    userId,
  );

  const conversation = await Conversation.findById(conversationId)
    .select(
      "isGroup groupName groupAvatar groupDescription maxParticipants lastMessage updatedAt",
    )
    .populate<{ lastMessage: PopulatedConversationMessage | null }>({
      path: "lastMessage",
      select:
        "_id sender type content mediaUrl thumbnailUrl fileName fileSize createdAt",
    })
    .lean<PopulatedConversationRecord>();

  if (!conversation) throw new ApiError(404, "Conversation not found");

  const participantRows = await ConversationParticipant.find({
    conversationId: conversation._id,
  })
    .select("conversationId userId")
    .populate<{ userId: PopulatedConversationUser | null }>({
      path: "userId",
      select: "_id name avatar status lastSeen",
    })
    .lean<ParticipantMembershipRecord[]>();

  const participants: ConversationListUserDto[] = participantRows
    .filter(
      (
        row,
      ): row is ParticipantMembershipRecord & {
        userId: PopulatedConversationUser;
      } => row.userId !== null,
    )
    .map((row) => toConversationUserDto(row.userId))
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
  const peer = conversation.isGroup
    ? null
    : (participants.find((p) => p.id !== userId) ?? null);

  const lastMessage = conversation.lastMessage
    ? toConversationMessageDto(conversation.lastMessage)
    : null;

  return {
    id: conversation._id.toString(),
    type: conversation.isGroup ? "group" : "direct",
    name: resolveConversationName({
      isGroup: conversation.isGroup,
      groupName: conversation.groupName,
      participants,
      peer,
      currentUserId: userId,
    }),
    groupDescription: conversation.groupDescription ?? null,
    groupAvatar: conversation.groupAvatar ?? null,
    maxParticipants: conversation.maxParticipants,
    peer,
    participants,
    lastMessage,
    unread: {
      hasUnread: hasUnreadLastMessage({
        lastMessage,
        lastSeenMessageId: membership.lastSeenMessageId,
        currentUserId: userId,
      }),
      lastSeenMessageId: membership.lastSeenMessageId
        ? membership.lastSeenMessageId.toString()
        : null,
      unreadCount: 0,
    },
    isPinned: membership.isPinned ?? false,
    isMuted: isCurrentlyMuted(membership) ? true : false,
    mutedUntill:
      membership.isMuted && membership.mutedUntill
        ? membership.mutedUntill.toISOString()
        : null,
    updatedAt: conversation.updatedAt.toISOString(),
  };
};

export const createGroupConversation = async (
  creatorId: string,
  input: CreateGroupInput,
): Promise<ConversationListItemDto> => {
  if (!isValidObjectId(creatorId)) throw new ApiError(400, "Invalid creatorId");

  const trimmedName = input.name?.trim();

  if (!trimmedName) throw new ApiError(400, "Group name is required");

  if (trimmedName.length > 50)
    throw new ApiError(400, "group name must be 50 characters or fewer");

  if (!Array.isArray(input.participantIds) || input.participantIds.length < 2)
    throw new ApiError(
      400,
      "participantIds must be an array with at least 2 members",
    );

  for (const id of input.participantIds) {
    if (!isValidObjectId(id))
      throw new ApiError(400, "One or more participantIds are invalid");
  }
  const deduplicatedIds = [
    ...new Set(input.participantIds.filter((id) => id !== creatorId)),
  ];

  const maxAllowed = 256;
  const totalParticipants = deduplicatedIds.length + 1;

  if (totalParticipants < 3)
    throw new ApiError(
      400,
      "Group must have at least 3 participants (including you)",
    );

  if (totalParticipants > maxAllowed)
    throw new ApiError(400, `Group cannot exceed ${maxAllowed} participants`);

  if (input.groupAvatar !== undefined) {
    if (
      !config.cloudinary.baseUrl ||
      !input.groupAvatar.startsWith(config.cloudinary.baseUrl)
    )
      throw new ApiError(400, "Invalid group avatar url");

    if (!input.groupAvatarPublicId)
      throw new ApiError(
        400,
        "groupAvatarPublicId is required when groupAvatar is provided",
      );
  }

  const participantObjectIds = deduplicatedIds.map(
    (id) => new mongoose.Types.ObjectId(id),
  );

  const foundUsers = await User.find({
    _id: { $in: participantObjectIds },
  }).select("_id");

  if (foundUsers.length !== participantObjectIds.length)
    throw new ApiError(400, "One or more participants not found");

  const creatorObjectId = new mongoose.Types.ObjectId(creatorId);
  const allParticipantIds = [creatorObjectId, ...participantObjectIds];

  const session = await mongoose.startSession();
  session.startTransaction();

  let newConversationId: Types.ObjectId;

  try {
    const [conversation] = await Conversation.create(
      [
        {
          participants: allParticipantIds,
          isGroup: true,
          groupName: trimmedName,
          groupDescription: input.description?.trim() || undefined,
          groupAvatar: input.groupAvatar ?? null,
          groupAvatarPublicId: input.groupAvatarPublicId ?? null,
          groupAdmin: creatorObjectId,
        },
      ],
      { session },
    );

    newConversationId = conversation._id as Types.ObjectId;

    const bulkOps = allParticipantIds.map((participantId) => ({
      updateOne: {
        filter: {
          conversationId: newConversationId,
          userId: participantId,
        },
        update: {
          $setOnInsert: {
            conversationId: newConversationId,
            userId: participantId,
            lastSeenMessageId: null,
            role: (participantId.equals(creatorObjectId)
              ? "admin"
              : "member") as "admin" | "member",
          },
        },
        upsert: true,
      },
    }));

    await ConversationParticipant.bulkWrite(bulkOps, { session });

    await session.commitTransaction();
  } catch (err: unknown) {
    await session.abortTransaction();

    if (
      err instanceof Error &&
      "code" in err &&
      (err as { code?: number }).code === 11000
    )
      throw new ApiError(
        500,
        "Group creation failed due to a conflict.please try again",
      );
    throw err;
  } finally {
    session.endSession();
  }

  return getConversationDetails(newConversationId.toString(), creatorId);
};

const ensureGroupAdmin = async (
  conversationId: Types.ObjectId,
  userId: string,
  session?: ClientSession,
): Promise<void> => {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const adminRecord = await withOptionalSession(
    ConversationParticipant.findOne({
      conversationId,
      userId: userObjectId,
      role: "admin",
    }).select("_id"),
    session,
  ).lean();

  if (!adminRecord) {
    throw new ApiError(403, "Only group admins can perform this action");
  }
};

export const addGroupMember = async (
  conversationId: string,
  adminId: string,
  newMemberIds: string[],
): Promise<ConversationListUserDto[]> => {
  if (!isValidObjectId(conversationId))
    throw new ApiError(400, "Invalid conversationId");

  if (!isValidObjectId(adminId)) throw new ApiError(400, "Invalid adminId");

  if (!Array.isArray(newMemberIds) || newMemberIds.length === 0)
    throw new ApiError(400, "Atleast one userId is required");

  if (newMemberIds.length > 50)
    throw new ApiError(400, "Cannot add more than 50 members at at once");

  for (const id of newMemberIds) {
    if (!isValidObjectId(id)) throw new ApiError(400, `Invalid userId:${id}`);
  }

  const deduplicatedIds = [...new Set(newMemberIds)];

  const conversationObjectId = new mongoose.Types.ObjectId(conversationId);

  await ensureGroupAdmin(conversationObjectId, adminId);

  const conversation = await Conversation.findById(conversationObjectId)
    .select("isGroup maxParticipants")
    .lean<{ isGroup: boolean; maxParticipants: number }>();

  if (!conversation) throw new ApiError(404, "Conversation not found");

  if (!conversation.isGroup)
    throw new ApiError(400, "cannot add members to a 1-1 conversation");

  const currentCount = await ConversationParticipant.countDocuments({
    conversationId: conversationObjectId,
  });

  if (currentCount + deduplicatedIds.length > conversation.maxParticipants)
    throw new ApiError(
      400,
      `Adding ${deduplicatedIds.length} members would exceed the group limit of ${conversation.maxParticipants}`,
    );

  const newMemberObjectIds = deduplicatedIds.map(
    (id) => new mongoose.Types.ObjectId(id),
  );

  const foundUsers = await User.find({ _id: { $in: newMemberObjectIds } })
    .select("_id name avatar status lastSeen")
    .lean<PopulatedConversationUser[]>();

  if (foundUsers.length !== newMemberObjectIds.length)
    throw new ApiError(400, "One or more users not found");

  const existingMembers = await ConversationParticipant.find({
    conversationId: conversationObjectId,
    userId: { $in: newMemberObjectIds },
  })
    .select("userId")
    .lean<{ userId: mongoose.Types.ObjectId }[]>();

  if (existingMembers.length > 0) {
    const alreadyInIds = existingMembers.map((m) => m.userId.toString());
    throw new ApiError(
      409,
      `${alreadyInIds.length} user(s) are already members of this group`,
    );
  }

  await ConversationParticipant.insertMany(
    newMemberObjectIds.map((userId) => ({
      conversationId: conversationObjectId,
      userId,
      lastSeenMessageId: null,
      role: "member" as const,
    })),
  );

  return foundUsers.map(toConversationUserDto);
};

export const removeGroupMember = async (
  conversationId: string,
  adminId: string,
  memberIds: string[],
): Promise<void> => {
  if (!isValidObjectId(conversationId))
    throw new ApiError(400, "Invalid conversationId");

  if (!isValidObjectId(adminId)) throw new ApiError(400, "Invalid adminId");

  if (!Array.isArray(memberIds) || memberIds.length === 0)
    throw new ApiError(400, "At least one memberId is required");

  if (memberIds.length > 50)
    throw new ApiError(400, "Cannot remove more than 50 members at once");

  for (const id of memberIds) {
    if (!isValidObjectId(id))
      throw new ApiError(400, `Invalid memberId: ${id}`);
  }

  const deduplicatedIds = [...new Set(memberIds)];

  if (deduplicatedIds.includes(adminId))
    throw new ApiError(
      400,
      "Admin cannot remove themselves — use leave group instead",
    );

  const conversationObjectId = new mongoose.Types.ObjectId(conversationId);

  await ensureGroupAdmin(conversationObjectId, adminId);

  await ensureGroupAdmin(conversationObjectId, adminId);

  const memberObjectIds = deduplicatedIds.map(
    (id) => new mongoose.Types.ObjectId(id),
  );

  const result = await ConversationParticipant.deleteMany({
    conversationId: conversationObjectId,
    userId: { $in: memberObjectIds },
  });

  if (result.deletedCount === 0)
    throw new ApiError(
      404,
      "None of the specified members were found in this group",
    );
};

export const renameGroup = async (
  conversationId: string,
  adminId: string,
  newName: string,
): Promise<void> => {
  if (!isValidObjectId(conversationId))
    throw new ApiError(400, "Invalid conversationId");

  if (!isValidObjectId(adminId)) throw new ApiError(400, "Invalid adminId");

  const trimmedName = newName?.trim();

  if (!trimmedName) throw new ApiError(400, "Group name is required");

  if (trimmedName.length > 50)
    throw new ApiError(400, "Group name must be 50 characters or fewer");

  const conversationObjectId = new mongoose.Types.ObjectId(conversationId);

  await ensureGroupAdmin(conversationObjectId, adminId);

  const result = await Conversation.updateOne(
    { _id: conversationObjectId, isGroup: true },
    { $set: { groupName: trimmedName } },
  );
  if (result.matchedCount === 0)
    throw new ApiError(404, "Conversation not found or not a group");
};

export const leaveGroup = async (
  conversationId: string,
  userId: string,
): Promise<{ newAdminId?: string }> => {
  if (!isValidObjectId(conversationId))
    throw new ApiError(400, "Invaliid conversationId");

  if (!isValidObjectId(userId)) throw new ApiError(400, "Invalid userId");

  const conversationObjectId = new mongoose.Types.ObjectId(conversationId);
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const leavingParticipant = await ConversationParticipant.findOne({
    conversationId: conversationObjectId,
    userId: userObjectId,
  })
    .select("role createdAt")
    .lean<{ role: "admin" | "member"; createAt: Date }>();

  if (!leavingParticipant) throw new ApiError(404, "Not a member");

  let newAdminId: string | undefined;

  if (leavingParticipant.role === "admin") {
    const adminCount = await ConversationParticipant.countDocuments({
      conversationId: conversationObjectId,
      role: "admin",
    });

    if (adminCount === 1) {
      const nextAdmin = await ConversationParticipant.findOne({
        conversationId: conversationObjectId,
        userId: { $ne: userObjectId },
      })
        .sort({ createdAt: 1 })
        .select("userId")
        .lean<{ userId: mongoose.Types.ObjectId } | null>();

      if (nextAdmin) {
        await ConversationParticipant.updateOne(
          { conversationId: conversationObjectId, userId: nextAdmin.userId },
          { $set: { role: "admin" } },
        );
        newAdminId = nextAdmin.userId.toString();
      }
    }
  }

  await ConversationParticipant.deleteOne({
    conversationId: conversationObjectId,
    userId: userObjectId,
  });

  const remaingCount = await ConversationParticipant.countDocuments({
    conversationId: conversationObjectId,
  });

  if (remaingCount === 0) {
    await Conversation.deleteOne({ _id: conversationObjectId });
  }

  return { newAdminId };
};

export const updateGroupAvatar = async (
  conversationId: string,
  adminId: string,
  newAvatarUrl: string,
  newAvatarPublicId: string,
): Promise<{ groupAvatar: string; groupAvatarPublicId: string }> => {
  if (!isValidObjectId(conversationId))
    throw new ApiError(400, "Invalid conversationId");
  if (!isValidObjectId(adminId)) throw new ApiError(400, "Invalid adminId");

  if (!newAvatarUrl?.trim())
    throw new ApiError(400, "Avatar public id is required");
  if (!newAvatarPublicId?.trim())
    throw new ApiError(400, "Avatar Public id is required");
  if (
    !config.cloudinary.baseUrl ||
    !newAvatarUrl.startsWith(config.cloudinary.baseUrl)
  )
    throw new ApiError(400, "Invalid avatar URL");

  const conversationObjectId = new mongoose.Types.ObjectId(conversationId);

  await ensureGroupAdmin(conversationObjectId, adminId);

  const conversation = await Conversation.findById(conversationObjectId)
    .select("isGroup groupAvatarPublicId")
    .lean<{ isGroup: boolean; groupAvatarPublicId?: string | null }>();

  if (!conversation) throw new ApiError(404, "Conversation not found");
  if (!conversation.isGroup)
    throw new ApiError(400, "Cannot set avatar on a direct conversation");

  if (conversation.groupAvatarPublicId) {
    try {
      await deleteFile(conversation.groupAvatarPublicId, "image");
    } catch (err) {
      console.error(
        `[updateGroupAvatar] Failed to delete old avatar:
          ${conversation.groupAvatarPublicId}
          `,
        err,
      );
    }
  }

  const result = await Conversation.updateOne(
    { _id: conversationObjectId, isGroup: true },
    {
      $set: {
        groupAvatar: newAvatarUrl,
        groupAvatarPublicId: newAvatarPublicId,
      },
    },
  );

  if (result.matchedCount === 0)
    throw new ApiError(404, "Conversation not found");

  return { groupAvatar: newAvatarUrl, groupAvatarPublicId: newAvatarPublicId };
};

export const deleteGroupAvatar = async (
  conversationId: string,
  adminId: string,
): Promise<void> => {
  if (!isValidObjectId(conversationId))
    throw new ApiError(400, "Invalid conversationId");
  if (!isValidObjectId(adminId)) throw new ApiError(400, "Invalid adminId");

  const conversationObjectId = new mongoose.Types.ObjectId(conversationId);

  await ensureGroupAdmin(conversationObjectId, adminId);

  const conversation = await Conversation.findById(conversationObjectId)
    .select("isGroup groupAvatar groupAvatarPublicId")
    .lean<{
      isGroup: boolean;
      groupAvatar?: string | null;
      groupAvatarPublicId?: string | null;
    }>();

  if (!conversation) throw new ApiError(404, "Conversation not found");

  if (!conversation.isGroup)
    throw new ApiError(400, "this is not a group conversation");

  if (!conversation.groupAvatarPublicId)
    throw new ApiError(400, "this group has no avatar to delete");

  try {
    await deleteFile(conversation.groupAvatarPublicId, "image");
  } catch (err) {
    console.error(
      `[deleteGroupAvatar] Cloudinary deletion failed for: ${conversation.groupAvatarPublicId}`,
      err,
    );
  }

  await Conversation.updateOne(
    { _id: conversationObjectId },
    { $set: { groupAvatar: null, groupAvatarPublicId: null } },
  );
};

export const promoteAdmin = async (
  conversationId: string,
  requesterId: string,
  targetUserId: string,
): Promise<void> => {
  if (!isValidObjectId(conversationId))
    throw new ApiError(400, "Invalid conversationId");

  if (!isValidObjectId(requesterId))
    throw new ApiError(400, "Invalid requesterId");

  if (!isValidObjectId(targetUserId))
    throw new ApiError(400, "Invalid targetUserId");

  if (requesterId === targetUserId)
    throw new ApiError(400, "You are already an admin");

  const conversationObjectId = new mongoose.Types.ObjectId(conversationId);

  await ensureGroupAdmin(conversationObjectId, requesterId);

  const targetParticipant = await ConversationParticipant.findOne({
    conversationId: conversationObjectId,
    userId: new mongoose.Types.ObjectId(targetUserId),
  }).lean();

  if (!targetParticipant)
    throw new ApiError(404, "User is not a member of this group");

  if (targetParticipant.role === "admin")
    throw new ApiError(409, "User is already an admin");

  await ConversationParticipant.updateOne(
    {
      conversationId: conversationObjectId,
      userId: new mongoose.Types.ObjectId(targetUserId),
    },
    { $set: { role: "admin" } },
  );
};

export const pinMessage = async (
  conversationId: string,
  messageId: string,
  userId: string,
): Promise<void> => {
  if (!isValidObjectId(conversationId))
    throw new ApiError(400, "Invalid conversationId");

  if (!isValidObjectId(messageId)) throw new ApiError(400, "Invalid messageId");

  if (!isValidObjectId(userId)) throw new ApiError(400, "Invalid userId");

  await ensureConversationMembershipForUser(conversationId, userId);

  const conversationObjectId = new mongoose.Types.ObjectId(conversationId);

  const conversation = await Conversation.findById(conversationObjectId)
    .select("pinnedMessages isGroup groupAdmin")
    .lean();

  if (!conversation) throw new ApiError(404, "Conversation not found");

  if (conversation.isGroup)
    await ensureGroupAdmin(conversationObjectId, userId);

  const message = await Message.exists({
    _id: messageId,
    conversation: conversationId,
    isDeleted: false,
  });

  if (!message)
    throw new ApiError(404, "Message not found in this conversation");

  if ((conversation.pinnedMessages?.length ?? 0) >= 3)
    throw new ApiError(
      400,
      "Cannot pin more than 3 messages. Unpin one first.",
    );

  const result = await Conversation.updateOne(
    { _id: conversationObjectId },
    { $addToSet: { pinnedMessages: new mongoose.Types.ObjectId(messageId) } },
  );

  if (result.modifiedCount === 0)
    throw new ApiError(409, "Messagee is already pinned");
};

export const unpinMessage = async (
  conversationId: string,
  messageId: string,
  userId: string,
): Promise<void> => {
  if (!isValidObjectId(conversationId))
    throw new ApiError(400, "Invalid conversationId");

  if (!isValidObjectId(messageId)) throw new ApiError(400, "Invalid messageId");

  if (!isValidObjectId(userId)) throw new ApiError(400, "Invalid userId");

  await ensureConversationMembershipForUser(conversationId, userId);

  const conversationObjectId = new mongoose.Types.ObjectId(conversationId);

  const conversation = await Conversation.findById(conversationObjectId)
    .select("isGroup groupAdmin")
    .lean();

  if (!conversation) throw new ApiError(404, "Conversation not found");

  if (conversation.isGroup) {
    await ensureGroupAdmin(conversationObjectId, userId);
  }

  const result = await Conversation.updateOne(
    { _id: conversationObjectId },
    { $pull: { pinnedMessages: new mongoose.Types.ObjectId(messageId) } },
  );

  if (result.modifiedCount === 0)
    throw new ApiError(409, "Message is not pinned");
};

export const getPinnedMessages = async (
  conversationId: string,
  userId: string,
): Promise<MessageDto[]> => {
  if (!isValidObjectId(conversationId))
    throw new ApiError(400, "Invalid conversationId");

  if (!isValidObjectId(userId)) throw new ApiError(400, "Invalid userId");

  await ensureConversationMembershipForUser(conversationId, userId);

  const conversation = await Conversation.findById(conversationId)
    .populate({
      path: "pinnedMessages",
      match: { isDeleted: false },
    })
    .lean<{ pinnedMessages: any[] }>();

  if (!conversation) throw new ApiError(404, "Conversation not found");

  const pinnedMessages = conversation.pinnedMessages || [];

  return pinnedMessages.map(toMessageDto);
};

export const pinConversation = async (
  conversationId: string,
  userId: string,
): Promise<void> => {
  if (!isValidObjectId(conversationId))
    throw new ApiError(400, "Invalid conversationId");

  if (!isValidObjectId(userId)) throw new ApiError(400, "Invalid userId");

  const result = await ConversationParticipant.updateOne(
    {
      conversationId: new mongoose.Types.ObjectId(conversationId),
      userId: new mongoose.Types.ObjectId(userId),
    },

    { $set: { isPinned: true, pinnedAt: new Date() } },
  );

  if (result.matchedCount === 0)
    throw new ApiError(404, "Not a member of this conversation");
};

export const unpinConversation = async (
  conversationId: string,
  userId: string,
): Promise<void> => {
  if (!isValidObjectId(conversationId))
    throw new ApiError(400, "Invalid conversationId");

  if (!isValidObjectId(userId)) throw new ApiError(400, "Invalid userId");

  const result = await ConversationParticipant.updateOne(
    {
      conversationId: new mongoose.Types.ObjectId(conversationId),
      userId: new mongoose.Types.ObjectId(userId),
    },

    { $set: { isPinned: false, pinnedAt: null } },
  );

  if (result.matchedCount === 0)
    throw new ApiError(404, "Not a member of this conversation");
};

const isCurrentlyMuted = (participant: {
  //helper function
  isMuted: boolean;
  mutedUntill: Date | null;
}): boolean => {
  if (!participant.isMuted) return false;
  if (!participant.mutedUntill) return true;
  return participant.mutedUntill > new Date();
};

export const muteConversation = async (
  conversationId: string,
  userId: string,
  mutedUntill?: string | null, //ISO date string ,null =forever
): Promise<{ isMuted: boolean; mutedUntill: string | null }> => {
  if (!isValidObjectId(conversationId))
    throw new ApiError(400, "Invalid conversationId");

  if (!isValidObjectId(userId)) throw new ApiError(400, "Invalid userId");

  await ensureConversationMembershipForUser(conversationId, userId);

  let parsedMutedUntill: Date | null = null;

  if (mutedUntill !== undefined && mutedUntill !== null) {
    parsedMutedUntill = new Date(mutedUntill);

    if (isNaN(parsedMutedUntill.getTime()))
      throw new ApiError(400, "Invalid mutedUntill date");

    if (parsedMutedUntill <= new Date())
      throw new ApiError(400, "mutedUntill must be in the future");
  }

  await ConversationParticipant.updateOne(
    {
      conversationId: new mongoose.Types.ObjectId(conversationId),
      userId: new mongoose.Types.ObjectId(userId),
    },
    {
      $set: {
        isMuted: true,
        mutedUntill: parsedMutedUntill,
      },
    },
  );

  return {
    isMuted: true,
    mutedUntill: parsedMutedUntill ? parsedMutedUntill.toISOString() : null,
  };
};

export const unmuteConversation = async (
  conversationId: string,
  userId: string,
): Promise<{ isMuted: boolean }> => {
  if (!isValidObjectId(conversationId))
    throw new ApiError(400, "Invalid conversationId");

  if (!isValidObjectId(userId)) throw new ApiError(400, "Invalid userId");

  await ensureConversationMembershipForUser(conversationId, userId);

  await ConversationParticipant.updateOne(
    {
      conversationId: new mongoose.Types.ObjectId(conversationId),
      userId: new mongoose.Types.ObjectId(userId),
    },
    {
      $set: {
        isMuted: false,
        mutedUntill: null,
      },
    },
  );

  return { isMuted: false };
};

//race condition safe because of unique index , upsert and $setOnInsert
