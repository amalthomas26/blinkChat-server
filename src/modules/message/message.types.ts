import type { ConversationListMessageDto } from "../conversation/conversation.types";

import  { MessageType } from "./message.model";

export interface SendMessageInput {
  conversationId: string;
  clientTempId?: string;
  type: MessageType;
  content?: string;
  mediaUrl?: string;
  mediaPublicId?:string;
  audioDuration?:number;
  thumbnailUrl?: string;
  fileName?: string;
  fileSize?: number;
  replyTo?:string;
}  //what the socket/controller receives FROM the client

export interface MessageDeliveryDto {
  userId: string;
  deliveredAt: string;
}

export interface MessageDto {
  _id: string;
  conversationId: string;
  senderId: string;
  clientTempId?: string;
  type: MessageType;
  content?: string;
  mediaUrl?: string;
  mediaPublicId?:string;
  audioDuration?:number;
  thumbnailUrl?: string;
  fileName?: string;
  fileSize?: number;
  callMeta?: {
    callType: "audio" | "video";
    status: "ended" | "missed" | "rejected" | "cancelled" | "failed";
    duration: number | null;
  };
  createdAt: string;
  deliveredTo: MessageDeliveryDto[];
  reactions?:{userId:string;emoji:string}[];
  replyTo?:string;
  replyToSnapshot?:{
    senderId:string;
    type:MessageType;
    content?:string;
    mediaUrl?:string;
  };
  forwardedFrom?:{
    originalSenderId:string;
    originalSenderName:string;
    originalMessageId:string;
    originalConversationId:string;
  };
} //what service sends back to client

export interface SendMessageResult {
  message: MessageDto;
  wasCreated: boolean;
}

export const MEDIA_TYPES =[
  MessageType.IMAGE,
  MessageType.AUDIO,
  MessageType.VIDEO,
  MessageType.FILE,
  
] as const

export interface SearchMessagesInput{
  query:string;
  limit?:number;
  before?:string;
}

export interface SearchMessagesResult{
  messages:MessageDto[];
  hasNextPage:boolean;
}

export interface ForwardMessageInput{
  sourceMessageId:string;
  targetConversationId:string;
}

export interface DeleteMessageResult {
  messageId: string;
  conversationId: string;
  deletedMessageSenderId: string;
  lastMessageChanged: boolean;
  lastMessage: ConversationListMessageDto | null;
  updatedAt: string;
}
