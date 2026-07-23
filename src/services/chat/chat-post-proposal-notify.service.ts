import { prisma } from "../prisma.service";
import { WebSocketServer } from "../../ws/socket-server";

/**
 * Notifica a sala em tempo real quando o status de um item de proposta de
 * post do chat muda (PENDING ao clicar "Gerar conteúdo", COMPLETED/FAILED
 * quando o worker do BullMQ termina) — sem isso o card ficaria dependente de
 * polling, quebrando a visibilidade compartilhada pra todo mundo na sala.
 *
 * `generationId` é o único dado que o worker de post-generation tem ao
 * terminar um job — o lookup por `postGenerationId` (unique) é o que liga de
 * volta ao item/mensagem certos. Gerações que não vieram de uma proposta de
 * chat (fluxo normal do Gerador de Conteúdo) simplesmente não têm item
 * correspondente, então isso vira no-op — zero impacto na página standalone.
 */
export async function notifyProposalItemStatusChange(generationId: string): Promise<void> {
  const item = await prisma.chatPostProposalItem.findUnique({
    where: { postGenerationId: generationId },
    include: {
      proposal: { select: { roomId: true, channelId: true, chatMessageId: true } },
      postGeneration: { select: { status: true, resultUrl: true, errorMessage: true } },
    },
  });
  if (!item || !item.postGeneration) return;

  let io;
  try {
    io = WebSocketServer.getInstance().getIO();
  } catch {
    return;
  }

  io.to(item.proposal.roomId).emit("CHAT_POST_PROPOSAL_ITEM_UPDATED", {
    roomId: item.proposal.roomId,
    channelId: item.proposal.channelId,
    messageId: item.proposal.chatMessageId,
    proposalId: item.proposalId,
    itemId: item.id,
    status: item.postGeneration.status,
    resultUrl: item.postGeneration.resultUrl,
    errorMessage: item.postGeneration.errorMessage,
  });
}
