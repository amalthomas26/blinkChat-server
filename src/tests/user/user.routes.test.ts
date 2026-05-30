import mongoose from "mongoose";
import request from "supertest";

import app from "../../app";
import { runtimeConfig as config } from "../../config/env";
import { User } from "../../modules/user/user.model";
import { generateAccessToken } from "../../utils/token.utils";

jest.mock("../../modules/upload/upload.service", () => ({
  deleteFile: jest.fn(),
  uploadBase64: jest.fn(),
}));

describe("User Routes - PATCH /api/users/me", () => {
  let userId: mongoose.Types.ObjectId;
  let token: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = "test-secret";
    userId = new mongoose.Types.ObjectId();
    token = generateAccessToken({ userId: userId.toString() });

    await User.create({
      _id: userId,
      name: "Route Test Name",
      email: "routetest@example.com",
      password: "password123",
      avatar: `${config.cloudinary.baseUrl}/original.jpg`,
      avatarPublicId: `users/${userId}/original`,
      bio: "Route Test Bio",
    });
  });

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
        await collections[key].deleteMany({});
    }
  });

  it("should successfully update profile fields and return updated DTO", async () => {
    const response = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Updated Route Name",
        bio: "Updated Route Bio",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.name).toBe("Updated Route Name");
    expect(response.body.data.bio).toBe("Updated Route Bio");

    // Existing fields remain untouched
    expect(response.body.data.avatar).toBe(`${config.cloudinary.baseUrl}/original.jpg`);
  });

  it("should block unauthenticated access", async () => {
    const response = await request(app)
      .patch("/api/users/me")
      .send({
        name: "Hacker Name",
      });

    expect(response.status).toBe(401);
  });
  
  it("should enforce validation rules from the service layer via response payload", async () => {
      const response = await request(app)
        .patch("/api/users/me")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "  ", // Empty name
        });
  
      expect(response.status).toBe(400); // Because of ApiError
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Name cannot be empty");
  });
});
