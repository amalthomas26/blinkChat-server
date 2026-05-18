import { 
  sendMessage as sendMessageController,
  reactToMessageController,
  removeReactionController
} from "../../modules/message/message.controller";
import { 
  sendMessage as sendMessageService,
  reactToMessage as reactToMessageService,
  removeReaction as removeReactionService
} from "../../modules/message/message.service";
import { getIO } from "../../socket/socket.server";
import { emitMessage } from "../../socket/socket.emitter";

jest.mock("../../modules/message/message.service", () => ({
  sendMessage: jest.fn(),
  fetchMessages: jest.fn(),
  reactToMessage: jest.fn(),
  removeReaction: jest.fn(),
}));

jest.mock("../../socket/socket.server", () => ({
  getIO: jest.fn(),
}));

jest.mock("../../socket/socket.emitter", () => ({
  emitMessage: jest.fn(),
}));

const createResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("Message Controller - sendMessage transport parity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("emits receive_message after a newly created REST send", async () => {
    const io = { to: jest.fn() } as any;
    const message = {
      _id: "507f1f77bcf86cd799439012",
      conversationId: "507f1f77bcf86cd799439099",
      senderId: "507f1f77bcf86cd799439011",
      clientTempId: "temp123",
      type: "text",
      content: "Hello from REST",
      createdAt: new Date().toISOString(),
      deliveredTo: [],
    };

    (getIO as jest.Mock).mockReturnValue(io);
    (sendMessageService as jest.Mock).mockResolvedValue({
      message,
      wasCreated: true,
    });

    const req: any = {
      user: { id: "507f1f77bcf86cd799439011" },
      body: {
        conversationId: message.conversationId,
        content: message.content,
        clientTempId: message.clientTempId,
      },
    };
    const res = createResponse();
    const next = jest.fn();

    await sendMessageController(req, res, next);

    expect(sendMessageService).toHaveBeenCalledWith(req.user.id, req.body);
    expect(getIO).toHaveBeenCalledTimes(1);
    expect(emitMessage).toHaveBeenCalledWith(
      io,
      message.conversationId,
      message,
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: message,
      clientTempId: message.clientTempId,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("does not emit again for an idempotent REST duplicate send", async () => {
    const message = {
      _id: "507f1f77bcf86cd799439012",
      conversationId: "507f1f77bcf86cd799439099",
      senderId: "507f1f77bcf86cd799439011",
      clientTempId: "temp123",
      type: "text",
      content: "Hello from REST",
      createdAt: new Date().toISOString(),
      deliveredTo: [],
    };

    (sendMessageService as jest.Mock).mockResolvedValue({
      message,
      wasCreated: false,
    });

    const req: any = {
      user: { id: "507f1f77bcf86cd799439011" },
      body: {
        conversationId: message.conversationId,
        content: message.content,
        clientTempId: message.clientTempId,
      },
    };
    const res = createResponse();
    const next = jest.fn();

    await sendMessageController(req, res, next);

    expect(getIO).not.toHaveBeenCalled();
    expect(emitMessage).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: message,
      clientTempId: message.clientTempId,
    });
    expect(next).not.toHaveBeenCalled();
  });
});

describe("Message Controller - Reactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockTo = jest.fn();
  const mockEmit = jest.fn();
  const io = {
    to: mockTo.mockReturnValue({ emit: mockEmit }),
  } as any;

  it("should successfully add a reaction and emit message_reaction_added", async () => {
    (getIO as jest.Mock).mockReturnValue(io);

    const req: any = {
      user: { id: "user_a_id" },
      params: { id: "msg_id" },
      body: {
        conversationId: "conv_id",
        emoji: "👍",
      },
    };
    const res = createResponse();
    const next = jest.fn();

    await reactToMessageController(req, res, next);

    expect(reactToMessageService).toHaveBeenCalledWith("msg_id", "user_a_id", "👍");
    expect(getIO).toHaveBeenCalledTimes(1);
    expect(mockTo).toHaveBeenCalledWith("conv_id");
    expect(mockEmit).toHaveBeenCalledWith("message_reaction_added", {
      conversationId: "conv_id",
      messageId: "msg_id",
      userId: "user_a_id",
      emoji: "👍"
    });
    
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, message: "Reaction added" });
    expect(next).not.toHaveBeenCalled();
  });

  it("should successfully remove a reaction and emit message_reaction_removed", async () => {
    (getIO as jest.Mock).mockReturnValue(io);

    const req: any = {
      user: { id: "user_a_id" },
      params: { id: "msg_id" },
      body: {
        conversationId: "conv_id",
      },
    };
    const res = createResponse();
    const next = jest.fn();

    await removeReactionController(req, res, next);

    expect(removeReactionService).toHaveBeenCalledWith("msg_id", "user_a_id");
    expect(getIO).toHaveBeenCalledTimes(1);
    expect(mockTo).toHaveBeenCalledWith("conv_id");
    expect(mockEmit).toHaveBeenCalledWith("message_reaction_removed", {
      conversationId: "conv_id",
      messageId: "msg_id",
      userId: "user_a_id",
    });
    
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, message: "Reaction removed" });
    expect(next).not.toHaveBeenCalled();
  });
});
