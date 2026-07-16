import { Server as SocketIOServer } from "socket.io";
import { AuthenticatedSocket } from "../auth/authenticate";
import { presenceService } from "../presence/presence-service";
import { prisma } from "../../services/prisma.service";

const userStatusToFrontend = (status?: string) => {
  const mapping: Record<string, string> = {
    AVAILABLE: "available",
    BUSY: "busy",
    IN_MEETING: "in-meeting",
    AWAY: "away",
    FOCUS: "focus",
    CODING: "coding",
    REVIEWING: "reviewing",
  };
  if (!status) return "available";
  return mapping[status] || status.toLowerCase();
};

export const toOfficePresencePayload = (p: {
  userId: string;
  name: string;
  avatar?: string | null;
  userStatus?: string;
  currentRoomId?: string;
  isMuted?: boolean;
  isDeafened?: boolean;
}) => ({
  userId: p.userId,
  name: p.name,
  avatar: p.avatar,
  currentRoomId: p.currentRoomId || null,
  status: userStatusToFrontend(p.userStatus),
  isMuted: p.isMuted || false,
  isDeafened: p.isDeafened || false,
});

export const joinRoom = async (
  io: SocketIOServer,
  socket: AuthenticatedSocket,
  roomId: string
) => {
  if (!socket.user) return;

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, companyId: true, isOpen: true },
  });

  if (!room) {
    console.warn(`🚫 JOIN_ROOM negado: sala ${roomId} não encontrada (user ${socket.user.id})`);
    socket.emit("JOIN_ROOM_DENIED", { roomId, reason: "Sala não encontrada." });
    return;
  }

  if (!room.isOpen) {
    const membership = await prisma.companyMember.findUnique({
      where: {
        userId_companyId: { userId: socket.user.id, companyId: room.companyId },
      },
    });
    const isOwner = await prisma.company.findFirst({
      where: { id: room.companyId, ownerId: socket.user.id },
      select: { id: true },
    });
    const isMember = isOwner || (membership && membership.status === "ACTIVE");

    if (!isMember) {
      console.warn(
        `🚫 JOIN_ROOM negado: user ${socket.user.id} não é membro ativo da company ${room.companyId} (sala ${roomId})`
      );
      socket.emit("JOIN_ROOM_DENIED", {
        roomId,
        reason: "Esta sala é privada. Faça login como membro para entrar.",
      });
      return;
    }
  }

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
  const updated = presenceService.updatePresence(socket.user.id, {
    currentRoomId: roomId,
    name: socket.user.name,
    avatar: socket.user.picture,
    socketId: socket.id,
    userStatus:
      socket.user.status ||
      presenceService.getPresence(socket.user.id)?.userStatus ||
      "AVAILABLE",
  });

  // Notificar outros na sala de voz
  io.to(roomId).emit("USER_JOINED_ROOM", {
    userId: socket.user.id,
    name: socket.user.name,
    avatar: socket.user.picture,
    roomId: roomId,
    status: userStatusToFrontend(
      socket.user.status ||
        presenceService.getPresence(socket.user.id)?.userStatus
    ),
    isMuted: updated.isMuted || false,
    isDeafened: updated.isDeafened || false,
  });

  // Notificar o mapa do office (company-wide)
  presenceService.emitToCompanies(
    io,
    updated.companyIds,
    "OFFICE_PRESENCE_UPDATE",
    toOfficePresencePayload(updated)
  );

  // Enviar lista atual de usuários na sala para quem entrou
  const members = presenceService.getRoomPresence(roomId).map((p) => ({
    userId: p.userId,
    name: p.name,
    avatar: p.avatar,
    status: userStatusToFrontend(p.userStatus),
    isMuted: p.isMuted || false,
    isDeafened: p.isDeafened || false,
  }));
  socket.emit("ROOM_MEMBERS", { roomId, members });

  console.log(`👤 User ${socket.user.name} joined room ${roomId}`);
};

export const leaveRoom = (io: SocketIOServer, socket: AuthenticatedSocket) => {
  if (!socket.user) return;

  const presence = presenceService.getPresence(socket.user.id);
  if (presence?.currentRoomId) {
    const roomId = presence.currentRoomId;
    socket.leave(roomId);

    const updated = presenceService.updatePresence(socket.user.id, {
      currentRoomId: undefined,
    });

    io.to(roomId).emit("USER_LEFT_ROOM", {
      userId: socket.user.id,
      roomId: roomId,
    });

    // Volta para a "recepção" no mapa do office
    presenceService.emitToCompanies(
      io,
      updated.companyIds,
      "OFFICE_PRESENCE_UPDATE",
      toOfficePresencePayload({ ...updated, currentRoomId: undefined })
    );

    console.log(`👤 User ${socket.user.name} left room ${roomId}`);
  }
};
