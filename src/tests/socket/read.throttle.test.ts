import mongoose from "mongoose";
import Message from "../../modules/message/message.model";
import Conversation from "../../modules/conversation/conversation.model";
import { ConversationParticipant } from "../../modules/conversation/conversationParticipant.model";
import { registerMessageHandlers } from "../../socket/message.handler";

jest.setTimeout(30000);

describe("Socket - Read Idempotency & Stability", () => {
  let userA: mongoose.Types.ObjectId;
  let userB: mongoose.Types.ObjectId;
  let conversationId: mongoose.Types.ObjectId;
  let messageId: mongoose.Types.ObjectId;

  let socket: any;
  let io: any;
  let emitMock: jest.Mock;

  beforeEach(async () => {
    userA = new mongoose.Types.ObjectId();
    userB = new mongoose.Types.ObjectId();

    const conversation = await Conversation.create({
      participants: [userA, userB],
    });

    conversationId = conversation._id;

    await ConversationParticipant.create([
      { conversationId, userId: userA },
      { conversationId, userId: userB },
    ]);

    const message = await Message.create({
      conversation: conversationId,
      sender: userA,
      content: "hello",
      type: "text",
      clientTempId: new mongoose.Types.ObjectId().toString(), // ✅ FIX
      deliveredTo: [],
    });

    messageId = message._id;

    emitMock = jest.fn();

    io = {
      to: jest.fn(() => ({
        emit: emitMock,
      })),
    };

    socket = {
      data: { userId: userB.toString() },
      id: "socket1",
      rooms: new Set<string>(),
      join: jest.fn((room: string) => socket.rooms.add(room)),
      emit: jest.fn(),
      on: function (event: string, handler: any) {
        this[event] = handler;
      },
    };

    registerMessageHandlers(io, socket);
  });

  it("should allow only one effective read update under repeated calls", async () => {
    const calls = Array.from({ length: 5 }).map(() =>
      socket.messages_read(
        {
          conversationId: conversationId.toString(),
          lastSeenMessageId: messageId.toString(),
        },
        jest.fn(),
      ),
    );

    await Promise.all(calls);

    expect(io.to).toHaveBeenCalledTimes(1);
  });
});
