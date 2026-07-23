import { Server as SocketIOServer } from "socket.io";
import { Agent, AgentActionStatus, AgentKind, AgentTriggerType } from "@prisma/client";
import type { AgentContext } from "./tools";
import { agentTools } from "./tools";
import { agentActionLogService } from "./agent-action-log.service";
import { ChatService } from "../chat.service";
import { prisma } from "../prisma.service";
import { getAgentProvider } from "./providers";
import { buildSystemPrompt, type DocumentContext } from "./providers/system-prompt";
import type { AgentProviderHistoryEntry, AgentProviderImage } from "./providers/types";

export interface RunAgentQueryParams {
  ctx: Omit<AgentContext, "agentId">;
  agentId?: string | null;
  message: string;
  trigger: AgentTriggerType;
  /** Turnos anteriores da conversa — threading de memória multi-turn (só o
   *  fluxo agent-conversation usa isso hoje; @menção em sala não). */
  history?: AgentProviderHistoryEntry[];
  /** Documento aberto no viewer no momento da pergunta (painel de IA do PDF). */
  documentContext?: DocumentContext;
  /** Página renderizada como imagem — "explicar imagem" do painel de IA do PDF. */
  image?: AgentProviderImage;
}

export interface RunAgentQueryResult {
  agent: Agent;
  output: string;
  toolName: string | null;
  toolArgs: unknown;
  toolResult: unknown;
}

/**
 * Resolve o Agent a ser usado numa consulta: o agente explícito (se informado,
 * ativo, e pertencente à empresa do chamador — agentes globais com
 * `companyId: null`, como o SYSTEM, são sempre permitidos) ou, por padrão, o
 * agente SYSTEM (Pinguelo) — preserva o comportamento atual do AIAssistantChat
 * sem exigir agentId do frontend.
 */
async function resolveAgent(agentId: string | null | undefined, companyId: string): Promise<Agent> {
  if (agentId) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent || !agent.isActive) {
      throw new Error("Agente não encontrado ou inativo");
    }
    if (agent.companyId && agent.companyId !== companyId) {
      throw new Error("Agente não pertence a esta empresa");
    }
    return agent;
  }

  const systemAgent = await prisma.agent.findFirst({ where: { kind: AgentKind.SYSTEM } });
  if (!systemAgent) {
    throw new Error("Agente padrão do sistema (Pinguelo) não encontrado");
  }
  return systemAgent;
}

/**
 * Executa uma consulta ao agente Pinguelo (ou a um agente customizado da
 * empresa) usando o provider de IA configurado para ele (Agent.provider).
 * No máximo uma chamada de tool por turno, mantendo AgentActionLog com um
 * único toolName por linha.
 */
export async function runAgentQuery(
  params: RunAgentQueryParams
): Promise<RunAgentQueryResult> {
  const { message } = params;
  const agent = await resolveAgent(params.agentId, params.ctx.companyId);
  const ctx: AgentContext = { ...params.ctx, agentId: agent.id };

  const tools = agentTools.filter((t) => agent.allowedTools.includes(t.name));
  const provider = getAgentProvider(agent.provider);
  const system = buildSystemPrompt(ctx, agent, {
    hasHistory: !!params.history?.length,
    documentContext: params.documentContext,
  });

  console.log(
    `[agent-service] agentId=${agent.id} name="${agent.name}" provider=${agent.provider} model=${agent.model ?? "default"} allowedTools=${JSON.stringify(agent.allowedTools)} resolvedTools=${JSON.stringify(tools.map((t) => t.name))} message="${message.slice(0, 200)}"`
  );

  const result = await provider.run(ctx, message, tools, system, {
    model: agent.model ?? undefined,
    history: params.history,
    image: params.image,
  });

  console.log(
    `[agent-service] agentId=${agent.id} toolName=${result.toolName ?? "null"} toolArgs=${JSON.stringify(result.toolArgs)} output="${result.output.slice(0, 200)}"`
  );

  return { agent, ...result };
}

/**
 * Executa a consulta e já registra o resultado (sucesso ou erro) em
 * AgentActionLog, retornando o texto final pronto para virar ChatMessage.
 */
export async function runAndLogAgentQuery(
  params: RunAgentQueryParams
): Promise<{ agent: Agent; output: string; logId: string }> {
  const { ctx, message, trigger } = params;
  if (!ctx.roomId) {
    // AgentActionLog.roomId é obrigatório — este caminho é só para o fluxo
    // room-bound (meet/voz). Conversas do Pinguelo usam runAgentQuery direto.
    throw new Error("runAndLogAgentQuery requer ctx.roomId");
  }
  const roomId = ctx.roomId;

  try {
    const result = await runAgentQuery(params);

    const entry = await agentActionLogService.log({
      agentId: result.agent.id,
      roomId,
      callSessionId: ctx.callSessionId,
      triggeredByUserId: ctx.userId,
      trigger,
      input: message,
      output: result.output,
      toolName: result.toolName,
      toolArgs: result.toolArgs,
      toolResult: result.toolResult,
      status: AgentActionStatus.SUCCESS,
    });

    return { agent: result.agent, output: result.output, logId: entry.id };
  } catch (err: any) {
    const errorMessage = err?.message || "Erro desconhecido ao consultar o agente";
    const fallbackOutput =
      "Não consegui processar sua solicitação agora. Tente novamente em instantes.";

    const agent = await resolveAgent(params.agentId, params.ctx.companyId).catch(() => null);

    const entry = await agentActionLogService.log({
      agentId: agent?.id ?? null,
      roomId,
      callSessionId: ctx.callSessionId,
      triggeredByUserId: ctx.userId,
      trigger,
      input: message,
      output: fallbackOutput,
      toolName: null,
      status: AgentActionStatus.ERROR,
      errorMessage,
    });

    return { agent: agent as Agent, output: fallbackOutput, logId: entry.id };
  }
}

/**
 * Executa a consulta, registra em AgentActionLog e publica a resposta como
 * ChatMessage do bot do agente no canal da sala, emitindo os eventos de
 * socket correspondentes. Usado tanto pela rota REST quanto pelo fluxo de
 * comando de voz, para não duplicar a lógica de "publicar resposta".
 */
export async function runAgentQueryAndRespond(params: {
  io: SocketIOServer;
  ctx: Omit<AgentContext, "agentId">;
  agentId?: string | null;
  message: string;
  trigger: AgentTriggerType;
}): Promise<{ output: string; logId: string; messageId: string | null }> {
  const { io, ctx, agentId, message, trigger } = params;
  const { agent, output, logId } = await runAndLogAgentQuery({ ctx, agentId, message, trigger });

  let messageId: string | null = null;
  if (!ctx.roomId) return { output, logId, messageId };

  try {
    const channel = await ChatService.getChannelByRoomId(ctx.roomId);
    if (channel) {
      const bot = agent?.chatBotId
        ? await prisma.chatBot.findUnique({ where: { id: agent.chatBotId } })
        : null;
      const resolvedBot = bot ?? (await ChatService.getSystemAgentBot());

      const chatMessage = await ChatService.sendMessage({
        content: output,
        channelId: channel.id,
        botId: resolvedBot.id,
      });
      messageId = chatMessage.id;

      io.to(ctx.roomId).emit("NEW_MESSAGE", { channelId: channel.id, message: chatMessage });
      io.to(ctx.roomId).emit("AGENT_RESPONSE", {
        roomId: ctx.roomId,
        callSessionId: ctx.callSessionId,
        messageId,
        content: output,
      });
    }
  } catch (error) {
    console.error("Erro ao publicar resposta do agente no chat:", error);
  }

  return { output, logId, messageId };
}
