import { Server as SocketIOServer } from "socket.io";
import { AgentTriggerType } from "@prisma/client";
import { prisma } from "../prisma.service";
import { callSessionService } from "../call/call-session.service";
import { runAgentQueryAndRespond } from "./agent-service";
import type { ChatChannelInfo } from "../../types/chat.types";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extrai o id da tarefa marcada via chip `#Título` estruturado (`data-task-id`
 *  no span `.chat-task-mention` inserido pelo MessageEditor). Só o primeiro é
 *  usado — hoje só existe um slot de tarefa vinculada por proposta gerada. */
function extractMentionedTaskId(content: string): string | null {
  const spanRegex = /<span\b[^>]*class="chat-task-mention"[^>]*>/i;
  const match = content.match(spanRegex);
  if (!match) return null;
  const idMatch = match[0].match(/data-task-id="([^"]*)"/i);
  return idMatch?.[1] ?? null;
}

/** "@Nome Completo" ou "@Primeironome", com \b pra não casar "@analytics" com agente "Ana". */
function mentionsAgent(content: string, agentName: string): boolean {
  const fullName = escapeRegex(agentName);
  const firstName = escapeRegex(agentName.split(" ")[0]);
  const pattern = new RegExp(`@(?:${fullName}|${firstName})\\b`, "iu");
  return pattern.test(content);
}

/**
 * Detecta menção a um agente (@NomeDoAgente) numa mensagem humana de chat e,
 * se o agente estiver associado à categoria da sala do canal, roda a
 * consulta e publica a resposta ali mesmo — mesmo fluxo do Pinguelo em sala
 * (`runAgentQueryAndRespond`), só que disparado por menção em vez de
 * comando de voz ou da rota dedicada `/agent/query`.
 */
export async function maybeTriggerAgentMention(params: {
  io: SocketIOServer;
  channel: ChatChannelInfo;
  content: string;
  userId: string;
  /** Documentos anexados na mesma mensagem — repassado pra tools que usam referência (ex: generateContentPosts). */
  attachmentIds?: string[];
}): Promise<void> {
  const { io, channel, content, userId, attachmentIds } = params;
  if (!content.includes("@")) return;

  const room = await prisma.room.findUnique({
    where: { id: channel.roomId },
    select: { categoryId: true },
  });
  if (!room?.categoryId) return;

  const agents = await prisma.agent.findMany({
    where: {
      companyId: channel.room.companyId,
      categoryId: room.categoryId,
      isActive: true,
    },
  });
  if (agents.length === 0) return;

  const matched = agents.find((agent) => mentionsAgent(content, agent.name));
  if (!matched) return;

  const callSessionId = await callSessionService.getActiveId(channel.roomId);

  // Confere que a tarefa mencionada (se houver) é de fato da empresa antes de
  // repassar pra tool — não confia cegamente em `data-task-id` vindo do client.
  const mentionedTaskId = extractMentionedTaskId(content);
  const taskId = mentionedTaskId
    ? (
        await prisma.task.findFirst({
          where: { id: mentionedTaskId, companyId: channel.room.companyId },
          select: { id: true },
        })
      )?.id ?? null
    : null;

  // Indicador de "digitando" — a resposta do LLM demora alguns segundos;
  // sem isso a mensagem parece surgir do nada. Emite pro roomId (chat aberto)
  // igual ao NEW_MESSAGE, e sempre limpa no final (sucesso ou erro).
  io.to(channel.roomId).emit("AGENT_TYPING", {
    roomId: channel.roomId,
    channelId: channel.id,
    agentId: matched.id,
    agentName: matched.name,
  });

  try {
    await runAgentQueryAndRespond({
      io,
      ctx: {
        roomId: channel.roomId,
        channelId: channel.id,
        callSessionId,
        userId,
        companyId: channel.room.companyId,
        taskId,
        attachmentIds,
      },
      agentId: matched.id,
      message: content,
      trigger: AgentTriggerType.CHAT_MESSAGE,
    });
  } finally {
    io.to(channel.roomId).emit("AGENT_TYPING_STOP", {
      roomId: channel.roomId,
      agentId: matched.id,
    });
  }
}
