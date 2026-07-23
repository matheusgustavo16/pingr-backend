import { AgentActionStatus, AgentTriggerType, ConversationVisibility, MessageRole, Prisma } from "@prisma/client";
import { prisma } from "./prisma.service";
import { ChatService } from "./chat.service";
import { runAgentQuery } from "./agent/agent-service";
import type { AgentProviderHistoryEntry, AgentProviderImage } from "./agent/providers/types";
import type { DocumentContext } from "./agent/providers/system-prompt";

// Cap de turnos anteriores threadados no provider — histórico ilimitado
// estouraria a janela de contexto do modelo em conversas longas.
const MAX_HISTORY_MESSAGES = 10;

export class ConversationServiceError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const MESSAGE_AGENT_SELECT = { agent: { select: { id: true, name: true } } } satisfies Prisma.AgentConversationMessageInclude;

async function requireMember(userId: string, companyId: string) {
  const isMember = await ChatService.verifyCompanyMember(userId, companyId);
  if (!isMember) {
    throw new ConversationServiceError("Usuário não é membro ativo da empresa", 403);
  }
}

/**
 * Busca a conversa garantindo acesso: privada exige ser o criador, pública
 * exige só ser membro ativo da empresa. 404 (não 403) em ambos os casos de
 * negação pra não vazar a existência de conversas privadas de terceiros.
 */
async function requireConversationAccess(id: string, userId: string, companyId: string) {
  await requireMember(userId, companyId);

  const conversation = await prisma.agentConversation.findFirst({ where: { id, companyId } });
  if (!conversation) {
    throw new ConversationServiceError("Conversa não encontrada", 404);
  }
  if (conversation.visibility === ConversationVisibility.PRIVATE && conversation.createdById !== userId) {
    throw new ConversationServiceError("Conversa não encontrada", 404);
  }
  return conversation;
}

async function requireOwnedConversation(id: string, userId: string) {
  const conversation = await prisma.agentConversation.findUnique({ where: { id } });
  if (!conversation || conversation.createdById !== userId) {
    throw new ConversationServiceError("Conversa não encontrada", 404);
  }
  return conversation;
}

async function listConversations(companyId: string, userId: string) {
  await requireMember(userId, companyId);
  return prisma.agentConversation.findMany({
    where: { companyId, OR: [{ createdById: userId }, { visibility: ConversationVisibility.PUBLIC }] },
    orderBy: { updatedAt: "desc" },
  });
}

async function createConversation(companyId: string, userId: string, title?: string) {
  await requireMember(userId, companyId);
  return prisma.agentConversation.create({
    data: { companyId, createdById: userId, title: title?.trim() || undefined },
  });
}

async function getConversation(id: string, userId: string, companyId: string) {
  const conversation = await requireConversationAccess(id, userId, companyId);
  const messages = await prisma.agentConversationMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
    include: MESSAGE_AGENT_SELECT,
  });
  return { conversation, messages };
}

async function updateConversation(
  id: string,
  userId: string,
  patch: { title?: string; visibility?: ConversationVisibility }
) {
  await requireOwnedConversation(id, userId);
  return prisma.agentConversation.update({ where: { id }, data: patch });
}

async function deleteConversation(id: string, userId: string) {
  await requireOwnedConversation(id, userId);
  await prisma.agentConversation.delete({ where: { id } });
}

/**
 * Posta uma mensagem de usuário numa conversa e obtém a resposta do agente
 * (SYSTEM por padrão, ou o agente explicitado via @menção), persistindo os
 * dois lados como AgentConversationMessage. Reaproveita `runAgentQuery` (sem
 * roomId — ctx.roomId null) em vez de `runAndLogAgentQuery`/AgentActionLog,
 * que são específicos do fluxo room-bound (/office/meet).
 */
async function postMessage(params: {
  conversationId: string;
  userId: string;
  companyId: string;
  message: string;
  agentId?: string | null;
  documentContext?: DocumentContext;
  image?: AgentProviderImage;
}) {
  const conversation = await requireConversationAccess(params.conversationId, params.userId, params.companyId);

  // Busca histórico ANTES de criar a mensagem nova, senão ela apareceria
  // duplicada (uma vez no histórico, outra como `message` do turno atual).
  const priorMessages = await prisma.agentConversationMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    take: MAX_HISTORY_MESSAGES,
    select: { role: true, content: true },
  });
  const history: AgentProviderHistoryEntry[] = priorMessages
    .reverse()
    .map((m) => ({ role: m.role === MessageRole.USER ? "user" : "assistant", content: m.content }));

  const userMessage = await prisma.agentConversationMessage.create({
    data: { conversationId: conversation.id, role: MessageRole.USER, content: params.message },
  });

  let agentMessage;
  try {
    const result = await runAgentQuery({
      ctx: {
        roomId: null,
        channelId: null,
        callSessionId: null,
        userId: params.userId,
        companyId: params.companyId,
      },
      agentId: params.agentId,
      message: params.message,
      trigger: AgentTriggerType.CHAT_MESSAGE,
      history,
      documentContext: params.documentContext,
      image: params.image,
    });

    agentMessage = await prisma.agentConversationMessage.create({
      data: {
        conversationId: conversation.id,
        role: MessageRole.ASSISTANT,
        content: result.output,
        agentId: result.agent.id,
        toolName: result.toolName,
        toolArgs: result.toolArgs as Prisma.InputJsonValue | undefined,
        toolResult: result.toolResult as Prisma.InputJsonValue | undefined,
        status: AgentActionStatus.SUCCESS,
      },
      include: MESSAGE_AGENT_SELECT,
    });
  } catch (err: any) {
    agentMessage = await prisma.agentConversationMessage.create({
      data: {
        conversationId: conversation.id,
        role: MessageRole.ASSISTANT,
        content: "Não consegui processar sua solicitação agora. Tente novamente em instantes.",
        status: AgentActionStatus.ERROR,
        errorMessage: err?.message || "Erro desconhecido ao consultar o agente",
      },
      include: MESSAGE_AGENT_SELECT,
    });
  }

  await prisma.agentConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });

  return { userMessage, agentMessage };
}

export const AgentConversationService = {
  listConversations,
  createConversation,
  getConversation,
  updateConversation,
  deleteConversation,
  postMessage,
};
