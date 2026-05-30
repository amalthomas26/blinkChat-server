import mongoose from "mongoose";

import { runtimeConfig as config } from "../../config/env";
import { ApiError } from "../../utils/ApiError";
import { isValidObjectId } from "../../utils/objectId";
import Conversation from "../conversation/conversation.model";
import { ConversationParticipant } from "../conversation/conversationParticipant.model";
import Message from "../message/message.model";
import { deleteFile } from "../upload/upload.service";

import { Block } from "./block.model";
import { User } from "./user.model";
import type {
  UserProfileDto,
  PublicUserProfileDto,
  UserSearchResultDto,
  UserProfileSource,
  UpdateProfileInput,
} from "./user.types";




const escapeRegex = (text: string): string => {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
};

export const updateLastSeen = async (userId: string): Promise<void> => {
  try {
    if (!isValidObjectId(userId)) {
      console.error("[updateLastSeen] Invalid userId", userId);
      return;
    }

    const res = await User.updateOne(
      { _id: userId },
      { $set: { lastSeen: new Date(), status: "offline" } },
    );

    if (res.matchedCount === 0) {
      console.warn("[updateLastSeen] User not found", userId);
    }
  } catch (err) {
    console.error("[updateLastSeen] DB error", {
      userId,
      err,
    });
  }
};

export const setUserOnline = async (userId: string): Promise<void> => {
  try {
    if (!isValidObjectId(userId)) {
      console.error("[setUserOnline] Invalid userId", userId);
      return;
      
    }
    await User.updateOne({ _id: userId }, { $set: { status: "online" } });
  } catch (err: unknown) {
    console.error("[setUserOnline] DB error", { userId, err });
  }
};

export const getPresenceStatus = async (
  userIds: string[],
  requestingUserId?: string,
): Promise<Record<string, { status: string; lastSeen: Date | null }>> => {
  const validIds = userIds.filter(isValidObjectId);

  if (validIds.length === 0) {
    return {};
  }

  const users = await User.find({ _id: { $in: validIds } })
    .select("_id status lastSeen privacyPrefs")
    .lean<
      {
        _id: mongoose.Types.ObjectId;
        status: string;
        lastSeen: Date | null;
        privacyPrefs?: { showOnlineStatus: boolean; showLastSeen: boolean };
      }[]
    >();

  // Build set of user IDs that have a block relationship with the requester.
  // Both directions: requester blocked them OR they blocked the requester.
  const blockedSet = new Set<string>();
  if (requestingUserId && isValidObjectId(requestingUserId)) {
    const blockRecords = await Block.find({
      $or: [
        { blocker: requestingUserId },
        { blocked: requestingUserId },
      ],
    }).lean();
    for (const b of blockRecords) {
      blockedSet.add(b.blocker.toString());
      blockedSet.add(b.blocked.toString());
    }
    // Don't mask the requester themselves
    blockedSet.delete(requestingUserId);
  }

  const result: Record<string, { status: string; lastSeen: Date | null }> = {};

  for (const user of users) {
    const id = user._id.toString();
    if (blockedSet.has(id)) {
      // Mask presence for blocked users — always appear offline
      result[id] = { status: "offline", lastSeen: null };
    } else {
      // Respect the user's own privacy preferences
      const showOnline = user.privacyPrefs?.showOnlineStatus !== false;
      const showLastSeen = user.privacyPrefs?.showLastSeen !== false;
      result[id] = {
        status: showOnline ? (user.status || "offline") : "offline",
        lastSeen: showLastSeen ? (user.lastSeen || null) : null,
      };
    }
  }
  return result;
};

export const getMe = async (userId: string): Promise<UserProfileDto> => {
  if (!isValidObjectId(userId)) {
    throw new ApiError(400, "Invalid user id");
  }
  const user = await User.findById(userId).select(
    "name email username avatar bio status lastSeen provider isEmailVerified twoFactorEnabled notificationPrefs privacyPrefs createdAt",
  );

  if (!user) throw new ApiError(404, "User not found");

  //transform to DTO - never return the Mongoose Document as whole
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    username: user.username ?? null,
    avatar: user.avatar ?? "",
    bio: user.bio ?? "",
    status: user.status ?? "offline",
    lastSeen: user.lastSeen ?? null,
    provider: user.provider,
    isEmailVerified: user.isEmailVerified,
    twoFactorEnabled: user.twoFactorEnabled ?? false,

    notificationPrefs: {
      browserNotifications: user.notificationPrefs?.browserNotifications ?? true,
      sounds: user.notificationPrefs?.sounds ?? true,
      muteAll: user.notificationPrefs?.muteAll ?? false,
    },

    privacyPrefs: {
      showOnlineStatus: user.privacyPrefs?.showOnlineStatus ?? true,
      showLastSeen: user.privacyPrefs?.showLastSeen ?? true,
    },
    createdAt: user.createdAt,
  };
};

export const getUserById = async (
  targetId: string,
  requestingUserId?: string,
): Promise<PublicUserProfileDto> => {
  if (!isValidObjectId(targetId)) throw new ApiError(400, "Invalid user ID");

  const user = await User.findById(targetId).select(
    "name avatar bio status lastSeen privacyPrefs createdAt",
  );

  if (!user) throw new ApiError(404, "User not found");

  // Check block relationship — if either party has blocked the other,
  // hide the avatar and mask online status from the requesting user.
  let isBlocked = false;
  if (requestingUserId && isValidObjectId(requestingUserId)) {
    const blockExists = await Block.findOne({
      $or: [
        { blocker: requestingUserId, blocked: targetId },
        { blocker: targetId, blocked: requestingUserId },
      ],
    });
    isBlocked = !!blockExists;
  }

  // Respect the target user's privacy prefs for non-blocked users
  const showOnline = !isBlocked && user.privacyPrefs?.showOnlineStatus !== false;
  const showLastSeen = !isBlocked && user.privacyPrefs?.showLastSeen !== false;

  return {
    id: user._id.toString(),
    name: user.name,
    avatar: isBlocked ? "" : (user.avatar ?? ""),
    bio: isBlocked ? "" : (user.bio ?? ""),
    status: showOnline ? (user.status ?? "offline") : "offline",
    lastSeen: showLastSeen ? (user.lastSeen ?? null) : null,
    createdAt: user.createdAt,
  };
};
export const searchUsers = async (
  query: string,
  requestingUserId: string,
): Promise<UserSearchResultDto[]> => {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) return [];

  const blockRecords = await Block.find({
    $or: [{ blocker: requestingUserId }, { blocked: requestingUserId }],
  }).lean();

  const excludedUserIds = blockRecords.map((b) =>
    b.blocker.toString() === requestingUserId ? b.blocked : b.blocker,
  );

  const excludeFilter = [
    new mongoose.Types.ObjectId(requestingUserId),
    ...excludedUserIds,
  ];

  const regexPattern = new RegExp(`^${escapeRegex(trimmedQuery)}`, "i");

  const users = await User.find({
    name: { $regex: regexPattern },
    _id: { $nin: excludeFilter },
  })
    .sort({ name: 1 })
    .limit(50)
    .select("_id name avatar status");

  return users.map((user) => ({
    id: user._id.toString(),
    name: user.name,
    avatar: user.avatar || "",
    status: user.status as UserSearchResultDto["status"],
  }));
};

const USER_PROFILE_SELECT =
  "name email username avatar avatarPublicId bio status lastSeen provider isEmailVerified twoFactorEnabled notificationPrefs privacyPrefs createdAt";

//Helper: map mongoose document → plain DTO
// Keeps controller layer clean — it never touches raw mongoose documents

function toUserProfileDto(user: UserProfileSource): UserProfileDto {
  return {
    id: user.id.toString(),
    name: user.name,
    email: user.email,
    username: user.username ?? null,
    avatar: user.avatar ?? null,
    bio: user.bio ?? null,
    status: user.status ?? "offline",
    lastSeen: user.lastSeen ?? null,
    provider: user.provider,
    isEmailVerified: user.isEmailVerified,
    twoFactorEnabled: user.twoFactorEnabled ?? false,
    notificationPrefs: {
      browserNotifications: user.notificationPrefs?.browserNotifications ?? true,
      sounds: user.notificationPrefs?.sounds ?? true,
      muteAll: user.notificationPrefs?.muteAll ?? false,
    },
    privacyPrefs: {
      showOnlineStatus: user.privacyPrefs?.showOnlineStatus ?? true,
      showLastSeen: user.privacyPrefs?.showLastSeen ?? true,
    },

    createdAt: user.createdAt,
  };
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<UserProfileDto> {
  if (!isValidObjectId(userId)) throw new ApiError(400, "Invalid user ID");

  if (input.name !== undefined) {
    const trimmed = input.name.trim();

    if (trimmed.length === 0) throw new ApiError(400, "Name cannot be empty");
    if (trimmed.length > 50)
      throw new ApiError(400, "Name cannot exceed 50 characters");

    input.name = trimmed;
  }

  if (input.username !== undefined) {
    const trimmedUsername = input.username.trim().toLowerCase();

    if (trimmedUsername === "") {
      // Allow clearing username (set to null)
      input.username = undefined; // will be set as null below
    } else {
      if (!/^[a-z0-9_]{3,30}$/.test(trimmedUsername)) {
        throw new ApiError(
          400,
          "Username must be 3-30 characters: lowercase letters, numbers, underscores only",
        );
      }

      // Check uniqueness (excluding current user)
      const existing = await User.findOne({
        username: trimmedUsername,
        _id: { $ne: userId },
      });

      if (existing) {
        throw new ApiError(409, "Username is already taken");
      }

      input.username = trimmedUsername;
    }
  }

  if (input.bio !== undefined) {
    if (input.bio.length > 200)
      throw new ApiError(400, "Bio cannot exceed 200 characters");
  }

  const hasAvatar = input.avatar !== undefined;
  const hasPublicId = input.avatarPublicId !== undefined;

  if (hasAvatar !== hasPublicId)
    throw new ApiError(400, "Avatar and avatar must both be provided together");

  if (hasAvatar && input.avatar && input.avatarPublicId) {
    if (!input.avatar.startsWith(config.cloudinary.baseUrl))
      throw new ApiError(400, "Invalid avatar URL");
  }

  if (
    input.avatarPublicId !== undefined &&
    !input.avatarPublicId?.includes(userId)
  )
    throw new ApiError(403, "avatar asset does not belong to the user");

  if (hasAvatar) {
    const currentUser = await User.findById(userId).select("avatarPublicId");

    if (currentUser?.avatarPublicId) {
      try {
        await deleteFile(currentUser.avatarPublicId, "image");
      } catch (err) {
        console.error(
          `[updateProfile] Failed to delete old avatar (publicId: ${currentUser.avatarPublicId}):`,
          err,
        );
      }
    }
  }

  const updateFields: Record<string, unknown> = {};

  if (input.name !== undefined) updateFields.name = input.name;
  if (input.username !== undefined) updateFields.username = input.username || null;
  if (input.bio !== undefined) updateFields.bio = input.bio;
  if (input.avatar !== undefined) updateFields.avatar = input.avatar;
  if (input.avatarPublicId !== undefined)
    updateFields.avatarPublicId = input.avatarPublicId;

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { $set: updateFields },
    {
      new: true,
      select: USER_PROFILE_SELECT,
    },
  );

  if (!updatedUser) throw new ApiError(404, "User not found");

  return toUserProfileDto(updatedUser as UserProfileSource);
}
export const deleteAvatar = async (userId: string): Promise<UserProfileDto> => {
  if (!isValidObjectId(userId)) throw new ApiError(400, "Invalid user ID");

  const currentUser = await User.findById(userId)
    .select("avatarPublicId")
    .lean<{ avatarPublicId?: string | null }>();

  if (!currentUser) throw new ApiError(404, "User not found");

  if (!currentUser.avatarPublicId) {
    throw new ApiError(400, "No avatar to delete");
  }

  try {
    await deleteFile(currentUser.avatarPublicId, "image");
  } catch (err) {
    console.error(
      `[deleteAvatar] Cloudinary deletion failed: ${currentUser.avatarPublicId}`,
      err,
    );
  }

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { $set: { avatar: null, avatarPublicId: null } },
    { new: true, select: USER_PROFILE_SELECT },
  );
  if (!updatedUser) throw new ApiError(404, "User not found");

  return toUserProfileDto(updatedUser as UserProfileSource);
};

export const blockUser = async (
  blockerId: string,
  blockedId: string,
): Promise<void> => {
  if (!isValidObjectId(blockerId))
    throw new ApiError(400, "Invalid blocker ID");

  if (!isValidObjectId(blockedId))
    throw new ApiError(400, "Invalid blocked ID");

  if (blockerId === blockedId) throw new ApiError(400, "cannot block yourself");

  try {
    await Block.create({ blocker: blockerId, blocked: blockedId });
  } catch (err: unknown) {
    if (err instanceof mongoose.mongo.MongoServerError && err.code === 11000) {
      throw new ApiError(409, "User is already blocked");
    }

    throw err;
  }
};

export const unblockUser = async (
  blockerId: string,
  blockedId: string,
): Promise<void> => {
  if (!isValidObjectId(blockerId))
    throw new ApiError(400, "Invalid blocker id");

  if (!isValidObjectId(blockedId))
    throw new ApiError(400, "Invalid blocked id");

  const result = await Block.deleteOne({
    blocker: blockerId,
    blocked: blockedId,
  });

  if (result.deletedCount === 0) throw new ApiError(404, "Block not found");
};

export const getBlockedUsers = async (userId: string): Promise<string[]> => {
  const blocks = await Block.find({ blocker: userId }).select("blocked").lean();
  return blocks.map((b) => b.blocked.toString());
};

export const deleteAccount = async (userId: string): Promise<void> => {
  if (!isValidObjectId(userId)) throw new ApiError(400, "Invalid user ID");

  const userObjectId = new mongoose.Types.ObjectId(userId);

  const user = await User.findById(userObjectId)
    .select("avatar avatarPublicId")
    .lean<{ avatar?: string; avatarPublicId?: string | null }>();

  if (!user) throw new ApiError(404, "User not found");

  if (user.avatarPublicId) {
    try {
      await deleteFile(user.avatarPublicId, "image");
    } catch (err) {
      console.error(
        `[deleteAccount] Failed to delete avatar: ${user.avatarPublicId}`,
        err,
      );
    }
  }

  const userMessage = await Message.find({
    sender: userObjectId,
    isDeleted: false,
  })
    .select("_id mediaPublicId type")
    .lean();

  for (const msg of userMessage) {
    if (msg.mediaPublicId) {
      try {
        const resourceType =
          msg.type === "image"
            ? "image"
            : msg.type === "video" || msg.type === "audio"
              ? "video"
              : "raw";

        await deleteFile(msg.mediaPublicId, resourceType);
      } catch (err) {
        console.error(
          `[deleteAccount] Failed to delete media: ${msg.mediaPublicId}`,
          err,
        );
      }
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    await Message.updateMany(
      { sender: userObjectId, isDeleted: false },
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
      { session },
    );

    const memberships = await ConversationParticipant.find({
      userId: userObjectId,
    })
      .select("conversationId role")
      .session(session)
      .lean();

    for (const membership of memberships) {
      const convId = membership.conversationId;

      const remainingCount = await ConversationParticipant.countDocuments(
        { conversationId: convId, userId: { $ne: userObjectId } },
        { session },
      );

      if (remainingCount === 0) {
        await Conversation.deleteOne({ _id: convId }, { session });
        await Message.deleteMany({ conversation: convId }, { session });
      } else {
        const conversation = await Conversation.findById(convId)
          .select("isGroup groupAdmin")
          .session(session)
          .lean();

        if (
          conversation?.isGroup &&
          conversation.groupAdmin?.toString() === userId
        ) {
          const nextAdmin = await ConversationParticipant.findOne({
            conversationId: convId,
            userId: { $ne: userObjectId },
          })
            .sort({ createdAt: 1 })
            .select("userId")
            .session(session)
            .lean();

          if (nextAdmin) {
            await Conversation.updateOne(
              { _id: convId },
              { $set: { groupAdmin: nextAdmin.userId } },
              { session },
            );

            await ConversationParticipant.updateOne(
              { conversationId: convId, userId: nextAdmin.userId },
              { $set: { role: "admin" } },
              { session },
            );
          }
        }
      }

      await Conversation.updateOne(
        { _id: convId },
        { $pull: { participants: userObjectId } },
        { session },
      );

      const conv = await Conversation.findById(convId)
        .select("lastMessage")
        .session(session)
        .lean();

      if (conv?.lastMessage) {
        const lastMsg = await Message.findById(conv.lastMessage)
          .select("sender isDeleted")
          .session(session)
          .lean();

        if (
          lastMsg &&
          (lastMsg.sender.toString() === userId || lastMsg.isDeleted)
        ) {
          const newLast = await Message.findOne({
            conversation: convId,
            isDeleted: false,
          })
            .sort({ _id: -1 })
            .select("_id")
            .session(session)
            .lean();

          await Conversation.updateOne(
            { _id: convId },
            { $set: { lastMessage: newLast?._id ?? null } },
            { session },
          );
        }
      }
    }
    await ConversationParticipant.deleteMany(
      { userId: userObjectId },
      { session },
    );

    await Block.deleteMany(
      { $or: [{ blocker: userObjectId }, { blocked: userObjectId }] },
      { session },
    );

    await User.deleteOne({ _id: userObjectId }, { session });

    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

export const toggle2FA = async (
  userId: string,
  enable: boolean,
  password: string,
): Promise<{ twoFactorEnabled: boolean }> => {
  if (!isValidObjectId(userId)) throw new ApiError(400, "Invalid user ID");
  if (!password) throw new ApiError(400, "Password is required to change 2FA settings");
  const user = await User.findById(userId).select("+password provider twoFactorEnabled");
  if (!user) throw new ApiError(404, "User not found");
  if (user.provider !== "local") {
    throw new ApiError(400, "2FA is not available for Google login accounts");
  }
  const isMatch = await user.comparePassword(password);
  if (!isMatch) throw new ApiError(401, "Incorrect password");
  // Avoid unnecessary DB write if already in the desired state
  if (user.twoFactorEnabled === enable) {
    return { twoFactorEnabled: enable };
  }
  user.twoFactorEnabled = enable;
  await user.save();
  return { twoFactorEnabled: enable };
};
