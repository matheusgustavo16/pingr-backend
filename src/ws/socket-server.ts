import { Server as SocketIOServer, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import { setupAuthMiddleware } from "./auth/authenticate";
import { handleConnection } from "./gateway/connection";

export class WebSocketServer {
  private static instance: WebSocketServer;
  private io: SocketIOServer;

  private constructor(httpServer: HttpServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: "*", // Configure conforme necessário para produção
        methods: ["GET", "POST"],
      },
      pingInterval: 10000,
      pingTimeout: 5000,
    });

    this.setupMiddlewares();
    this.setupEvents();

    console.log("📡 WebSocket Server initialized");
  }

  public static getInstance(httpServer?: HttpServer): WebSocketServer {
    if (!WebSocketServer.instance) {
      if (!httpServer) {
        throw new Error("HttpServer is required to initialize WebSocketServer");
      }
      WebSocketServer.instance = new WebSocketServer(httpServer);
    }
    return WebSocketServer.instance;
  }

  private setupMiddlewares() {
    this.io.use(setupAuthMiddleware);
  }

  private setupEvents() {
    this.io.on("connection", (socket: Socket) => {
      void handleConnection(this.io, socket);
    });
  }

  public getIO(): SocketIOServer {
    return this.io;
  }
}
