import { prisma } from "../prisma.service";
import { WebSocketServer } from "../../ws/socket-server";

/**
 * Notifica a empresa toda (sala `company:{id}`, todo socket autenticado já
 * entra nela — ver ws/gateway/connection.ts) quando o status de uma geração
 * do Gerador de Conteúdo muda — cobre a página standalone (lista de
 * histórico e o dialog de detalhe), que não tem sala de chat própria como o
 * fluxo de proposta do chat (ver chat-post-proposal-notify.service.ts).
 */
export async function notifyPostGenerationStatusChange(generationId: string): Promise<void> {
  const generation = await prisma.postGeneration.findUnique({
    where: { id: generationId },
    select: { id: true, companyId: true, status: true, resultUrl: true, errorMessage: true },
  });
  if (!generation) return;

  let io;
  try {
    io = WebSocketServer.getInstance().getIO();
  } catch {
    return;
  }

  io.to(`company:${generation.companyId}`).emit("POST_GENERATION_UPDATED", {
    generationId: generation.id,
    status: generation.status,
    resultUrl: generation.resultUrl,
    errorMessage: generation.errorMessage,
  });
}
