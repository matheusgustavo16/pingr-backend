import { Server as SocketIOServer } from "socket.io";
import { prisma } from "../prisma.service";
import type { ChatChannelInfo } from "../../types/chat.types";

/** Extrai os IDs de usuário marcados via chip `@Nome` estruturado — o
 *  MessageEditor grava `data-mention-id`/`data-mention-type="user"` no
 *  span do chip, então não depende de casar nome (funciona mesmo com nomes
 *  repetidos, sensíveis a acento, etc). Chips de agente (`data-mention-type="agent"`)
 *  são ignorados aqui — esses continuam no fluxo de `maybeTriggerAgentMention`. */
function extractMentionedUserIds(content: string): string[] {
  const ids = new Set<string>();
  const spanRegex = /<span\b[^>]*class="chat-mention"[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = spanRegex.exec(content))) {
    const tag = match[0];
    const typeMatch = tag.match(/data-mention-type="([^"]*)"/i);
    if (typeMatch?.[1] !== "user") continue;
    const idMatch = tag.match(/data-mention-id="([^"]*)"/i);
    if (idMatch?.[1]) ids.add(idMatch[1]);
  }
  return Array.from(ids);
}

interface NotifyMentionedUsersParams {
  io: SocketIOServer;
  channel: ChatChannelInfo;
  content: string;
  messageId: string;
  authorId: string;
  authorName: string;
}

/**
 * Dispara um evento `CHAT_MENTION` em tempo real pra cada usuário humano
 * marcado com "@Nome" numa mensagem de chat — só chega em quem estiver com
 * socket conectado (`user:<id>`); offline simplesmente não tem listener do
 * outro lado, então não recebe nada aqui (continua só com a notificação
 * padrão de "nova mensagem" que todo participante do canal já ganha).
 */
export async function notifyMentionedUsers({
  io,
  channel,
  content,
  messageId,
  authorId,
  authorName,
}: NotifyMentionedUsersParams): Promise<void> {
  const candidateIds = extractMentionedUserIds(content).filter((id) => id !== authorId);
  if (candidateIds.length === 0) return;

  // Confere que os IDs recebidos (vindos do HTML montado no client) são de
  // fato membros ativos dessa empresa antes de notificar — não confia cegamente
  // em `data-mention-id` arbitrário.
  const validMembers = await prisma.companyMember.findMany({
    where: {
      userId: { in: candidateIds },
      companyId: channel.room.companyId,
      status: "ACTIVE",
    },
    select: { userId: true },
  });
  if (validMembers.length === 0) return;

  const textPreview = content
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const preview = textPreview.length > 140 ? `${textPreview.slice(0, 140)}...` : textPreview;

  for (const member of validMembers) {
    io.to(`user:${member.userId}`).emit("CHAT_MENTION", {
      messageId,
      channelId: channel.id,
      roomId: channel.room.id,
      roomType: channel.room.type,
      roomTitle: channel.room.title,
      authorId,
      authorName,
      preview,
    });
  }
}
