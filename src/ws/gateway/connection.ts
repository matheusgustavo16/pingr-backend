import { Server as SocketIOServer, Socket } from "socket.io";
import { AuthenticatedSocket } from "../auth/authenticate";
import { presenceService } from "../presence/presence-service";
import { joinRoom, leaveRoom, toOfficePresencePayload } from "../rooms/room-manager";
import { handleMediasoupEvents } from "./mediasoup-handler";
import { handleVoiceCommandEvents } from "./voice-command-handler";
import { handleQuickCallEvents } from "./quick-call-handler";
import { prisma } from "../../services/prisma.service";
import { MemberStatus } from "@prisma/client";

export const handleConnection = async (
  io: SocketIOServer,
  socket: Socket
) => {
  const authSocket = socket as AuthenticatedSocket;
  const user = authSocket.user;

  if (!user) {
    socket.disconnect();
    return;
  }

  handleMediasoupEvents(io, authSocket);
  handleVoiceCommandEvents(io, authSocket);
  handleQuickCallEvents(io, authSocket);

  // Sala pessoal do usuário, usada para notificações direcionadas (multi-tab/multi-device)
  socket.join(`user:${user.id}`);

  console.log(`🔌 New WS connection: ${user.name} (${socket.id})`);

  // Companies ativas do usuário — canal company-wide para o mapa do office
  const memberships = await prisma.companyMember.findMany({
    where: { userId: user.id, status: MemberStatus.ACTIVE },
    select: { companyId: true },
  });
  const companyIds = memberships.map((m) => m.companyId);

  for (const companyId of companyIds) {
    socket.join(`company:${companyId}`);
  }

  // Inicializar presença
  const presence = presenceService.updatePresence(user.id, {
    name: user.name,
    avatar: user.picture,
    socketId: socket.id,
    status: "ACTIVE",
    userStatus: user.status || "AVAILABLE",
    companyIds,
    // Mantém currentRoomId se já existir (reconexão / multi-tab)
    currentRoomId: presenceService.getPresence(user.id)?.currentRoomId,
  });

  // Marca acesso atual (útil se o usuário nunca desconectar limpo)
  void prisma.user
    .update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    })
    .catch((err) =>
      console.error("Erro ao atualizar lastSeenAt no connect:", err)
    );

  const onlinePayload = toOfficePresencePayload(presence);

  // Avisar outros da company que este user está online
  presenceService.emitToCompanies(io, companyIds, "USER_ONLINE", onlinePayload);

  // Snapshot para o próprio socket (todos os online nas companies dele)
  const seen = new Set<string>();
  const snapshot = [];
  for (const companyId of companyIds) {
    for (const p of presenceService.getCompanyPresence(companyId)) {
      if (seen.has(p.userId)) continue;
      seen.add(p.userId);
      snapshot.push(toOfficePresencePayload(p));
    }
  }
  socket.emit("OFFICE_PRESENCE_SNAPSHOT", { users: snapshot });

  // Evento: sync explícito (ex.: office carregou companyId)
  socket.on(
    "SYNC_OFFICE_PRESENCE",
    (
      data: { companyId: string },
      callback?: (payload: unknown) => void
    ) => {
      if (!data?.companyId || !companyIds.includes(data.companyId)) {
        if (typeof callback === "function") {
          callback({ users: [] });
        }
        return;
      }

      socket.join(`company:${data.companyId}`);
      const users = presenceService
        .getCompanyPresence(data.companyId)
        .map(toOfficePresencePayload);

      socket.emit("OFFICE_PRESENCE_SNAPSHOT", { users });
      if (typeof callback === "function") {
        callback({ users });
      }
    }
  );

  // Evento: Entrar em uma sala
  socket.on("JOIN_ROOM", (data: { roomId: string }) => {
    const token = (authSocket.roomJoinToken = (authSocket.roomJoinToken || 0) + 1);
    void joinRoom(io, authSocket, data.roomId, token);
  });

  // Evento: Sair de uma sala
  socket.on("LEAVE_ROOM", () => {
    // Invalida qualquer JOIN_ROOM em andamento (ainda resolvendo as queries
    // async abaixo) — sem isso ele aplicaria a presença depois do leave e
    // ficaria "grudado" na sala pra sempre (usuário já saiu da UI).
    authSocket.roomJoinToken = (authSocket.roomJoinToken || 0) + 1;
    leaveRoom(io, authSocket);
  });

  // Presença da sala sem join — usado pelo lobby de pré-entrada
  socket.on(
    "GET_ROOM_PRESENCE",
    (data: { roomId: string }, callback?: (payload: unknown) => void) => {
      const members = presenceService.getRoomPresence(data.roomId).map((p) => ({
        userId: p.userId,
        name: p.name,
        avatar: p.avatar,
        isMuted: p.isMuted || false,
        isDeafened: p.isDeafened || false,
      }));
      if (typeof callback === "function") {
        callback({ roomId: data.roomId, members });
      }
    }
  );

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

      presenceService.emitToCompanies(
        io,
        updated.companyIds,
        "OFFICE_PRESENCE_UPDATE",
        toOfficePresencePayload(updated)
      );
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

  // Evento: Traço de anotação sobre tela compartilhada (transient, não persistido)
  socket.on(
    "SCREEN_ANNOTATION_STROKE",
    (data: { roomId: string; producerUserId: string; [key: string]: any }) => {
      if (socket.rooms.has(data.roomId)) {
        socket.to(data.roomId).emit("SCREEN_ANNOTATION_STROKE", data);
      }
    }
  );

  // Evento: Limpar anotações da tela compartilhada
  socket.on(
    "SCREEN_ANNOTATION_CLEAR",
    (data: { roomId: string; producerUserId: string }) => {
      if (socket.rooms.has(data.roomId)) {
        socket.to(data.roomId).emit("SCREEN_ANNOTATION_CLEAR", data);
      }
    }
  );

  // Evento: Ping para medir latência
  socket.on("ping", (callback) => {
    if (typeof callback === "function") {
      callback();
    }
  });

  // Evento: Atualizar estado de mute/deafen
  socket.on(
    "VOICE_STATUS_UPDATE",
    (data: { roomId: string; isMuted: boolean; isDeafened: boolean }) => {
      const current = presenceService.getPresence(user.id);
      if (current?.currentRoomId === data.roomId) {
        // Atualizar presença com estado de voz
        const updated = presenceService.updatePresence(user.id, {
          isMuted: data.isMuted,
          isDeafened: data.isDeafened,
        });

        // Notificar outros na sala
        io.to(data.roomId).emit("USER_VOICE_STATUS_CHANGED", {
          userId: user.id,
          roomId: data.roomId,
          isMuted: data.isMuted,
          isDeafened: data.isDeafened,
        });

        presenceService.emitToCompanies(
          io,
          updated.companyIds,
          "OFFICE_PRESENCE_UPDATE",
          toOfficePresencePayload(updated)
        );
      }
    }
  );

  // Evento: Desconexão
  socket.on("disconnect", () => {
    console.log(`❌ WS disconnected: ${user.name} (${socket.id})`);

    const current = presenceService.getPresence(user.id);
    if (current?.currentRoomId) {
      io.to(current.currentRoomId).emit("USER_LEFT_ROOM", {
        userId: user.id,
        roomId: current.currentRoomId,
      });
    }

    if (current) {
      presenceService.emitToCompanies(io, current.companyIds, "USER_OFFLINE", {
        userId: user.id,
      });
    }

    presenceService.removePresence(user.id);

    // Persistir último acesso para a sidebar de pessoas offline
    void prisma.user
      .update({
        where: { id: user.id },
        data: { lastSeenAt: new Date() },
      })
      .catch((err) =>
        console.error("Erro ao atualizar lastSeenAt no disconnect:", err)
      );
  });
};
