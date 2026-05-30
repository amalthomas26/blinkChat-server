import mongoose from "mongoose";

import { runtimeConfig as config } from "../../config/env";
import Conversation from "../../modules/conversation/conversation.model";
import { ConversationParticipant } from "../../modules/conversation/conversationParticipant.model";
import Message from "../../modules/message/message.model";
import * as uploadService from "../../modules/upload/upload.service";
import { Block } from "../../modules/user/block.model";
import { User } from "../../modules/user/user.model";
import { updateProfile, searchUsers, blockUser, unblockUser, getBlockedUsers, deleteAccount } from "../../modules/user/user.service";

jest.mock("../../modules/upload/upload.service", () => ({
  deleteFile: jest.fn(),
}));

describe("User Service - updateProfile", () => {
  let userId: mongoose.Types.ObjectId;

  beforeEach(async () => {
    jest.clearAllMocks();
    userId = new mongoose.Types.ObjectId();
    await User.create({
      _id: userId,
      name: "Original Name",
      email: "original@example.com",
      password: "password123",
      avatar: `${config.cloudinary.baseUrl}/original.jpg`,
      avatarPublicId: `users/${userId}/original`,
      bio: "Original Bio",
    });
  });

  afterEach(async () => {
     const collections = mongoose.connection.collections;
     for (const key in collections) {
         await collections[key].deleteMany({});
     }
  });

  it("should successfully update name and bio", async () => {
    const result = await updateProfile(userId.toString(), {
      name: "New Name",
      bio: "New Bio",
    });

    expect(result.name).toBe("New Name");
    expect(result.bio).toBe("New Bio");

    const userInDb = await User.findById(userId);
    expect(userInDb?.name).toBe("New Name");
    expect(userInDb?.bio).toBe("New Bio");
  });

  it("should successfully update avatar and avatarPublicId, and delete the old one", async () => {
    const newAvatarUrl = `${config.cloudinary.baseUrl}/new.jpg`;
    const newPublicId = `users/${userId}/new`;

    const result = await updateProfile(userId.toString(), {
      avatar: newAvatarUrl,
      avatarPublicId: newPublicId,
    });

    expect(result.avatar).toBe(newAvatarUrl);
    
    // Verify deleteFile was called with the old public id
    expect(uploadService.deleteFile).toHaveBeenCalledTimes(1);
    expect(uploadService.deleteFile).toHaveBeenCalledWith(`users/${userId}/original`, "image");
    
    const userInDb = await User.findById(userId);
    expect(userInDb?.avatar).toBe(newAvatarUrl);
    expect(userInDb?.avatarPublicId).toBe(newPublicId);
  });

  it("should trim name and reject empty names", async () => {
     await expect(
         updateProfile(userId.toString(), { name: "   " })
     ).rejects.toThrow("Name cannot be empty");
     
     const result = await updateProfile(userId.toString(), { name: "  Trimmed Name  " });
     expect(result.name).toBe("Trimmed Name");
  });
  
  it("should reject names exceeding 50 characters", async () => {
      const longName = "A".repeat(51);
      await expect(
         updateProfile(userId.toString(), { name: longName })
      ).rejects.toThrow("Name cannot exceed 50 characters");
  });

  it("should reject bios exceeding 200 characters", async () => {
      const longBio = "A".repeat(201);
      await expect(
         updateProfile(userId.toString(), { bio: longBio })
      ).rejects.toThrow("Bio cannot exceed 200 characters");
  });

  it("should reject providing avatar without avatarPublicId and vice versa", async () => {
      await expect(
          updateProfile(userId.toString(), { avatar: "http://example.com/img.jpg" })
      ).rejects.toThrow("Avatar and avatar must both be provided together");

      await expect(
          updateProfile(userId.toString(), { avatarPublicId: "some-id" })
      ).rejects.toThrow("Avatar and avatar must both be provided together");
  });
  
  it("should reject invalid avatar URLs not matching cloudinary base URL", async () => {
      await expect(
          updateProfile(userId.toString(), { 
              avatar: "http://malicious.com/img.jpg", 
              avatarPublicId: `users/${userId}/img`
           })
      ).rejects.toThrow("Invalid avatar URL");
  });

  it("should reject avatarPublicId that does not include the user's ID", async () => {
      const otherUserId = new mongoose.Types.ObjectId();
      await expect(
          updateProfile(userId.toString(), { 
              avatar: `${config.cloudinary.baseUrl}/img.jpg`, 
              avatarPublicId: `users/${otherUserId}/img`
           })
      ).rejects.toThrow("avatar asset does not belong to the user");
  });

  it("should throw ApiError for invalid valid user ID", async () => {
      await expect(updateProfile("invalid-id", { name: "test" })).rejects.toThrow("Invalid user ID");
  });
  
  it("should throw ApiError 404 if user not found", async () => {
      const unusedId = new mongoose.Types.ObjectId();
      await expect(updateProfile(unusedId.toString(), { name: "test" })).rejects.toThrow("User not found");
  });

});
// [NEW]: Production-grade test suite to guarantee Search always works
describe("User Service - searchUsers", () => {
  let requestingUserId: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    requestingUserId = new mongoose.Types.ObjectId().toString();

    // Seed the database with users to test the regex
    await User.create([
      {
        name: "Ajin Thomas",
        email: "ajin@example.com",
        password: "password123",
        provider: "local",
      },
      {
        name: "Alice Smith",
        email: "alice@example.com",
        password: "password123",
        provider: "local",
      },
      {
        name: "Aladdin",
        email: "aladdin@example.com",
        password: "password123",
        provider: "local",
      },
      {
        _id: requestingUserId,
        name: "Aladdin Requesting", // Matches "Al", but shouldn't be returned since it's the requester
        email: "aladdin_req@example.com",
        password: "password123",
        provider: "local",
      },
    ]);
  });

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

  it("should return an empty array if the query is empty or whitespace", async () => {
    const results = await searchUsers("   ", requestingUserId);
    expect(results).toEqual([]);
  });

  it("should match users by prefix, ignoring case, and sort them alphabetically", async () => {
    // "al" should match Alice and Aladdin
    const results = await searchUsers("al", requestingUserId);

    expect(results.length).toBe(2);
    // Verifying alphabetical sort behavior that was introduced
    expect(results[0].name).toBe("Aladdin");
    expect(results[1].name).toBe("Alice Smith"); 
  });

  it("should securely escape special regex characters to prevent injection", async () => {
    // A malicious user searching for .* should NOT match everything.
    // It should literally search for the string ".*"
    const results = await searchUsers(".*", requestingUserId);
    expect(results.length).toBe(0);
  });

  it("should not include the requesting user in the results even if they match", async () => {
    // "Aladdin" matches two documents, but one is the requester
    const results = await searchUsers("Aladdin", requestingUserId);
    
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("Aladdin");
  });
});

describe("User Service - Block Management", () => {
  let user1Id: string;
  let user2Id: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    user1Id = new mongoose.Types.ObjectId().toString();
    user2Id = new mongoose.Types.ObjectId().toString();

    await User.create([
      { _id: user1Id, name: "User One", email: "one@test.com", password: "password123", provider: "local" },
      { _id: user2Id, name: "User Two", email: "two@test.com", password: "password123", provider: "local" },
    ]);
  });

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

  describe("blockUser", () => {
    it("should successfully block a user", async () => {
      await blockUser(user1Id, user2Id);
      const blockDoc = await Block.findOne({ blocker: user1Id, blocked: user2Id });
      expect(blockDoc).toBeTruthy();
    });

    it("should fail when blocking oneself", async () => {
      await expect(blockUser(user1Id, user1Id)).rejects.toThrow("cannot block yourself");
    });

    it("should fail when blocking an already blocked user", async () => {
      await blockUser(user1Id, user2Id);
      await expect(blockUser(user1Id, user2Id)).rejects.toThrow("User is already blocked");
    });
  });

  describe("unblockUser", () => {
    it("should successfully unblock a user", async () => {
      await Block.create({ blocker: user1Id, blocked: user2Id });
      await unblockUser(user1Id, user2Id);
      const blockDoc = await Block.findOne({ blocker: user1Id, blocked: user2Id });
      expect(blockDoc).toBeNull();
    });

    it("should fail if user is not blocked", async () => {
      await expect(unblockUser(user1Id, user2Id)).rejects.toThrow("Block not found");
    });
  });

  describe("getBlockedUsers", () => {
    it("should return a list of blocked user IDs", async () => {
      await Block.create({ blocker: user1Id, blocked: user2Id });
      const blocked = await getBlockedUsers(user1Id);
      expect(blocked).toEqual([user2Id]);
    });
  });
});

describe("User Service - deleteAccount", () => {
  let userId: string;
  let otherUserId: string;
  let convId: string;
  let messageId: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    userId = new mongoose.Types.ObjectId().toString();
    otherUserId = new mongoose.Types.ObjectId().toString();
    convId = new mongoose.Types.ObjectId().toString();
    messageId = new mongoose.Types.ObjectId().toString();

    await User.create([
      { _id: userId, name: "To Delete", email: "del@test.com", password: "password123", provider: "local", avatarPublicId: "test_avatar_1" },
      { _id: otherUserId, name: "Other", email: "other@test.com", password: "password123", provider: "local" },
    ]);

    await Conversation.create({
      _id: convId,
      isGroup: true,
      groupAdmin: userId,
      participants: [userId, otherUserId],
      lastMessage: messageId,
    });

    await ConversationParticipant.create([
      { conversationId: convId, userId: userId, role: "admin" },
      { conversationId: convId, userId: otherUserId, role: "member" },
    ]);

    await Message.create({
      _id: messageId,
      conversation: convId,
      sender: userId,
      type: "text",
      content: "Hello",
      mediaPublicId: "test_media_1",
    });

    await Block.create({ blocker: userId, blocked: otherUserId });
  });

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

  // Skipped: deleteAccount uses MongoDB transactions which require a replica set.
  // MongoMemoryServer in standalone mode doesn't support transactions.
  it.skip("should successfully delete an account and reassign group admin", async () => {
    await deleteAccount(userId);

    // User should be deleted
    expect(await User.findById(userId)).toBeNull();

    // Media should be deleted (uploadService mocked)
    expect(uploadService.deleteFile).toHaveBeenCalledWith("test_avatar_1", "image");
    expect(uploadService.deleteFile).toHaveBeenCalledWith("test_media_1", "raw");

    // Messages should be anonymized (isDeleted: true, content: null)
    const msg = await Message.findById(messageId);
    expect(msg?.isDeleted).toBe(true);
    expect(msg?.content).toBeNull();
    expect(msg?.mediaPublicId).toBeNull();

    // Participant should be deleted
    expect(await ConversationParticipant.findOne({ userId })).toBeNull();

    // Block should be deleted
    expect(await Block.findOne({ blocker: userId })).toBeNull();

    // Group Admin should be reassigned to other user
    const conv = await Conversation.findById(convId);
    expect(conv?.groupAdmin?.toString()).toBe(otherUserId);
    expect(conv?.participants).not.toContain(new mongoose.Types.ObjectId(userId));

    const otherParticipant = await ConversationParticipant.findOne({ userId: otherUserId, conversationId: convId });
    expect(otherParticipant?.role).toBe("admin");
  });

  it.skip("should rollback transaction if an error occurs", async () => {
    // Force an error inside the transaction by making a schema error or mocking
    jest.spyOn(mongoose.Model, "updateMany").mockImplementationOnce(() => {
      throw new Error("Transaction simulated error");
    });

    await expect(deleteAccount(userId)).rejects.toThrow("Transaction simulated error");

    // User should NOT be deleted
    expect(await User.findById(userId)).toBeTruthy();
    // Participant should NOT be deleted
    expect(await ConversationParticipant.findOne({ userId })).toBeTruthy();
    // Block should NOT be deleted
    expect(await Block.findOne({ blocker: userId })).toBeTruthy();
  });
});

