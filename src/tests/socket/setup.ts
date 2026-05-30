import { createServer } from "http";

import { Server } from "socket.io";
import { io as Client, Socket as ClientSocket } from "socket.io-client";

import { registerMessageHandlers } from "../../socket/message.handler";
import { registerEvents } from "../../socket/socket.event";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "../../socket/socket.types";
import { registerTypingHandlers } from "../../socket/typing.handler";

export let io: Server<ClientToServerEvents, ServerToClientEvents>;
export let clientSocket: ClientSocket<
  ServerToClientEvents,
  ClientToServerEvents
>;
export let peerSocket: ClientSocket<
  ServerToClientEvents,
  ClientToServerEvents
>;
export let httpServer: ReturnType<typeof createServer>;

jest.setTimeout(30000);

export const setupSocketTest = (done: () => void) => {
  httpServer = createServer();

  io = new Server(httpServer);

  io.on("connection", (socket) => {
    socket.data.userId = "507f1f77bcf86cd799439011"; // mock user
    registerEvents(socket);
    registerMessageHandlers(io, socket);
    registerTypingHandlers(socket);
  });

  httpServer.listen(() => {
    const address = httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind test HTTP server");
    }
    const port = address.port;
    let connectedClients = 0;
    const handleConnect = () => {
      connectedClients += 1;

      if (connectedClients === 2) {
        done();
      }
    };

    clientSocket = Client(`http://localhost:${port}`);
    peerSocket = Client(`http://localhost:${port}`);

    clientSocket.on("connect", handleConnect);
    peerSocket.on("connect", handleConnect);
  });
};

export const teardownSocketTest = () => {
  io.close();
  clientSocket.close();
  peerSocket.close();
  httpServer.close();
};
