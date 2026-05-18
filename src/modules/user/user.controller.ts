import { Request, Response } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
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
} from "./user.service";
import { ApiError } from "../../utils/ApiError";
import { getIO } from "../../socket/socket.server";
import { presenceStore } from "../../socket/presence.store";

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

  const presenceData = await getPresenceStatus(userIds);

  res.status(200).json({
    success: true,
    data: presenceData,
  });
});

export const getUserById = asyncHandler(async (req: Request, res: Response) => {
  const dto = await getUserByIdService(req.params.id);
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

    res.clearCookie("token");

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
