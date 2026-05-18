import { Request, Response } from "express";
import {
  listConversationsForUser,
  startConversation as startConversationService,
  getConversationDetails,
  createGroupConversation,
  addGroupMember,
  removeGroupMember,
  renameGroup,
  leaveGroup,
  updateGroupAvatar,
  deleteGroupAvatar,
  promoteAdmin,
  pinMessage,
  unpinMessage,
  getPinnedMessages,
  pinConversation,
  unpinConversation,
  muteConversation,
  unmuteConversation,
} from "./conversation.service";
import { asyncHandler } from "../../middleware/asyncHandler";
import { getIO } from "../../socket/socket.server";
import { presenceStore } from "../../socket/presence.store";

// startConversationController: validation is already done by validateStartConversation middleware.
// The service re-validates userId/receiverId at the boundary — no duplication needed here.
export const startConversationController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user.id;
    const { receiverId } = req.body as { receiverId: string };

    const conversation = await startConversationService(userId, receiverId);

    return res.status(200).json({
      success: true,
      data: {
        conversationId: conversation._id.toString(),
      },
    });
  },
);

export const listConversationsController = asyncHandler(
  async (req: Request, res: Response) => {
    const rawLimit = parseInt(req.query.limit as string, 10);
    const limit = isNaN(rawLimit) ? 20 : Math.min(Math.max(rawLimit, 1), 50);
    const cursor =
      typeof req.query.cursor === "string" ? req.query.cursor : undefined;

    const result = await listConversationsForUser(req.user.id, {
      limit,
      cursor,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  },
);

export const getConversationController = asyncHandler(
  async (req: Request, res: Response) => {
    const conversationId = req.params.id;
    const userId = req.user.id;

    const conversation = await getConversationDetails(conversationId, userId);

    return res.status(200).json({
      success: true,
      data: conversation,
    });
  },
);

export const createGroupController = asyncHandler(
  async (req: Request, res: Response) => {
    const creatorId = req.user.id;
    const {
      name,
      participantIds,
      description,
      groupAvatar,
      groupAvatarPublicId,
    } = req.body as {
      name: string;
      participantIds: string[];
      description?: string;
      groupAvatar?: string;
      groupAvatarPublicId?: string;
    };

    const conversationDto = await createGroupConversation(creatorId, {
      name,
      participantIds,
      description,
      groupAvatar,
      groupAvatarPublicId,
    });

    const io = getIO();
    const allParticipantIds = conversationDto.participants.map((p) => p.id);

    for (const participantId of allParticipantIds) {
      const socketIds = presenceStore.getSockets(participantId);
      for (const socketId of socketIds) {
        io.to(socketId).emit("group_created", conversationDto);
      }
    }
    return res.status(201).json({
      success: true,
      data: conversationDto,
    });
  },
);

export const addGroupMemberController = asyncHandler(async (req, res) => {
  const body = req.body as { userIds: string[] };
  const conversationId = req.params.id;

  const memberDtos = await addGroupMember(
    conversationId,
    req.user.id,
    body.userIds,
  );

  const io = getIO();

  for (const memberDto of memberDtos) {
    for (const socketId of presenceStore.getSockets(memberDto.id)) {
      io.sockets.sockets.get(socketId)?.join(conversationId);
    }
  }

  io.to(conversationId).emit("group_members_added", {
    conversationId,
    members: memberDtos,
  });

  return res.status(200).json({ success: true, data: { added: memberDtos } });
});

export const removeGroupMemberController = asyncHandler(async (req, res) => {
  const { id: conversationId } = req.params;
  const { memberIds } = req.body as { memberIds: string[] };

  await removeGroupMember(conversationId, req.user.id, memberIds);

  const io = getIO();

  for (const memberId of memberIds) {
    for (const socketId of presenceStore.getSockets(memberId)) {
      io.sockets.sockets.get(socketId)?.leave(conversationId);
    }
  }

  io.to(conversationId).emit("group_members_removed", {
    conversationId,
    removedUserIds: memberIds,
  });

  return res.status(200).json({ success: true, data: null });
});

export const renameGroupController = asyncHandler(async (req, res) => {
  const { id: conversationId } = req.params;
  const { name } = req.body as { name: string };

  await renameGroup(conversationId, req.user.id, name);

  getIO().to(conversationId).emit("group_renamed", {
    conversationId,
    name: name.trim(),
  });

  return res.status(200).json({ success: true, data: null });
});

export const leaveGroupController = asyncHandler(async (req, res) => {
  const { id: conversationId } = req.params;
  const userId = req.user.id;

  const { newAdminId } = await leaveGroup(conversationId, userId);

  const io = getIO();

  for (const socketId of presenceStore.getSockets(userId)) {
    io.sockets.sockets.get(socketId)?.leave(conversationId);
  }

  io.to(conversationId).emit("group_member_left", {
    conversationId,
    userId,
    ...(newAdminId ? { newAdminId } : {}),
  });

  return res.status(200).json({ success: true, data: null });
});
export const updateGroupAvatarController = asyncHandler(
  async (req: Request, res: Response) => {
    const adminId = req.user.id;
    const conversationId = req.params.id;
    const { groupAvatar, groupAvatarPublicId } = req.body as {
      groupAvatar: string;
      groupAvatarPublicId: string;
    };
    const result = await updateGroupAvatar(
      conversationId,
      adminId,
      groupAvatar,
      groupAvatarPublicId,
    );

    const io = getIO();
    io.to(conversationId).emit("group_avatar_updated", {
      conversationId,
      groupAvatar: result.groupAvatar,
    });

    res.status(200).json({ success: true, data: result });
  },
);

export const deleteGroupAvatarController = asyncHandler(
  async (req: Request, res: Response) => {
    const adminId = req.user.id;
    const conversationId = req.params.id;

    await deleteGroupAvatar(conversationId, adminId);

    const io = getIO();
    io.to(conversationId).emit("group_avatar_deleted", {
      conversationId,
    });

    res.status(200).json({ success: true });
  },
);

export const promoteToAdminController = asyncHandler(async (req, res) => {
  const { id: conversationId } = req.params;
  const { userId: targetUserId } = req.body as { userId: string };

  await promoteAdmin(conversationId, req.user.id, targetUserId);

  getIO().to(conversationId).emit("member_promoted", {
    conversationId,
    promotedUserId: targetUserId,
  });

  res.status(200).json({ success: true });
});

export const pinMessageController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id: conversationId, messageId } = req.params;
    const userId = req.user.id;

    await pinMessage(conversationId, messageId, userId);

    getIO().to(conversationId).emit("message_pinned", {
      conversationId,
      messageId,
      pinnedBy: userId,
    });

    res
      .status(200)
      .json({ success: true, message: "Message pinned successfully" });
  },
);

export const unpinMessageController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id: conversationId, messageId } = req.params;

    const userId = req.user.id;

    await unpinMessage(conversationId, messageId, userId);

    getIO().to(conversationId).emit("message_unpinned", {
      conversationId,
      messageId,
    });

    res
      .status(200)
      .json({ success: true, message: "Message unpinned successfully" });
  },
);

export const getPinnedMessagesController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id: conversationId } = req.params;
    const userId = req.user.id;
    const pinnedMessages = await getPinnedMessages(conversationId, userId);
    res.status(200).json({ success: true, data: pinnedMessages });
  },
);

export const pinConversationController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id: conversationId } = req.params;
    const userId = req.user.id;

    await pinConversation(conversationId, userId);

    return res
      .status(200)
      .json({ success: true, message: "Conversation pinned" });
  },
);

export const unpinConversationController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id: conversationId } = req.params;
    const userId = req.user.id;

    await unpinConversation(conversationId, userId);

    return res
      .status(200)
      .json({ success: true, message: "Conversation unpinned" });
  },
);

export const muteConversationController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id: conversationId } = req.params;
    const { mutedUntill } = req.body as { mutedUntill?: string | null };

    const result = await muteConversation(
      conversationId,
      req.user.id,
      mutedUntill,
    );

    return res.status(200).json({ success: true, data: result });
  },
);

export const unmuteConversationController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id: conversationId } = req.params;

    const result = await unmuteConversation(conversationId, req.user.id);

    return res.status(200).json({ success: true, data: result });
  },
);
 