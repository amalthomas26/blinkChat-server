import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";

import { corsOptions } from "./config/env";
import { errorHandler } from "./middleware/error";
import authRoutes from "./modules/auth/auth.routes";
import callRoutes from "./modules/call/call.routes";
import conversationRoutes from "./modules/conversation/conversation.routes";
import messageRoutes from "./modules/message/message.routes";
import uploadRoutes from "./modules/upload/upload.routes";
import userRoutes from "./modules/user/user.routes";

const app = express();

// Trust the first proxy in front of this server (Nginx, Railway, Render, etc.)
// Required for req.ip to be the real client IP, otherwise rate limiters
// would bucket all users under the proxy's single IP address.
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use(helmet());
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "50kb" }));
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
