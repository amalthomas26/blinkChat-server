import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import authRoutes from "./modules/auth/auth.routes";
import conversationRoutes from "./modules/conversation/conversation.routes";
import messageRoutes from "./modules/message/message.routes";
import uploadRoutes from "./modules/upload/upload.routes";
import callRoutes from "./modules/call/call.routes";
import { errorHandler } from "./middleware/error";
import { corsOptions } from "./config/env";
import userRoutes from "./modules/user/user.routes";

const app = express();

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/webrtc", callRoutes);

app.get("/", (req, res) => {
  res.send("Api running..");
});

app.use(errorHandler);

export default app;
