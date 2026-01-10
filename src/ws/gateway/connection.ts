import { Server as SocketIOServer, Socket } from "socket.io";
import { AuthenticatedSocket } from "../auth/authenticate";
import { presenceService } from "../presence/presence-service";
import { joinRoom, leaveRoom } from "../rooms/room-manager";

export const handleConnection = (io: SocketIOServer, socket: Socket) => {
  const authSocket = socket as AuthenticatedSocket;
  const user = authSocket.user;

  if (!user) {
    socket.disconnect();
    return;
  }

  console.log(`🔌 New WS connection: ${user.name} (${socket.id})`);

  // Inicializar presença
  presenceService.updatePresence(user.id, {
    name: user.name,
    socketId: socket.id,
    status: "ACTIVE",
  });

  // Evento: Entrar em uma sala
  socket.on("JOIN_ROOM", (data: { roomId: string }) => {
    joinRoom(io, authSocket, data.roomId);
  });

  // Evento: Sair de uma sala
  socket.on("LEAVE_ROOM", () => {
    leaveRoom(io, authSocket);
  });

  // Evento: Atualizar status de presença
  socket.on(
    "PRESENCE_UPDATE",
    (data: { status: "ACTIVE" | "IDLE" | "AWAY" }) => {
      const updated = presenceService.updatePresence(user.id, {
        status: data.status,
      });

      // Notificar no workspace/sala atual
      if (updated.currentRoomId) {
        io.to(updated.currentRoomId).emit("USER_PRESENCE_CHANGED", {
          userId: user.id,
          status: data.status,
        });
      }
    }
  );

  // Evento: Bater na porta (Request Access)
  socket.on("REQUEST_ACCESS", (data: { roomId: string }) => {
    // Notificar moderadores da sala/zona
    io.to(`mods-${data.roomId}`).emit("ACCESS_REQUESTED", {
      userId: user.id,
      name: user.name,
      roomId: data.roomId,
    });
    console.log(`🚪 User ${user.name} is knocking on room ${data.roomId}`);
  });

  // Evento: Mensagem / Evento de sala
  socket.on("ROOM_EVENT", (data: { roomId: string; payload: any }) => {
    // Verificar se o usuário está na sala
    if (socket.rooms.has(data.roomId)) {
      io.to(data.roomId).emit("ROOM_EVENT", {
        userId: user.id,
        roomId: data.roomId,
        payload: data.payload,
      });
    }
  });

  // Evento: Sinalização WebRTC (Unicast)
  socket.on(
    "WEBRTC_SIGNAL",
    (data: { to: string; signal: any; roomId: string }) => {
      // Opcional: validar se ambos estão na mesma sala por segurança
      io.to(data.to).emit("WEBRTC_SIGNAL", {
        from: user.id,
        signal: data.signal,
        roomId: data.roomId,
      });
    }
  );

  // Evento: Desconexão
  socket.on("disconnect", () => {
    console.log(`❌ WS disconnected: ${user.name} (${socket.id})`);

    const presence = presenceService.getPresence(user.id);
    if (presence?.currentRoomId) {
      io.to(presence.currentRoomId).emit("USER_LEFT_ROOM", {
        userId: user.id,
        roomId: presence.currentRoomId,
      });
    }

    presenceService.removePresence(user.id);
  });
};
