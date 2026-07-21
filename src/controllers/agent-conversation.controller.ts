import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { AgentConversationService, ConversationServiceError } from "../services/agent-conversation.service";
import { ConversationVisibility } from "@prisma/client";

function handleError(res: Response, error: unknown, context: string) {
  if (error instanceof ConversationServiceError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(context, error);
  return res.status(500).json({ error: "Erro interno do servidor" });
}

/**
 * GET /agent-conversations?companyId=
 */
export const listConversations = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { companyId } = req.query as { companyId?: string };
    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });
    if (!companyId) return res.status(400).json({ error: "companyId é obrigatório" });

    const conversations = await AgentConversationService.listConversations(companyId, userId);
    return res.json({ conversations });
  } catch (error) {
    return handleError(res, error, "Erro ao listar conversas:");
  }
};

/**
 * POST /agent-conversations
 */
export const createConversation = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { companyId, title } = req.body as { companyId?: string; title?: string };
    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });
    if (!companyId) return res.status(400).json({ error: "companyId é obrigatório" });

    const conversation = await AgentConversationService.createConversation(companyId, userId, title);
    return res.status(201).json({ conversation });
  } catch (error) {
    return handleError(res, error, "Erro ao criar conversa:");
  }
};

/**
 * GET /agent-conversations/:id?companyId=
 */
export const getConversation = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const { companyId } = req.query as { companyId?: string };
    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });
    if (!companyId) return res.status(400).json({ error: "companyId é obrigatório" });

    const { conversation, messages } = await AgentConversationService.getConversation(id, userId, companyId);
    return res.json({ conversation, messages });
  } catch (error) {
    return handleError(res, error, "Erro ao buscar conversa:");
  }
};

/**
 * PATCH /agent-conversations/:id
 */
export const updateConversation = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const { title, visibility } = req.body as { title?: string; visibility?: ConversationVisibility };
    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });

    if (visibility && !Object.values(ConversationVisibility).includes(visibility)) {
      return res.status(400).json({ error: "visibility inválida" });
    }

    const conversation = await AgentConversationService.updateConversation(id, userId, { title, visibility });
    return res.json({ conversation });
  } catch (error) {
    return handleError(res, error, "Erro ao atualizar conversa:");
  }
};

/**
 * DELETE /agent-conversations/:id
 */
export const deleteConversation = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });

    await AgentConversationService.deleteConversation(id, userId);
    return res.json({ message: "Conversa removida" });
  } catch (error) {
    return handleError(res, error, "Erro ao remover conversa:");
  }
};

/**
 * POST /agent-conversations/:id/query
 */
export const queryConversation = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const { companyId, message, agentId } = req.body as {
      companyId?: string;
      message?: string;
      agentId?: string;
    };
    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });
    if (!companyId) return res.status(400).json({ error: "companyId é obrigatório" });
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "message é obrigatório" });
    }

    const { userMessage, agentMessage } = await AgentConversationService.postMessage({
      conversationId: id,
      userId,
      companyId,
      message: message.trim(),
      agentId,
    });

    return res.status(200).json({ userMessage, agentMessage });
  } catch (error) {
    return handleError(res, error, "Erro ao consultar agente na conversa:");
  }
};
