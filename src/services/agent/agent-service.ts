import { Server as SocketIOServer } from "socket.io";
import { AgentActionStatus, AgentTriggerType } from "@prisma/client";
import type { AgentContext } from "./tools";
import { agentActionLogService } from "./agent-action-log.service";
import { ChatService } from "../chat.service";
import { getAgentProvider } from "./providers";

export interface RunAgentQueryParams {
  ctx: AgentContext;
  message: string;
  trigger: AgentTriggerType;
}

export interface RunAgentQueryResult {
  output: string;
  toolName: string | null;
  toolArgs: unknown;
  toolResult: unknown;
}

/**
 * Executa uma consulta ao agente PINGR usando o provider de IA disponível
 * (Claude por padrão, com fallback para OpenAI se ANTHROPIC_API_KEY não
 * estiver configurada — ver getAgentProvider). No máximo uma chamada de
 * tool por turno, mantendo AgentActionLog com um único toolName por linha.
 */
export async function runAgentQuery(
  params: RunAgentQueryParams
): Promise<RunAgentQueryResult> {
  const { ctx, message } = params;
  const provider = getAgentProvider();
  return provider.run(ctx, message);
}

/**
 * Executa a consulta e já registra o resultado (sucesso ou erro) em
 * AgentActionLog, retornando o texto final pronto para virar ChatMessage.
 */
export async function runAndLogAgentQuery(
  params: RunAgentQueryParams
): Promise<{ output: string; logId: string }> {
  const { ctx, message, trigger } = params;

  try {
    const result = await runAgentQuery(params);

    const entry = await agentActionLogService.log({
      roomId: ctx.roomId,
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

    return { output: result.output, logId: entry.id };
  } catch (err: any) {
    const errorMessage = err?.message || "Erro desconhecido ao consultar o agente";
    const fallbackOutput =
      "Não consegui processar sua solicitação agora. Tente novamente em instantes.";

    const entry = await agentActionLogService.log({
      roomId: ctx.roomId,
      callSessionId: ctx.callSessionId,
      triggeredByUserId: ctx.userId,
      trigger,
      input: message,
      output: fallbackOutput,
      toolName: null,
      status: AgentActionStatus.ERROR,
      errorMessage,
    });

    return { output: fallbackOutput, logId: entry.id };
  }
}

/**
 * Executa a consulta, registra em AgentActionLog e publica a resposta como
 * ChatMessage do bot PINGR no canal da sala, emitindo os eventos de socket
 * correspondentes. Usado tanto pela rota REST quanto pelo fluxo de comando
 * de voz, para não duplicar a lógica de "publicar resposta".
 */
export async function runAgentQueryAndRespond(params: {
  io: SocketIOServer;
  ctx: AgentContext;
  message: string;
  trigger: AgentTriggerType;
}): Promise<{ output: string; logId: string; messageId: string | null }> {
  const { io, ctx, message, trigger } = params;
  const { output, logId } = await runAndLogAgentQuery({ ctx, message, trigger });

  let messageId: string | null = null;
  try {
    const channel = await ChatService.getChannelByRoomId(ctx.roomId);
    if (channel) {
      const bot = await ChatService.getPingrBot();
      const chatMessage = await ChatService.sendMessage({
        content: output,
        channelId: channel.id,
        botId: bot.id,
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
