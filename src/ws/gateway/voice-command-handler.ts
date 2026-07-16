import { Server as SocketIOServer } from "socket.io";
import { AuthenticatedSocket } from "../auth/authenticate";
import { prisma } from "../../services/prisma.service";
import { callSessionService } from "../../services/call/call-session.service";
import { runAgentQueryAndRespond } from "../../services/agent/agent-service";
import { AgentTriggerType } from "@prisma/client";

// socket.id -> instante em que o push-to-talk foi pressionado
const listeningSince = new Map<string, Date>();

// Tempo de espera após soltar o botão para dar chance da Fase 1 finalizar
// a transcrição do trecho falado por último (Deepgram normalmente confirma
// o resultado final em poucos milissegundos após o fim da fala).
const FINALIZE_GRACE_MS = 1200;

export const handleVoiceCommandEvents = (
  io: SocketIOServer,
  socket: AuthenticatedSocket
) => {
  socket.on("VOICE_COMMAND_START", () => {
    if (!socket.user) return;
    listeningSince.set(socket.id, new Date());
  });

  socket.on("VOICE_COMMAND_STOP", async (data: { roomId: string }) => {
    if (!socket.user || !data?.roomId) return;

    const since = listeningSince.get(socket.id);
    listeningSince.delete(socket.id);
    if (!since) return;

    try {
      await new Promise((resolve) => setTimeout(resolve, FINALIZE_GRACE_MS));

      const callSessionId = await callSessionService.getActiveId(data.roomId);
      if (!callSessionId) {
        socket.emit("VOICE_COMMAND_EMPTY", { roomId: data.roomId });
        return;
      }

      const segments = await prisma.transcriptSegment.findMany({
        where: {
          callSessionId,
          userId: socket.user.id,
          createdAt: { gte: since },
        },
        orderBy: { createdAt: "asc" },
      });

      const message = segments.map((s) => s.text).join(" ").trim();
      if (!message) {
        socket.emit("VOICE_COMMAND_EMPTY", { roomId: data.roomId });
        return;
      }

      const room = await prisma.room.findUnique({
        where: { id: data.roomId },
        select: { companyId: true },
      });
      if (!room) return;

      await runAgentQueryAndRespond({
        io,
        ctx: {
          roomId: data.roomId,
          callSessionId,
          userId: socket.user.id,
          companyId: room.companyId,
        },
        message,
        trigger: AgentTriggerType.VOICE_COMMAND,
      });
    } catch (error) {
      console.error("Erro ao processar comando de voz:", error);
    }
  });

  socket.on("disconnect", () => {
    listeningSince.delete(socket.id);
  });
};
