import { Socket, Server } from "socket.io";
import type {
  MessageDto,
  SendMessageInput,
} from "../modules/message/message.types";
import type {
  ConversationListItemDto,
  ConversationListMessageDto,
  ConversationListUserDto,
} from "../modules/conversation/conversation.types";
import type {
  CallType,
  CallIncomingPayload,
  CallAcceptedPayload,
  CallRejectedPayload,
  CallEndedPayload,
  CallReconnectingPayload,
  CallFailedPayload,
  WebRTCOfferPayload,
  WebRTCAnswerPayload,
  WebRTCIceCandidatePayload,
  WebRTCRestartIcePayload,
} from "../modules/call/call.types";



export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface TypingPayload {
  conversationId: string;
}

export interface SendMessagePayload extends Omit<SendMessageInput, "type"> {
  type?: SendMessageInput["type"];
}

export type MessagePayload = MessageDto;

export interface ConversationAccessErrorPayload {
  conversationId: string;
  code:
    | "INVALID_CONVERSATION_ID"
    | "CONVERSATION_NOT_FOUND"
    | "CONVERSATION_ACCESS_DENIED"
    | "CONVERSATION_ACCESS_ERROR";
  message: string;
}

export interface MessageDeletedPayload {
  messageId: string;
  conversationId: string;
  deletedMessageSenderId: string;
  lastMessageChanged: boolean;
  lastMessage: ConversationListMessageDto | null;
  updatedAt: string;
}

export interface JoinConversationResponse {
  success: boolean;
  error?: string;
}

export interface ClientToServerEvents {
  send_message: (
    payload: SendMessagePayload,
    callback?: (response: ApiResponse<MessagePayload>) => void,
  ) => void;

  messages_delivered: (
    payload: {
      conversationId: string;
      messageIds: string[];
    },
    callback?: (
      response: ApiResponse<{ updatedCount: number; messageIds: string[] }>,
    ) => void,
  ) => void;


  messages_read: (
    payload: {
      conversationId: string;
      lastSeenMessageId: string;
    },
    callback?: (response: ApiResponse<{ updatedCount: number }>) => void,
  ) => void;

  sync_messages: (
    payload: {
      conversationId: string;
      lastMessageId?: string;
      limit?: number;
    },
    callback?: (response: ApiResponse<MessagePayload[]>) => void,
  ) => void;

  typing_start: (payload: TypingPayload) => void;
  typing_stop: (payload: TypingPayload) => void;

  join_conversation: (
    conversationId: string,
    callback?: (response: JoinConversationResponse) => void,
  ) => void;
  leave_conversation: (
    conversationId: string,
    callback?: (response: JoinConversationResponse) => void,
  ) => void;

  delete_message: (
    payload: { messageId: string },
    callback: (res: ApiResponse<MessageDeletedPayload>) => void,
  ) => void;

  get_presence: (
    userIds: string[],
    callback: (onlineUserIds: string[]) => void,
  ) => void;

  // ─── Call Lifecycle ───
  "call:initiate": (
    payload: { receiverId: string; callType: CallType },
    callback?: (response: ApiResponse<{ callId: string }>) => void,
  ) => void;

  "call:ringing": (
    payload: { callId: string; callerId: string },
    callback?: (response: ApiResponse<null>) => void,
  ) => void;

  "call:accept": (
    payload: { callId: string },
    callback?: (response: ApiResponse<{ callId: string }>) => void,
  ) => void;

  "call:reject": (
    payload: { callId: string },
    callback?: (response: ApiResponse<null>) => void,
  ) => void;

  "call:end": (
    payload: { callId: string },
    callback?: (response: ApiResponse<null>) => void,
  ) => void;

  // ─── WebRTC Signaling ───
  "webrtc:offer": (
    payload: { callId: string; sdp: string },
    callback?: (response: ApiResponse<null>) => void,
  ) => void;

  "webrtc:answer": (
    payload: { callId: string; sdp: string },
    callback?: (response: ApiResponse<null>) => void,
  ) => void;

  "webrtc:ice-candidate": (
    payload: { callId: string; candidate: unknown },
    callback?: (response: ApiResponse<null>) => void,
  ) => void;

  "webrtc:restart-ice": (
    payload: { callId: string },
    callback?: (response: ApiResponse<null>) => void,
  ) => void;


}

export interface ServerToClientEvents {
  receive_message: (payload: MessagePayload) => void;

  conversation_access_error: (payload: ConversationAccessErrorPayload) => void;

  messages_delivered_update: (payload: {
    conversationId: string;
    messageIds: string[];
  }) => void;

  messages_read_update: (payload: {
    conversationId: string;
    lastSeenMessageId: string;
    readerId: string;
  }) => void;

  user_typing: (payload: TypingPayload & { userId: string }) => void;
  user_stopped_typing: (payload: TypingPayload & { userId: string }) => void;

  user_online: (payload: { userId: string }) => void;
  user_offline: (payload: { userId: string }) => void;

  group_created: (payload: ConversationListItemDto) => void;
  group_members_added:(payload:{
    conversationId:string;
    members:ConversationListUserDto[];
  })=>void;
  group_members_removed:(payload:{
    conversationId:string;
    removedUserIds:string[];
  })=>void;
  group_renamed:(payload:{
    conversationId:string;
    name:string;
  }) => void;

  group_member_left:(payload:{
    conversationId:string,
    userId:string;
    newAdminId?:string;
  }) => void;

  message_deleted: (payload: MessageDeletedPayload) => void;
  group_avatar_updated:(payload:{conversationId:string; groupAvatar:string}) => void;
  group_avatar_deleted:(payload:{conversationId:string;}) => void;
  member_promoted:(payload:{conversationId:string;promotedUserId:string}) => void;
  member_demoted:(payload:{conversationId:string;demoteUserId:string}) => void;
  message_pinned:(payload:{conversationId:string; messageId:string;pinnedBy:string})
  =>void;
  message_unpinned:(payload:{conversationId:string;messageId:string;})
  =>void;
  message_reaction_added:(payload:{conversationId:string;messageId:string;userId:string;emoji:string;})=>void;
  message_reaction_removed:(payload:{conversationId:string;messageId:string;userId:string;})=>void;

  "call:incoming": (payload: CallIncomingPayload) => void;
  "call:ringing": (payload: { callId: string }) => void;
  "call:accepted": (payload: CallAcceptedPayload) => void;
  "call:rejected": (payload: CallRejectedPayload) => void;
  "call:ended": (payload: CallEndedPayload) => void;

 
  "call:reconnecting": (payload: CallReconnectingPayload) => void;
  "call:failed": (payload: CallFailedPayload) => void;


  "webrtc:offer": (payload: WebRTCOfferPayload) => void;
  "webrtc:answer": (payload: WebRTCAnswerPayload) => void;
  "webrtc:ice-candidate": (payload: WebRTCIceCandidatePayload) => void;
  "webrtc:restart-ice": (payload: WebRTCRestartIcePayload) => void;

}

export interface SocketData {
  userId: string;
}

export type AuthenticatedSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  {},
  SocketData
>;

export type TypedIO = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  {},
  SocketData
>;

export type  SocketCallback<T=unknown> =
| ((res:{success:true;data:T})=>void)
| ((res:{success:false;error:string})=>void);


