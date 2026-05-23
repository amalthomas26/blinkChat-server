import type { MessageType } from "../message/message.model";

export interface ConversationListUserDto {
  id: string;
  name: string;
  avatar: string;
  role?:"admin" | "member";
  status?: "online" | "offline" | "away";
  lastSeen?: string | null;
}

export interface ConversationListMessageDto {
  id: string;
  senderId: string;
  type: MessageType;
  content?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  fileName?: string;
  fileSize?: number;
  createdAt: string;
}

export interface ConversationUnreadStateDto {
  hasUnread: boolean;
  lastSeenMessageId: string | null;
  unreadCount:number;
}

export interface ConversationListItemDto {
  id: string;
  type: "direct" | "group";
  name: string | null;
  groupAvatar?:string | null;
  groupDescription?:string | null;
  maxParticipants?:number;
  peer: ConversationListUserDto | null;
  participants: ConversationListUserDto[];
  lastMessage: ConversationListMessageDto | null;
  unread: ConversationUnreadStateDto;
  isPinned:boolean;
  isMuted:boolean;
  mutedUntill:string | null;
  updatedAt: string;
}

export interface PaginatedConversationListDto {
  conversations: ConversationListItemDto[];
  hasNextPage: boolean;
  nextCursor: string | null;
}

export interface CreateGroupInput {
  name: string;
  participantIds: string[];
  description?: string;
  groupAvatar?:string;
  groupAvatarPublicId?:string;
}
export interface BulkAddMembersResultDto{
  added:ConversationListUserDto[]
}