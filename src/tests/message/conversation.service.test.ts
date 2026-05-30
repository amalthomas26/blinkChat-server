import mongoose from "mongoose";

import Conversation from "../../modules/conversation/conversation.model";
import {
  getConversationForUser,
  listConversationsForUser,
  muteConversation,
  unmuteConversation,
  pinConversation,
  unpinConversation,
  addGroupMember,
  removeGroupMember,
  renameGroup,
  leaveGroup,
} from "../../modules/conversation/conversation.service";
import { ConversationParticipant } from "../../modules/conversation/conversationParticipant.model";
import Message, { MessageType } from "../../modules/message/message.model";
import { User } from "../../modules/user/user.model";

jest.setTimeout(20000);

const createUser = async ({
  id,
  name,
  email,
}: {
  id: mongoose.Types.ObjectId;
  name: string;
  email: string;
}) => {
  await User.create({
    _id: id,
    name,
    email,
    password: "password123",
  });
};

const createDirectConversation = async (
  participants: mongoose.Types.ObjectId[],
) => {
  const conversation = await Conversation.create({
    participants,
    isGroup: false,
  });

  return conversation;
};

const createMessageForConversation = async ({
  conversationId,
  senderId,
  content,
}: {
  conversationId: mongoose.Types.ObjectId;
  senderId: mongoose.Types.ObjectId;
  content: string;
}) => {
  const message = await Message.create({
    conversation: conversationId,
    sender: senderId,
    content,
    type: MessageType.TEXT,
    clientTempId: new mongoose.Types.ObjectId().toString(),
    deliveredTo: [
      {
        userId: senderId,
        deliveredAt: new Date(),
      },
    ],
  });

  await Conversation.updateOne(
    { _id: conversationId },
    {
      $set: {
        lastMessage: message._id,
        updatedAt: message.createdAt,
      },
    },
  );

  return message;
};

describe("Conversation Service - conversation list retrieval", () => {
  it("returns sidebar-ready conversations ordered by latest activity", async () => {
    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();
    const userC = new mongoose.Types.ObjectId();

    await Promise.all([
      createUser({
        id: userA,
        name: "Alice",
        email: "alice@example.com",
      }),
      createUser({
        id: userB,
        name: "Bob",
        email: "bob@example.com",
      }),
      createUser({
        id: userC,
        name: "Cara",
        email: "cara@example.com",
      }),
    ]);

    const olderConversation = await createDirectConversation([userA, userB]);
    await ConversationParticipant.create([
      { conversationId: olderConversation._id, userId: userA },
      { conversationId: olderConversation._id, userId: userB },
    ]);

    const olderMessage = await createMessageForConversation({
      conversationId: olderConversation._id,
      senderId: userB,
      content: "older-message",
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    const newerConversation = await createDirectConversation([userA, userC]);
    await ConversationParticipant.create([
      { conversationId: newerConversation._id, userId: userA },
      { conversationId: newerConversation._id, userId: userC },
    ]);

    await createMessageForConversation({
      conversationId: newerConversation._id,
      senderId: userA,
      content: "newer-message",
    });

    await ConversationParticipant.updateOne(
      {
        conversationId: olderConversation._id,
        userId: userA,
      },
      {
        $set: {
          lastSeenMessageId: olderMessage._id,
        },
      },
    );

    const { conversations } = await listConversationsForUser(userA.toString());

    expect(conversations).toHaveLength(2);
    expect(conversations[0].id).toBe(newerConversation._id.toString());
    expect(conversations[0].type).toBe("direct");
    expect(conversations[0].name).toBe("Cara");
    expect(conversations[0].peer?.id).toBe(userC.toString());
    expect(conversations[0].lastMessage?.content).toBe("newer-message");
    expect(conversations[0].unread.hasUnread).toBe(false);

    expect(conversations[1].id).toBe(olderConversation._id.toString());
    expect(conversations[1].peer?.id).toBe(userB.toString());
    expect(conversations[1].participants).toHaveLength(2);
    expect(conversations[1].lastMessage?.content).toBe("older-message");
    expect(conversations[1].unread.hasUnread).toBe(false);
    expect(conversations[1].unread.lastSeenMessageId).toBe(
      olderMessage._id.toString(),
    );
  });

  it("marks peer-authored latest messages as unread when lastSeenMessageId is missing", async () => {
    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();

    await Promise.all([
      createUser({
        id: userA,
        name: "Alice",
        email: "alice-unread@example.com",
      }),
      createUser({
        id: userB,
        name: "Bob",
        email: "bob-unread@example.com",
      }),
    ]);

    const conversation = await createDirectConversation([userA, userB]);

    await ConversationParticipant.create([
      {
        conversationId: conversation._id,
        userId: userA,
        lastSeenMessageId: null,
      },
      {
        conversationId: conversation._id,
        userId: userB,
        lastSeenMessageId: null,
      },
    ]);

    const latestMessage = await createMessageForConversation({
      conversationId: conversation._id,
      senderId: userB,
      content: "unread-message",
    });

    const { conversations } = await listConversationsForUser(userA.toString());

    expect(conversations).toHaveLength(1);
    expect(conversations[0].lastMessage?.id).toBe(latestMessage._id.toString());
    expect(conversations[0].unread.hasUnread).toBe(true);
    expect(conversations[0].unread.lastSeenMessageId).toBeNull();
  });

  it("uses ConversationParticipant rows as the inbox source of truth", async () => {
    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();
    const userGhost = new mongoose.Types.ObjectId();

    await Promise.all([
      createUser({
        id: userA,
        name: "Alice",
        email: "alice-canonical@example.com",
      }),
      createUser({
        id: userB,
        name: "Bob",
        email: "bob-canonical@example.com",
      }),
      createUser({
        id: userGhost,
        name: "Ghost",
        email: "ghost@example.com",
      }),
    ]);

    const visibleConversation = await createDirectConversation([userA, userB]);
    await ConversationParticipant.create([
      { conversationId: visibleConversation._id, userId: userA },
      { conversationId: visibleConversation._id, userId: userB },
    ]);

    const hiddenConversation = await createDirectConversation([
      userA,
      userGhost,
    ]);
    await ConversationParticipant.create({
      conversationId: hiddenConversation._id,
      userId: userGhost,
    });

    const { conversations } = await listConversationsForUser(userA.toString());

    expect(conversations).toHaveLength(1);
    expect(conversations[0].id).toBe(visibleConversation._id.toString());
  });

  it("builds sidebar participant data from membership rows", async () => {
    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();
    const userGhost = new mongoose.Types.ObjectId();

    await Promise.all([
      createUser({
        id: userA,
        name: "Alice",
        email: "alice-participants@example.com",
      }),
      createUser({
        id: userB,
        name: "Bob",
        email: "bob-participants@example.com",
      }),
      createUser({
        id: userGhost,
        name: "Ghost",
        email: "ghost-participants@example.com",
      }),
    ]);

    const conversation = await createDirectConversation([userA, userB]);
    await ConversationParticipant.create([
      { conversationId: conversation._id, userId: userA },
      { conversationId: conversation._id, userId: userGhost },
    ]);

    const { conversations } = await listConversationsForUser(userA.toString());

    expect(conversations).toHaveLength(1);
    expect(conversations[0].peer?.id).toBe(userGhost.toString());
    expect(
      conversations[0].participants.map((participant) => participant.id),
    ).toEqual([userA.toString(), userGhost.toString()]);
  });

  it("uses membership rows as the canonical access source for conversation reads", async () => {
    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();

    await Promise.all([
      createUser({
        id: userA,
        name: "Alice",
        email: "alice-access@example.com",
      }),
      createUser({
        id: userB,
        name: "Bob",
        email: "bob-access@example.com",
      }),
    ]);

    const conversation = await createDirectConversation([userA, userB]);
    await ConversationParticipant.create({
      conversationId: conversation._id,
      userId: userB,
    });

    await expect(
      getConversationForUser(conversation._id.toString(), userA.toString()),
    ).rejects.toThrow("User is not a participant in this conversation");
  });

  it("rejects invalid user ids", async () => {
    await expect(listConversationsForUser("invalid-user-id")).rejects.toThrow(
      "Invalid userId",
    );
  });
});

describe("Conversation Service - listConversationsForUser pagination", () => {
  it("returns hasNextPage:false and nextCursor:null when all conversations fit on one page", async () => {
    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();

    await Promise.all([
      createUser({
        id: userA,
        name: "Alice",
        email: "alice-page1@example.com",
      }),
      createUser({ id: userB, name: "Bob", email: "bob-page1@example.com" }),
    ]);

    const conv = await createDirectConversation([userA, userB]);
    await ConversationParticipant.create([
      { conversationId: conv._id, userId: userA },
      { conversationId: conv._id, userId: userB },
    ]);
    await createMessageForConversation({
      conversationId: conv._id,
      senderId: userB,
      content: "hello",
    });

    const result = await listConversationsForUser(userA.toString(), {
      limit: 10,
    });

    expect(result.conversations).toHaveLength(1);
    expect(result.hasNextPage).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("returns hasNextPage:true and a nextCursor when more conversations exist beyond the limit", async () => {
    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();
    const userC = new mongoose.Types.ObjectId();

    await Promise.all([
      createUser({
        id: userA,
        name: "Alice",
        email: "alice-hasnext@example.com",
      }),
      createUser({ id: userB, name: "Bob", email: "bob-hasnext@example.com" }),
      createUser({
        id: userC,
        name: "Cara",
        email: "cara-hasnext@example.com",
      }),
    ]);

    const conv1 = await createDirectConversation([userA, userB]);
    await ConversationParticipant.create([
      { conversationId: conv1._id, userId: userA },
      { conversationId: conv1._id, userId: userB },
    ]);
    await createMessageForConversation({
      conversationId: conv1._id,
      senderId: userB,
      content: "msg1",
    });
    await new Promise((r) => setTimeout(r, 100));

    const conv2 = await createDirectConversation([userA, userC]);
    await ConversationParticipant.create([
      { conversationId: conv2._id, userId: userA },
      { conversationId: conv2._id, userId: userC },
    ]);
    await createMessageForConversation({
      conversationId: conv2._id,
      senderId: userC,
      content: "msg2",
    });

    const page1 = await listConversationsForUser(userA.toString(), {
      limit: 1,
    });

    expect(page1.conversations).toHaveLength(1);
    expect(page1.hasNextPage).toBe(true);
    expect(page1.nextCursor).not.toBeNull();
    expect(page1.conversations[0].id).toBe(conv2._id.toString());
  });

  it("returns the correct second page when a cursor is provided", async () => {
    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();
    const userC = new mongoose.Types.ObjectId();

    await Promise.all([
      createUser({
        id: userA,
        name: "Alice",
        email: "alice-page2@example.com",
      }),
      createUser({ id: userB, name: "Bob", email: "bob-page2@example.com" }),
      createUser({ id: userC, name: "Cara", email: "cara-page2@example.com" }),
    ]);

    const olderConv = await createDirectConversation([userA, userB]);
    await ConversationParticipant.create([
      { conversationId: olderConv._id, userId: userA },
      { conversationId: olderConv._id, userId: userB },
    ]);
    await createMessageForConversation({
      conversationId: olderConv._id,
      senderId: userB,
      content: "older",
    });
    await new Promise((r) => setTimeout(r, 100));

    const newerConv = await createDirectConversation([userA, userC]);
    await ConversationParticipant.create([
      { conversationId: newerConv._id, userId: userA },
      { conversationId: newerConv._id, userId: userC },
    ]);
    await createMessageForConversation({
      conversationId: newerConv._id,
      senderId: userC,
      content: "newer",
    });

    const page1 = await listConversationsForUser(userA.toString(), {
      limit: 1,
    });
    expect(page1.conversations[0].id).toBe(newerConv._id.toString());
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listConversationsForUser(userA.toString(), {
      limit: 1,
      cursor: page1.nextCursor!,
    });

    expect(page2.conversations).toHaveLength(1);
    expect(page2.conversations[0].id).toBe(olderConv._id.toString());
    expect(page2.hasNextPage).toBe(false);
    expect(page2.nextCursor).toBeNull();
  });

  it("throws ApiError 400 for an invalid cursor string", async () => {
    const userA = new mongoose.Types.ObjectId();
    await createUser({
      id: userA,
      name: "Alice",
      email: "alice-badcursor@example.com",
    });

    await expect(
      listConversationsForUser(userA.toString(), { cursor: "not-a-date" }),
    ).rejects.toThrow("Invalid cursor");
  });

  it("returns empty result with hasNextPage:false when user has no conversations", async () => {
    const userA = new mongoose.Types.ObjectId();
    await createUser({
      id: userA,
      name: "Alice",
      email: "alice-empty@example.com",
    });

    const result = await listConversationsForUser(userA.toString());

    expect(result.conversations).toHaveLength(0);
    expect(result.hasNextPage).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("correctly detects hasNextPage:false when result count exactly equals limit", async () => {
    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();

    await Promise.all([
      createUser({
        id: userA,
        name: "Alice",
        email: "alice-exact@example.com",
      }),
      createUser({ id: userB, name: "Bob", email: "bob-exact@example.com" }),
    ]);

    const conv = await createDirectConversation([userA, userB]);
    await ConversationParticipant.create([
      { conversationId: conv._id, userId: userA },
      { conversationId: conv._id, userId: userB },
    ]);
    await createMessageForConversation({
      conversationId: conv._id,
      senderId: userB,
      content: "only-msg",
    });

    const result = await listConversationsForUser(userA.toString(), {
      limit: 1,
    });

    expect(result.conversations).toHaveLength(1);
    expect(result.hasNextPage).toBe(false);
    expect(result.nextCursor).toBeNull();
  });
});

describe("Conversation Service - Mute and Pin Features", () => {
  let userA: string;
  let userB: string;
  let convId: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    userA = new mongoose.Types.ObjectId().toString();
    userB = new mongoose.Types.ObjectId().toString();

    await createUser({ id: new mongoose.Types.ObjectId(userA), name: "Alice", email: "alice-features@test.com" });
    await createUser({ id: new mongoose.Types.ObjectId(userB), name: "Bob", email: "bob-features@test.com" });

    const conv = await createDirectConversation([new mongoose.Types.ObjectId(userA), new mongoose.Types.ObjectId(userB)]);
    convId = conv._id.toString();

    await ConversationParticipant.create([
      { conversationId: conv._id, userId: userA },
      { conversationId: conv._id, userId: userB },
    ]);
  });

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

  describe("muteConversation", () => {
    it("should successfully mute a conversation forever", async () => {
      const result = await muteConversation(convId, userA, null);
      expect(result.isMuted).toBe(true);
      expect(result.mutedUntill).toBeNull();

      const participant = await ConversationParticipant.findOne({ conversationId: convId, userId: userA });
      expect(participant?.isMuted).toBe(true);
      expect(participant?.mutedUntill).toBeNull();
    });

    it("should successfully mute a conversation until a specific date", async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);
      const result = await muteConversation(convId, userA, futureDate.toISOString());
      
      expect(result.isMuted).toBe(true);
      expect(result.mutedUntill).toBe(futureDate.toISOString());
    });
  });

  describe("unmuteConversation", () => {
    it("should successfully unmute a conversation", async () => {
      await muteConversation(convId, userA, null);
      const result = await unmuteConversation(convId, userA);
      
      expect(result.isMuted).toBe(false);

      const participant = await ConversationParticipant.findOne({ conversationId: convId, userId: userA });
      expect(participant?.isMuted).toBe(false);
      expect(participant?.mutedUntill).toBeNull();
    });
  });

  describe("pinConversation", () => {
    it("should successfully pin a conversation", async () => {
      await pinConversation(convId, userA);
      
      const participant = await ConversationParticipant.findOne({ conversationId: convId, userId: userA });
      expect(participant?.isPinned).toBe(true);
      expect(participant?.pinnedAt).toBeTruthy();
    });
  });

  describe("unpinConversation", () => {
    it("should successfully unpin a conversation", async () => {
      await pinConversation(convId, userA);
      await unpinConversation(convId, userA);

      const participant = await ConversationParticipant.findOne({ conversationId: convId, userId: userA });
      expect(participant?.isPinned).toBe(false);
      expect(participant?.pinnedAt).toBeNull();
    });
  });
});

describe("Conversation Service - Group Actions", () => {
  let adminId: string;
  let memberId: string;
  let newUserId: string;
  let convId: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    adminId = new mongoose.Types.ObjectId().toString();
    memberId = new mongoose.Types.ObjectId().toString();
    newUserId = new mongoose.Types.ObjectId().toString();

    await createUser({ id: new mongoose.Types.ObjectId(adminId), name: "Admin", email: "admin@test.com" });
    await createUser({ id: new mongoose.Types.ObjectId(memberId), name: "Member", email: "member@test.com" });
    await createUser({ id: new mongoose.Types.ObjectId(newUserId), name: "New User", email: "new@test.com" });

    const conv = await Conversation.create({
      participants: [adminId, memberId],
      isGroup: true,
      groupAdmin: adminId,
      maxParticipants: 10,
    });
    convId = conv._id.toString();

    await ConversationParticipant.create([
      { conversationId: conv._id, userId: adminId, role: "admin" },
      { conversationId: conv._id, userId: memberId, role: "member" },
    ]);
  });

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

  describe("addGroupMember", () => {
    it("should allow admin to add a new member", async () => {
      await addGroupMember(convId, adminId, [newUserId]);

      const participant = await ConversationParticipant.findOne({ conversationId: convId, userId: newUserId });
      expect(participant).toBeTruthy();
      expect(participant?.role).toBe("member");
    });

    it("should reject non-admin from adding members", async () => {
      await expect(addGroupMember(convId, memberId, [newUserId])).rejects.toThrow("Only group admins can perform this action");
    });
  });

  describe("removeGroupMember", () => {
    it("should allow admin to remove a member", async () => {
      await removeGroupMember(convId, adminId, [memberId]);

      const participant = await ConversationParticipant.findOne({ conversationId: convId, userId: memberId });
      expect(participant).toBeNull();
    });

    it("should prevent admin from removing themselves", async () => {
      await expect(removeGroupMember(convId, adminId, [adminId])).rejects.toThrow("Admin cannot remove themselves");
    });
  });

  describe("renameGroup", () => {
    it("should allow admin to rename the group", async () => {
      await renameGroup(convId, adminId, "New Name");
      const conv = await Conversation.findById(convId);
      expect(conv?.groupName).toBe("New Name");
    });
  });

  describe("leaveGroup", () => {
    it("should allow member to leave", async () => {
      await leaveGroup(convId, memberId);

      const participant = await ConversationParticipant.findOne({ conversationId: convId, userId: memberId });
      expect(participant).toBeNull();
    });

    it("should reassign admin when admin leaves", async () => {
      await leaveGroup(convId, adminId);

      const participant = await ConversationParticipant.findOne({ conversationId: convId, userId: memberId });
      expect(participant?.role).toBe("admin");
    });
  });
});
