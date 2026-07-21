import { randomUUID } from "crypto";
import { Server as SocketIOServer } from "socket.io";
import { AuthenticatedSocket } from "../auth/authenticate";
import { presenceService } from "../presence/presence-service";

const QUICK_CALL_TIMEOUT_MS = 30_000;

interface PendingQuickCall {
  inviteId: string;
  callerId: string;
  targetId: string;
  timer: ReturnType<typeof setTimeout>;
}

// Convites em memória (mesmo padrão do presenceService) — expiram sozinhos
// em 30s se ninguém responder; não precisam sobreviver a um restart.
const pendingCalls = new Map<string, PendingQuickCall>();

function clearInvite(inviteId: string) {
  const invite = pendingCalls.get(inviteId);
  if (!invite) return;
  clearTimeout(invite.timer);
  pendingCalls.delete(inviteId);
}

export const handleQuickCallEvents = (
  io: SocketIOServer,
  socket: AuthenticatedSocket
) => {
  const user = socket.user;
  if (!user) return;

  socket.on(
    "QUICK_CALL_INVITE",
    (
      data: { targetUserId: string },
      callback?: (res: { inviteId?: string; error?: string }) => void
    ) => {
      const targetUserId = data?.targetUserId;
      if (!targetUserId || targetUserId === user.id) {
        callback?.({ error: "Alvo inválido" });
        return;
      }

      if (!presenceService.getPresence(targetUserId)) {
        callback?.({ error: "Usuário está offline" });
        return;
      }

      const inviteId = randomUUID();
      const timer = setTimeout(() => {
        pendingCalls.delete(inviteId);
        io.to(`user:${targetUserId}`).emit("QUICK_CALL_TIMEOUT", { inviteId });
        io.to(`user:${user.id}`).emit("QUICK_CALL_TIMEOUT", { inviteId });
      }, QUICK_CALL_TIMEOUT_MS);

      pendingCalls.set(inviteId, {
        inviteId,
        callerId: user.id,
        targetId: targetUserId,
        timer,
      });

      io.to(`user:${targetUserId}`).emit("QUICK_CALL_INCOMING", {
        inviteId,
        fromUserId: user.id,
        fromUserName: user.name,
        fromUserAvatar: user.picture,
        expiresInMs: QUICK_CALL_TIMEOUT_MS,
      });

      callback?.({ inviteId });
    }
  );

  // Quem recebeu o convite aceita/recusa — só o próprio alvo pode responder.
  socket.on(
    "QUICK_CALL_RESPOND",
    (data: { inviteId: string; accept: boolean }) => {
      const invite = pendingCalls.get(data?.inviteId);
      if (!invite || invite.targetId !== user.id) return;

      clearInvite(invite.inviteId);

      io.to(`user:${invite.callerId}`).emit("QUICK_CALL_RESPONDED", {
        inviteId: invite.inviteId,
        accept: Boolean(data.accept),
      });
    }
  );

  // Quem chamou desiste antes da resposta — só o próprio chamador pode cancelar.
  socket.on("QUICK_CALL_CANCEL", (data: { inviteId: string }) => {
    const invite = pendingCalls.get(data?.inviteId);
    if (!invite || invite.callerId !== user.id) return;

    clearInvite(invite.inviteId);
    io.to(`user:${invite.targetId}`).emit("QUICK_CALL_CANCELLED", {
      inviteId: invite.inviteId,
    });
  });

  // Depois do accept, quem chamou cria a Room de verdade (REST, já existente)
  // e repassa pro alvo entrar direto na call, sem passar por /office/meet.
  socket.on(
    "QUICK_CALL_ROOM_READY",
    (data: { targetUserId: string; room: unknown }) => {
      if (!data?.targetUserId || !data?.room) return;
      io.to(`user:${data.targetUserId}`).emit("QUICK_CALL_ROOM_READY", {
        room: data.room,
      });
    }
  );

  // Desconectou no meio de uma chamada pendente (chamando ou tocando) — avisa
  // o outro lado pra fechar a UI em vez de ficar esperando os 30s.
  socket.on("disconnect", () => {
    for (const invite of pendingCalls.values()) {
      if (invite.callerId !== user.id && invite.targetId !== user.id) continue;
      clearInvite(invite.inviteId);
      const otherId = invite.callerId === user.id ? invite.targetId : invite.callerId;
      io.to(`user:${otherId}`).emit("QUICK_CALL_CANCELLED", {
        inviteId: invite.inviteId,
      });
    }
  });
};
