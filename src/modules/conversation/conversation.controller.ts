import { Request, Response } from "express";
import mongoose from "mongoose";

import { asyncHandler } from "../../middleware/asyncHandler";
import { presenceStore } from "../../socket/presence.store";
import { getIO } from "../../socket/socket.server";
// Import emitToConversation and emitMessage helpers to fix room-only broadcast issues
import { emitToConversation, emitMessage } from "../../socket/socket.emitter";
import { createSystemMessage } from "../message/message.service";

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
  demoteAdmin,
  pinMessage,
  unpinMessage,
  getPinnedMessages,
  pinConversation,
  unpinConversation,
  muteConversation,
  unmuteConversation,
  updateGroupDescription,
  deleteDirectConversation,
} from "./conversation.service";
import { ConversationParticipant } from "./conversationParticipant.model";


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

    // This correctly fans out to sockets directly
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

  // Changed io.to(roomId) to emitToConversation helper to reach offline/background users
  emitToConversation(io, conversationId, "group_members_added", {
    conversationId,
    members: memberDtos,
  });

  // Changed to emitMessage helper to reach offline/background users
  const names = memberDtos.map((m) => m.name).join(", ");
  const sysMsg = await createSystemMessage(conversationId, `${names} ${memberDtos.length === 1 ? "was" : "were"} added to the group`);
  if (sysMsg) emitMessage(io, conversationId, sysMsg);

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

  // Changed to emitToConversation helper
  emitToConversation(io, conversationId, "group_members_removed", {
    conversationId,
    removedUserIds: memberIds,
  });

  // Changed to emitMessage helper
  const removedNames = memberIds.length === 1 ? "A member" : `${memberIds.length} members`;
  const sysMsg = await createSystemMessage(conversationId, `${removedNames} ${memberIds.length === 1 ? "was" : "were"} removed from the group`);
  if (sysMsg) emitMessage(io, conversationId, sysMsg);

  return res.status(200).json({ success: true, data: null });
});

export const renameGroupController = asyncHandler(async (req, res) => {
  const { id: conversationId } = req.params;
  const { name } = req.body as { name: string };

  await renameGroup(conversationId, req.user.id, name);

  // Changed to emitToConversation helper
  emitToConversation(getIO(), conversationId, "group_renamed", {
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

  // Changed to emitToConversation helper
  emitToConversation(io, conversationId, "group_member_left", {
    conversationId,
    userId,
    ...(newAdminId ? { newAdminId } : {}),
  });

  // Changed to emitMessage helper
  const leftSysMsg = await createSystemMessage(conversationId, "A member left the group");
  if (leftSysMsg) emitMessage(io, conversationId, leftSysMsg);

  // Changed to emitMessage helper
  if (newAdminId) {
    const adminSysMsg = await createSystemMessage(conversationId, "A new admin has been assigned");
    if (adminSysMsg) emitMessage(io, conversationId, adminSysMsg);
  }

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
    // Changed to emitToConversation helper
    emitToConversation(io, conversationId, "group_avatar_updated", {
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
    // Changed to emitToConversation helper
    emitToConversation(io, conversationId, "group_avatar_deleted", {
      conversationId,
    });

    res.status(200).json({ success: true });
  },
);

export const promoteToAdminController = asyncHandler(async (req, res) => {
  const { id: conversationId } = req.params;
  const targetUserId = req.params.userId;

  await promoteAdmin(conversationId, req.user.id, targetUserId);

  // Changed to emitToConversation helper
  emitToConversation(getIO(), conversationId, "member_promoted", {
    conversationId,
    promotedUserId: targetUserId,
  });

  // Changed to emitMessage helper
  const promoteSysMsg = await createSystemMessage(conversationId, "A member was promoted to admin");
  if (promoteSysMsg) emitMessage(getIO(), conversationId, promoteSysMsg);

  res.status(200).json({ success: true });
});

export const demoteAdminController = asyncHandler(async (req, res) => {
  const { id: conversationId, userId: targetUserId } = req.params;

  await demoteAdmin(conversationId, req.user.id, targetUserId);

  // Changed to emitToConversation helper
  emitToConversation(getIO(), conversationId, "member_demoted", {
    conversationId,
    demoteUserId: targetUserId,
  });

  // Changed to emitMessage helper
  const demoteSysMsg = await createSystemMessage(conversationId, "An admin was demoted to member");
  if (demoteSysMsg) emitMessage(getIO(), conversationId, demoteSysMsg);

  res.status(200).json({ success: true });
});

export const pinMessageController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id: conversationId, messageId } = req.params;
    const userId = req.user.id;

    await pinMessage(conversationId, messageId, userId);

    // Changed to emitToConversation helper
    emitToConversation(getIO(), conversationId, "message_pinned", {
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

    // Changed to emitToConversation helper
    emitToConversation(getIO(), conversationId, "message_unpinned", {
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

export const updateGroupDescriptionController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id: conversationId } = req.params;
    const { description } = req.body as { description: string };

    await updateGroupDescription(conversationId, req.user.id, description ?? "");

    return res.status(200).json({ success: true });
  },
);

export const deleteDirectConversationController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id: conversationId } = req.params;
    const userId = req.user.id;

    // Identify the other participant BEFORE deletion
    const participantRecord = await ConversationParticipant.find({
      conversationId: new mongoose.Types.ObjectId(conversationId),
    }).select("userId").lean<{ userId: mongoose.Types.ObjectId }[]>();

    const otherParticipantIds = participantRecord
      .map((p) => p.userId.toString())
      .filter((id) => id !== userId);

    await deleteDirectConversation(conversationId, userId);

    // Notify the other participant via socket (if they're online)
    const io = getIO();
    for (const otherId of otherParticipantIds) {
      for (const socketId of presenceStore.getSockets(otherId)) {
        io.to(socketId).emit("group_members_removed", {
          conversationId,
          removedUserIds: [userId],
        });
      }
    }

    return res.status(200).json({ success: true });
  },
);
