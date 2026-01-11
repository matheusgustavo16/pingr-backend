import { Server as SocketIOServer } from "socket.io";
import { AuthenticatedSocket } from "../auth/authenticate";
import { presenceService } from "../presence/presence-service";

export const joinRoom = (
  io: SocketIOServer,
  socket: AuthenticatedSocket,
  roomId: string
) => {
  if (!socket.user) return;

  // Lógica de autorização poderia ser adicionada aqui
  // Ex: verificar se o usuário tem permissão para entrar no workspace/sala

  // Sair da sala anterior se houver
  const presence = presenceService.getPresence(socket.user.id);
  if (presence?.currentRoomId) {
    socket.leave(presence.currentRoomId);
    io.to(presence.currentRoomId).emit("USER_LEFT_ROOM", {
      userId: socket.user.id,
      roomId: presence.currentRoomId,
    });
  }

  // Entrar na nova sala
  socket.join(roomId);

  // Atualizar presença
  presenceService.updatePresence(socket.user.id, {
    currentRoomId: roomId,
    name: socket.user.name,
    avatar: socket.user.picture,
    socketId: socket.id,
  });

  // Notificar outros na sala
  io.to(roomId).emit("USER_JOINED_ROOM", {
    userId: socket.user.id,
    name: socket.user.name,
    avatar: socket.user.picture,
    roomId: roomId,
  });

  // Enviar lista atual de usuários na sala para quem entrou
  const members = presenceService.getRoomPresence(roomId);
  socket.emit("ROOM_MEMBERS", { roomId, members });

  console.log(`👤 User ${socket.user.name} joined room ${roomId}`);
};

export const leaveRoom = (io: SocketIOServer, socket: AuthenticatedSocket) => {
  if (!socket.user) return;

  const presence = presenceService.getPresence(socket.user.id);
  if (presence?.currentRoomId) {
    const roomId = presence.currentRoomId;
    socket.leave(roomId);

    presenceService.updatePresence(socket.user.id, {
      currentRoomId: undefined,
    });

    io.to(roomId).emit("USER_LEFT_ROOM", {
      userId: socket.user.id,
      roomId: roomId,
    });

    console.log(`👤 User ${socket.user.name} left room ${roomId}`);
  }
};
