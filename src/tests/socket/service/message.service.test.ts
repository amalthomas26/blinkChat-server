import mongoose from "mongoose";

import Conversation from "../../../modules/conversation/conversation.model";
import { ConversationParticipant } from "../../../modules/conversation/conversationParticipant.model";
import Message, { MessageType } from "../../../modules/message/message.model";
import {
  sendMessage,
  markMessagesDelivered,
  markConversationAsRead,
  syncMessages,
  fetchMessages,
  deleteMessage,
  reactToMessage,
  removeReaction,
} from "../../../modules/message/message.service";

jest.setTimeout(60000);

// ✅ helper to avoid duplicate key errors
const createTestMessage = async (
  conversationId: mongoose.Types.ObjectId,
  sender: mongoose.Types.ObjectId,
  content: string,
) => {
  return Message.create({
    conversation: conversationId,
    sender,
    content,
    type: "text",
    clientTempId: new mongoose.Types.ObjectId().toString(),
    deliveredTo: [],
  });
};

describe("Message Service - Day 12", () => {
  let userA: mongoose.Types.ObjectId;
  let userB: mongoose.Types.ObjectId;
  let conversationId: mongoose.Types.ObjectId;
  let messageId: mongoose.Types.ObjectId;

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

    const message = await createTestMessage(conversationId, userA, "hello");

    messageId = message._id;
  });

  // ---------------- DELIVERY ----------------

  it("should mark message as delivered", async () => {
    const result = await markMessagesDelivered({
      userId: userB.toString(),
      conversationId: conversationId.toString(),
      messageIds: [messageId.toString()],
    });

    expect(result.updatedCount).toBe(1);
    expect(result.messageIds).toEqual([messageId.toString()]);
  });

  it("should be idempotent for delivery", async () => {
    await markMessagesDelivered({
      userId: userB.toString(),
      conversationId: conversationId.toString(),
      messageIds: [messageId.toString()],
    });

    const result = await markMessagesDelivered({
      userId: userB.toString(),
      conversationId: conversationId.toString(),
      messageIds: [messageId.toString()],
    });

    expect(result.updatedCount).toBe(0);
  });

  it("should process every messageId in a batch", async () => {
    const secondMessage = await createTestMessage(conversationId, userA, "two");

    const result = await markMessagesDelivered({
      userId: userB.toString(),
      conversationId: conversationId.toString(),
      messageIds: [messageId.toString(), secondMessage._id.toString()],
    });

    expect(result.updatedCount).toBe(2);
    expect(result.messageIds).toEqual([
      messageId.toString(),
      secondMessage._id.toString(),
    ]);

    const deliveredMessages = await Message.find({
      _id: { $in: [messageId, secondMessage._id] },
      "deliveredTo.userId": userB,
    });

    expect(deliveredMessages).toHaveLength(2);
  });

  it("should treat concurrent duplicate sends as a single logical message", async () => {
    await Message.syncIndexes();

    const clientTempId = new mongoose.Types.ObjectId().toString();
    const payload = {
      conversationId: conversationId.toString(),
      clientTempId,
      type: MessageType.TEXT,
      content: "same-message",
    };

    const [firstResult, secondResult] = await Promise.all([
      sendMessage(userA.toString(), payload),
      sendMessage(userA.toString(), payload),
    ]);

    expect(firstResult.message._id).toBe(secondResult.message._id);
    expect([firstResult.wasCreated, secondResult.wasCreated].sort()).toEqual([
      false,
      true,
    ]);

    const storedMessages = await Message.find({
      sender: userA,
      clientTempId,
      conversation: conversationId,
    });

    expect(storedMessages).toHaveLength(1);
  });

  // ---------------- READ ----------------

  it("should mark conversation as read", async () => {
    const result = await markConversationAsRead({
      userId: userB.toString(),
      conversationId: conversationId.toString(),
      messageId: messageId.toString(),
    });

    expect(result.updated).toBe(true);
  });

  it("should be idempotent for read", async () => {
    await markConversationAsRead({
      userId: userB.toString(),
      conversationId: conversationId.toString(),
      messageId: messageId.toString(),
    });

    const result = await markConversationAsRead({
      userId: userB.toString(),
      conversationId: conversationId.toString(),
      messageId: messageId.toString(),
    });

    expect(result.updated).toBe(false);
  });

  it("should prevent out-of-order updates", async () => {
    const newer = await createTestMessage(conversationId, userA, "new");

    await markConversationAsRead({
      userId: userB.toString(),
      conversationId: conversationId.toString(),
      messageId: newer._id.toString(),
    });

    const result = await markConversationAsRead({
      userId: userB.toString(),
      conversationId: conversationId.toString(),
      messageId: messageId.toString(),
    });

    expect(result.updated).toBe(false);
  });

  // ---------------- SYNC ----------------

  it("should sync messages correctly", async () => {
    const msg2 = await createTestMessage(conversationId, userA, "second");

    const result = await syncMessages(
      userB.toString(),
      conversationId.toString(),
      messageId.toString(),
      10,
    );

    expect(result.messages.length).toBe(1);
    expect(result.messages[0]._id.toString()).toBe(msg2._id.toString());
  });

  it("should return empty if no new messages", async () => {
    const result = await syncMessages(
      userB.toString(),
      conversationId.toString(),
      messageId.toString(),
      10,
    );

    expect(result.messages.length).toBe(0);
  });

  // ---------------- SECURITY ----------------

  it("should reject non-participant read", async () => {
    const fakeUser = new mongoose.Types.ObjectId();

    await expect(
      markConversationAsRead({
        userId: fakeUser.toString(),
        conversationId: conversationId.toString(),
        messageId: messageId.toString(),
      }),
    ).rejects.toThrow();
  });

  it("should reject access when only the conversation document lists the user", async () => {
    const userC = new mongoose.Types.ObjectId();

    const splitConversation = await Conversation.create({
      participants: [userA, userC],
    });

    await ConversationParticipant.create({
      conversationId: splitConversation._id,
      userId: userC,
    });

    await createTestMessage(splitConversation._id, userC, "membership-check");

    await expect(
      sendMessage(userA.toString(), {
        conversationId: splitConversation._id.toString(),
        type: MessageType.TEXT,
        content: "blocked",
      }),
    ).rejects.toThrow("User is not a participant in this conversation");

    await expect(
      fetchMessages(userA.toString(), splitConversation._id.toString(), {
        limit: 1,
      }),
    ).rejects.toThrow("User is not a participant in this conversation");

    await expect(
      syncMessages(
        userA.toString(),
        splitConversation._id.toString(),
        undefined,
        10,
      ),
    ).rejects.toThrow("User is not a participant in this conversation");
  });

  it("should reject message from another conversation", async () => {
    const userC = new mongoose.Types.ObjectId();

    const otherConversation = await Conversation.create({
      participants: [userA, userC],
    });

    const foreignMessage = await createTestMessage(
      otherConversation._id,
      userA,
      "hacker",
    );

    await expect(
      markConversationAsRead({
        userId: userB.toString(),
        conversationId: conversationId.toString(),
        messageId: foreignMessage._id.toString(),
      }),
    ).rejects.toThrow();
  });

  it("should reject invalid objectIds", async () => {
    await expect(
      markConversationAsRead({
        userId: "invalid",
        conversationId: "invalid",
        messageId: "invalid",
      }),
    ).rejects.toThrow();
  });

  // ---------------- DELIVERY EDGE ----------------

  it("should handle duplicate messageIds safely", async () => {
    const result = await markMessagesDelivered({
      userId: userB.toString(),
      conversationId: conversationId.toString(),
      messageIds: [messageId.toString(), messageId.toString()],
    });

    expect(result.updatedCount).toBe(1);
    expect(result.messageIds).toEqual([messageId.toString()]);
  });

  // ---------------- SYNC EDGE ----------------

  it("should respect sync limit", async () => {
    await Promise.all(
      Array.from({ length: 5 }).map((_, i) =>
        createTestMessage(conversationId, userA, `msg-${i}`),
      ),
    );

    const result = await syncMessages(
      userB.toString(),
      conversationId.toString(),
      messageId.toString(),
      2,
    );

    expect(result.messages.length).toBeLessThanOrEqual(2);
  });

  // ---------------- MONOTONIC READ ----------------

  it("should always move lastSeenMessageId forward", async () => {
    const msg2 = await createTestMessage(conversationId, userA, "2");
    const msg3 = await createTestMessage(conversationId, userA, "3");

    await markConversationAsRead({
      userId: userB.toString(),
      conversationId: conversationId.toString(),
      messageId: msg2._id.toString(),
    });

    await markConversationAsRead({
      userId: userB.toString(),
      conversationId: conversationId.toString(),
      messageId: msg3._id.toString(),
    });

    const participant = await ConversationParticipant.findOne({
      conversationId,
      userId: userB,
    });

    expect(participant?.lastSeenMessageId?.toString()).toBe(
      msg3._id.toString(),
    );
  });

  // ---------------- CONCURRENCY ----------------

  it("should allow only one successful read update under concurrency", async () => {
    const calls = Array.from({ length: 5 }).map(() =>
      markConversationAsRead({
        userId: userB.toString(),
        conversationId: conversationId.toString(),
        messageId: messageId.toString(),
      }),
    );

    const results = await Promise.all(calls);

    const successCount = results.filter((r) => r.updated).length;

    expect(successCount).toBe(1);
  });

  // ---------------- DELETION ----------------

  it("should successfully delete a message and repair lastMessage pointer", async () => {
    const msg1 = await createTestMessage(conversationId, userA, "first");
    const msg2 = await createTestMessage(conversationId, userA, "second");

    // Manually set lastMessage to simulate a real conversation flow
    await Conversation.updateOne(
      { _id: conversationId },
      { $set: { lastMessage: msg2._id } }
    );

    const result = await deleteMessage(msg2._id.toString(), userA.toString());

    expect(result.messageId).toBe(msg2._id.toString());
    expect(result.conversationId).toBe(conversationId.toString());

    const deletedMsg = await Message.findById(msg2._id);
    expect(deletedMsg?.isDeleted).toBe(true);
    expect(deletedMsg?.content).toBeNull();

    const conversation = await Conversation.findById(conversationId);
    expect(conversation?.lastMessage?.toString()).toBe(msg1._id.toString());
  });

  it("should reject delete if user is not the sender", async () => {
    const msg = await createTestMessage(conversationId, userA, "private");
    await expect(deleteMessage(msg._id.toString(), userB.toString())).rejects.toThrow(
      "You can only delete your own messages"
    );
  });

  it("should reject already deleted messages to prevent double deletion", async () => {
    const msg = await createTestMessage(conversationId, userA, "hello");
    await deleteMessage(msg._id.toString(), userA.toString());
    await expect(deleteMessage(msg._id.toString(), userA.toString())).rejects.toThrow(
      "Message is already deleted"
    );
  });

  // ---------------- REPLIES ----------------

  it("should successfully send a reply message and attach a snapshot", async () => {
    const parentMsg = await createTestMessage(conversationId, userA, "parent");

    const payload = {
      conversationId: conversationId.toString(),
      type: MessageType.TEXT,
      content: "reply",
      replyTo: parentMsg._id.toString(),
    };

    const result = await sendMessage(userB.toString(), payload);

    expect(result.wasCreated).toBe(true);
    expect(result.message.replyTo).toBe(parentMsg._id.toString());
    expect(result.message.replyToSnapshot).toBeDefined();
    expect(result.message.replyToSnapshot?.senderId).toBe(userA.toString());
    expect(result.message.replyToSnapshot?.content).toBe("parent");
    expect(result.message.replyToSnapshot?.type).toBe("text");
  });

  it("should reject reply if the parent message doesn't belong to the conversation", async () => {
    const userC = new mongoose.Types.ObjectId();
    const otherConversation = await Conversation.create({
      participants: [userA, userC],
    });
    
    const foreignParent = await createTestMessage(otherConversation._id, userA, "secret");

    const payload = {
      conversationId: conversationId.toString(),
      type: MessageType.TEXT,
      content: "reply to secret",
      replyTo: foreignParent._id.toString(),
    };

    await expect(sendMessage(userB.toString(), payload)).rejects.toThrow(
      "Cannot reply:parent message not found in this conversation"
    );
  });

  it("should return undefined for content/mediaUrl in snapshot if parent is soft-deleted", async () => {
    const parentMsg = await createTestMessage(conversationId, userA, "delete me");
    await deleteMessage(parentMsg._id.toString(), userA.toString());

    const payload = {
      conversationId: conversationId.toString(),
      type: MessageType.TEXT,
      content: "reply to deleted",
      replyTo: parentMsg._id.toString(),
    };

    const result = await sendMessage(userB.toString(), payload);

    expect(result.message.replyTo).toBe(parentMsg._id.toString());
    expect(result.message.replyToSnapshot).toBeDefined();
    expect(result.message.replyToSnapshot?.senderId).toBe(userA.toString());
    expect(result.message.replyToSnapshot?.content).toBeUndefined();
  });

  // ---------------- REACTIONS ----------------

  it("should add a reaction to a message", async () => {
    await reactToMessage(messageId.toString(), userA.toString(), "👍");
    
    const msg = await Message.findById(messageId);
    expect(msg?.reactions).toBeDefined();
    expect(msg?.reactions?.length).toBe(1);
    expect(msg?.reactions?.[0].emoji).toBe("👍");
    expect(msg?.reactions?.[0].userId.toString()).toBe(userA.toString());
  });

  it("should reject an invalid emoji (length > 2)", async () => {
    await expect(
      reactToMessage(messageId.toString(), userA.toString(), "invalid")
    ).rejects.toThrow("Invalid emoji");
  });

  it("should replace the previous reaction if the same user reacts again", async () => {
    await reactToMessage(messageId.toString(), userA.toString(), "👍");
    await reactToMessage(messageId.toString(), userA.toString(), "👎"); // change mind
    
    const msg = await Message.findById(messageId);
    expect(msg?.reactions?.length).toBe(1);
    expect(msg?.reactions?.[0].emoji).toBe("👎");
  });

  it("should allow multiple different users to react to the same message", async () => {
    await reactToMessage(messageId.toString(), userA.toString(), "👍");
    await reactToMessage(messageId.toString(), userB.toString(), "❤️");
    
    const msg = await Message.findById(messageId);
    expect(msg?.reactions?.length).toBe(2);
  });

  it("should reject a reaction on a deleted message", async () => {
    await deleteMessage(messageId.toString(), userA.toString());
    
    await expect(
      reactToMessage(messageId.toString(), userB.toString(), "👍")
    ).rejects.toThrow("Message not found or deleted");
  });

  it("should successfully remove a reaction", async () => {
    await reactToMessage(messageId.toString(), userA.toString(), "👍");
    await reactToMessage(messageId.toString(), userB.toString(), "❤️");
    
    await removeReaction(messageId.toString(), userA.toString());
    
    const msg = await Message.findById(messageId);
    expect(msg?.reactions?.length).toBe(1);
    expect(msg?.reactions?.[0].emoji).toBe("❤️"); // User B's reaction remains
  });
});
