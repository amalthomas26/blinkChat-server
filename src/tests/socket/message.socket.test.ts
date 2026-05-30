
import Conversation from "../../modules/conversation/conversation.model";
import { getConversationForUser } from "../../modules/conversation/conversation.service";
import {
  sendMessage,
  markConversationAsRead,
  markMessagesDelivered,
  syncMessages,
} from "../../modules/message/message.service";
import type {
  ApiResponse,
  ConversationAccessErrorPayload,
} from "../../socket/socket.types";
import { ApiError } from "../../utils/ApiError";

import {
  setupSocketTest,
  teardownSocketTest,
  clientSocket,
  peerSocket,
} from "./setup";

jest.mock("../../modules/message/message.service", () => ({
  sendMessage: jest.fn(),
  markConversationAsRead: jest.fn(),
  markMessagesDelivered: jest.fn(),
  syncMessages: jest.fn(),
}));

jest.mock("../../modules/conversation/conversation.service", () => ({
  getConversationForUser: jest.fn(),
}));

jest.mock("../../modules/conversation/conversation.model", () => {
  const mockLean = jest.fn().mockResolvedValue({ isGroup: false });
  return {
    __esModule: true,
    default: {
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: mockLean }),
      }),
    },
  };
});

const expectSuccess = <T>(response: ApiResponse<T>): T => {
  expect(response.success).toBe(true);
  if (!response.success) {
    throw new Error(`Expected success response, received: ${response.error}`);
  }
  return response.data;
};

const conversationId = "507f1f77bcf86cd799439099";
const messageId = "507f1f77bcf86cd799439012";
const secondMessageId = "507f1f77bcf86cd799439013";
const userId = "507f1f77bcf86cd799439011";

const joinConversation = (socket: typeof clientSocket, done: () => void) => {
  socket.emit("join_conversation", conversationId, (response) => {
    expect(response.success).toBe(true);
    done();
  });
};

describe("Socket Message Handlers", () => {
  beforeAll((done) => setupSocketTest(done));
  afterAll(() => teardownSocketTest());

  beforeEach((done) => {
    jest.clearAllMocks();
    (getConversationForUser as jest.Mock).mockResolvedValue({
      _id: conversationId,
    });
    let pending = 2;

    const handleLeave = () => {
      pending -= 1;

      if (pending === 0) {
        done();
      }
    };

    clientSocket.emit("leave_conversation", conversationId, handleLeave);
    peerSocket.emit("leave_conversation", conversationId, handleLeave);
  });

  test("should authorize room join before joining conversation", (done) => {
    clientSocket.emit(
      "join_conversation",
      conversationId,
      (response) => {
        expect(response.success).toBe(true);
        expect(getConversationForUser).toHaveBeenCalledWith(
          conversationId,
          userId,
        );
        done();
      },
    );
  });

  test("should reject unauthorized room join with explicit error event", (done) => {
    let accessErrorPayload: ConversationAccessErrorPayload | undefined;

    (getConversationForUser as jest.Mock).mockRejectedValueOnce(
      new ApiError(403, "User is not a participant in this conversation"),
    );

    clientSocket.once("conversation_access_error", (payload) => {
      accessErrorPayload = payload;
    });

    clientSocket.emit(
      "join_conversation",
      conversationId,
      (response) => {
        expect(response.success).toBe(false);
        expect(response.error).toBe(
          "User is not a participant in this conversation",
        );

        setTimeout(() => {
          expect(accessErrorPayload).toEqual({
            conversationId,
            code: "CONVERSATION_ACCESS_DENIED",
            message: "User is not a participant in this conversation",
          });
          done();
        }, 30);
      },
    );
  });

  test("should send message and receive identical callback and broadcast data", (done) => {
    const messageDto = {
      _id: messageId,
      conversationId,
      senderId: userId,
      clientTempId: "temp123",
      type: "text",
      content: "Hello",
      createdAt: new Date().toISOString(),
      deliveredTo: [
        {
          userId,
          deliveredAt: new Date().toISOString(),
        },
      ],
    };

    (sendMessage as jest.Mock).mockResolvedValue({
      message: messageDto,
      wasCreated: true,
    });

    joinConversation(clientSocket, () => {
      clientSocket.once("receive_message", (msg) => {
        expect(msg).toEqual(messageDto);
        done();
      });

      clientSocket.emit(
        "send_message",
        {
          conversationId,
          content: "Hello",
          clientTempId: "temp123",
        },
        (response) => {
          expect(expectSuccess(response)).toEqual(messageDto);
        },
      );
    });
  });

  test("should mark messages as read", (done) => {
    (markConversationAsRead as jest.Mock).mockResolvedValue({
      updated: true,
    });

    clientSocket.emit(
      "messages_read",
      {
        conversationId,
        lastSeenMessageId: messageId,
      },
      (response) => {
        expect(expectSuccess(response).updatedCount).toBe(1);
        done();
      },
    );
  });

  test("should emit messages_read_update after joining the conversation", (done) => {
    (markConversationAsRead as jest.Mock).mockResolvedValue({
      updated: true,
    });

    // Ensure Conversation.findById returns a non-group conversation
    const mockLean = jest.fn().mockResolvedValue({ isGroup: false });
    (Conversation.findById as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: mockLean }),
    });

    joinConversation(clientSocket, () => {
      clientSocket.once("messages_read_update", (data) => {
        expect(data.readerId).toBe(userId);
        expect(data.lastSeenMessageId).toBe(messageId);
        done();
      });

      clientSocket.emit("messages_read", {
        conversationId,
        lastSeenMessageId: messageId,
      });
    });
  });

  test("should mark messages as delivered", (done) => {
    (markMessagesDelivered as jest.Mock).mockResolvedValue({
      updatedCount: 2,
      messageIds: [messageId, secondMessageId],
    });

    clientSocket.emit(
      "messages_delivered",
      {
        conversationId,
        messageIds: [messageId, secondMessageId],
      },
      (response) => {
        expect(expectSuccess(response)).toEqual({
          updatedCount: 2,
          messageIds: [messageId, secondMessageId],
        });
        expect(markMessagesDelivered).toHaveBeenCalledWith({
          userId,
          conversationId,
          messageIds: [messageId, secondMessageId],
        });
        done();
      },
    );
  });

  test("should emit messages_delivered_update after joining the conversation", (done) => {
    (markMessagesDelivered as jest.Mock).mockResolvedValue({
      updatedCount: 2,
      messageIds: [messageId, secondMessageId],
    });

    joinConversation(clientSocket, () => {
      clientSocket.once("messages_delivered_update", (data) => {
        expect(data.conversationId).toBe(conversationId);
        expect(data.messageIds).toEqual([messageId, secondMessageId]);
        done();
      });

      clientSocket.emit("messages_delivered", {
        conversationId,
        messageIds: [messageId, secondMessageId],
      });
    });
  });

  test("should sync messages from the shared service result", (done) => {
    const syncedMessages = [
      {
        _id: messageId,
        conversationId,
        senderId: userId,
        clientTempId: "temp123",
        type: "text",
        content: "Hello",
        createdAt: new Date().toISOString(),
        deliveredTo: [],
      },
    ];

    (syncMessages as jest.Mock).mockResolvedValue({
      messages: syncedMessages,
      hasMore: false,
    });

    clientSocket.emit(
      "sync_messages",
      {
        conversationId,
        limit: 20,
      },
      (response) => {
        expect(expectSuccess(response)).toEqual(syncedMessages);
        done();
      },
    );
  });

  test("should broadcast typing events through the active socket flow", (done) => {
    joinConversation(clientSocket, () => {
      joinConversation(peerSocket, () => {
        clientSocket.once("user_typing", (data) => {
          expect(data).toEqual({
            conversationId,
            userId,
          });
          done();
        });

        peerSocket.emit("typing_start", {
          conversationId,
        });
      });
    });
  });

  test("should return duplicate send success without rebroadcasting", (done) => {
    const messageDto = {
      _id: messageId,
      conversationId,
      senderId: userId,
      clientTempId: "temp123",
      type: "text",
      content: "Hello",
      createdAt: new Date().toISOString(),
      deliveredTo: [],
    };

    (sendMessage as jest.Mock).mockResolvedValue({
      message: messageDto,
      wasCreated: false,
    });

    joinConversation(clientSocket, () => {
      const receiveMessageSpy = jest.fn();
      clientSocket.on("receive_message", receiveMessageSpy);

      clientSocket.emit(
        "send_message",
        {
          conversationId,
          content: "Hello",
          clientTempId: "temp123",
        },
        (response) => {
          expect(expectSuccess(response)).toEqual(messageDto);

          setTimeout(() => {
            expect(receiveMessageSpy).not.toHaveBeenCalled();
            clientSocket.off("receive_message", receiveMessageSpy);
            done();
          }, 30);
        },
      );
    });
  });
});
