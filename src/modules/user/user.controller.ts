import { Request, Response } from "express";

import {
  clearRefreshTokenCookieOptions,
  refreshCookieName,
} from "../../config/env";
import { asyncHandler } from "../../middleware/asyncHandler";
import { presenceStore } from "../../socket/presence.store";
import { getIO } from "../../socket/socket.server";
import { ApiError } from "../../utils/ApiError";

import {
  getMe as getMeService,
  getUserById as getUserByIdService,
  searchUsers as searchUsersService,
  updateProfile,
  getPresenceStatus,
  deleteAvatar,
  blockUser,
  unblockUser,
  getBlockedUsers,
  deleteAccount,
  toggle2FA,
} from "./user.service";


export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const dto = await getMeService(req.user.id);
  res.status(200).json({ success: true, data: dto });
});

export const getPresence = asyncHandler(async (req: Request, res: Response) => {
  const userIdsRaw = req.query.userIds as string;

  if (!userIdsRaw || !userIdsRaw.trim())
    throw new ApiError(400, "userIds query parametre is required");

  const userIds = userIdsRaw.split(",").map((id) => id.trim());

  if (userIds.length > 50)
    throw new ApiError(
      400,
      "cannot request presence for more than 50 users at once",
    );

  const presenceData = await getPresenceStatus(userIds, req.user.id);

  res.status(200).json({
    success: true,
    data: presenceData,
  });
});

export const getUserById = asyncHandler(async (req: Request, res: Response) => {
  const dto = await getUserByIdService(req.params.id, req.user.id);
  res.status(200).json({ success: true, data: dto });
});

export const searchUsers = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query.search as string | undefined;

  if (!query || !query.trim())
    throw new ApiError(400, "Search query is required");

  const users = await searchUsersService(query, req.user.id);

  res.status(200).json({
    success: true,
    data: {
      users,
      count: users.length,
    },
  });
});

export const updateMe = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user.id.toString();

  const { name, bio, avatar, avatarPublicId } = req.body;

  const updatedProfile = await updateProfile(userId, {
    name,
    bio,
    avatar,
    avatarPublicId,
  });

  res.status(200).json({
    success: true,
    data: updatedProfile,
  });
});

export const deleteAvatarController = asyncHandler(
  async (req: Request, res: Response) => {
    const updatedProfile = await deleteAvatar(req.user.id);
    res.status(200).json({ success: true, data: updatedProfile });
  },
);

export const blockUserController = asyncHandler(
  async (req: Request, res: Response) => {
    await blockUser(req.user.id, req.params.id);

    res
      .status(200)
      .json({ success: true, message: "User blocked successfully" });
  },
);

export const unblockUserController = asyncHandler(
  async (req: Request, res: Response) => {
    await unblockUser(req.user.id, req.params.id);
    res
      .status(200)
      .json({ success: true, message: "User unblocked successfully" });
  },
);
export const getBlockedUsersController = asyncHandler(
  async (req: Request, res: Response) => {
    const blockedUsers = await getBlockedUsers(req.user.id);
    res.status(200).json({ success: true, data: blockedUsers });
  },
);

export const deleteAccountController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user.id;

    await deleteAccount(userId);

    res.clearCookie(refreshCookieName, clearRefreshTokenCookieOptions);

    const io = getIO();
    const socketIds = presenceStore.getSockets(userId);
    for (const socketId of socketIds) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.disconnect(true);
      }
    }
    presenceStore.remove(userId);

    res.status(200).json({
      success: true,
      message: "Account deleted successfully",
    });
  },
);

//Toggle 2FA
export const toggle2FAController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user.id;
    const { enable, password } = req.body;

    if (typeof enable !== "boolean") {
      throw new ApiError(400, "'enable' must be a boolean");
    }

    const result = await toggle2FA(userId, enable, password);

    res.status(200).json({
      success: true,
      data: result,
    });
  },
);

//Update notification preferences
export const updateNotificationPrefsController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user.id;
    const { browserNotifications, sounds, muteAll } = req.body;

    // Build update object — only include fields that were sent
    const update: Record<string, boolean> = {};

    if (typeof browserNotifications === "boolean") {
      update["notificationPrefs.browserNotifications"] = browserNotifications;
    }
    if (typeof sounds === "boolean") {
      update["notificationPrefs.sounds"] = sounds;
    }
    if (typeof muteAll === "boolean") {
      update["notificationPrefs.muteAll"] = muteAll;
    }

    if (Object.keys(update).length === 0) {
      throw new ApiError(400, "No valid preferences provided");
    }

    const { User } = await import("./user.model");
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: update },
      { new: true, select: "notificationPrefs" },
    );

    if (!user) throw new ApiError(404, "User not found");

    res.status(200).json({
      success: true,
      data: {
        browserNotifications: user.notificationPrefs?.browserNotifications ?? true,
        sounds: user.notificationPrefs?.sounds ?? true,
        muteAll: user.notificationPrefs?.muteAll ?? false,
      },
    });
  },
);

//Update privacy preferences
export const updatePrivacyPrefsController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user.id;
    const { showOnlineStatus, showLastSeen } = req.body;

    const update: Record<string, boolean> = {};

    if (typeof showOnlineStatus === "boolean") {
      update["privacyPrefs.showOnlineStatus"] = showOnlineStatus;
    }
    if (typeof showLastSeen === "boolean") {
      update["privacyPrefs.showLastSeen"] = showLastSeen;
    }

    if (Object.keys(update).length === 0) {
      throw new ApiError(400, "No valid preferences provided");
    }

    const { User } = await import("./user.model");
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: update },
      { new: true, select: "privacyPrefs" },
    );

    if (!user) throw new ApiError(404, "User not found");

    res.status(200).json({
      success: true,
      data: {
        showOnlineStatus: user.privacyPrefs?.showOnlineStatus ?? true,
        showLastSeen: user.privacyPrefs?.showLastSeen ?? true,
      },
    });
  },
);
