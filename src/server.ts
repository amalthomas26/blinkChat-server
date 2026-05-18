import "./config/dotenv";
import http from "http";
import app from "./app";
import { initSocket } from "./socket/socket.server";
import { connectDB } from "./config/db";

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();

  const server = http.createServer(app);
  initSocket(server);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, () => {
      server.off("error", reject);
      console.log(`Server running on port ${PORT}`);
      resolve();
    });
  });
};

startServer().catch((error) => {
  console.error("Server bootstrap failed", error);
  process.exit(1);
});
