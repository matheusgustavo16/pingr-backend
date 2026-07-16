import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { prisma } from "../services/prisma.service";
import { ChatService } from "../services/chat.service";
import { callSessionService } from "../services/call/call-session.service";
import { runAgentQueryAndRespond } from "../services/agent/agent-service";
import { agentActionLogService } from "../services/agent/agent-action-log.service";
import { AgentTriggerType } from "@prisma/client";
import { WebSocketServer } from "../ws/socket-server";

/**
 * Consulta o agente PINGR (chat ou comando de voz) e publica a resposta
 * como ChatMessage do bot PINGR no canal da sala.
 * POST /agent/query
 */
export const queryAgent = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { roomId, message, trigger } = req.body as {
      roomId?: string;
      message?: string;
      trigger?: AgentTriggerType;
    };

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    if (!roomId || !message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "roomId e message são obrigatórios" });
    }

    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, companyId: true },
    });
    if (!room) {
      return res.status(404).json({ error: "Sala não encontrada" });
    }

    const isMember = await ChatService.verifyCompanyMember(userId, room.companyId);
    if (!isMember) {
      return res.status(403).json({ error: "Usuário não é membro ativo da empresa" });
    }

    const callSessionId = await callSessionService.getActiveId(roomId);
    const resolvedTrigger =
      trigger === AgentTriggerType.VOICE_COMMAND
        ? AgentTriggerType.VOICE_COMMAND
        : AgentTriggerType.CHAT_MESSAGE;

    const io = WebSocketServer.getInstance().getIO();
    const { output, logId, messageId } = await runAgentQueryAndRespond({
      io,
      ctx: { roomId, callSessionId, userId, companyId: room.companyId },
      message: message.trim(),
      trigger: resolvedTrigger,
    });

    return res.status(200).json({ output, logId, messageId });
  } catch (error) {
    console.error("Erro ao consultar agente PINGR:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Lista o histórico de ações do agente PINGR numa sala
 * GET /rooms/:roomId/agent-actions
 */
export const listAgentActions = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { roomId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, companyId: true },
    });
    if (!room) {
      return res.status(404).json({ error: "Sala não encontrada" });
    }

    const isMember = await ChatService.verifyCompanyMember(userId, room.companyId);
    if (!isMember) {
      return res.status(403).json({ error: "Usuário não é membro ativo da empresa" });
    }

    const logs = await agentActionLogService.listByRoom(roomId);

    return res.json({
      actions: logs.map((l) => ({
        id: l.id,
        callSessionId: l.callSessionId,
        trigger: l.trigger,
        triggeredBy: l.triggeredBy,
        input: l.input,
        output: l.output,
        toolName: l.toolName,
        status: l.status,
        errorMessage: l.errorMessage,
        createdAt: l.createdAt,
      })),
    });
  } catch (error) {
    console.error("Erro ao listar ações do agente:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};
