import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { ChatService } from "../services/chat.service";
import { searchKnowledge } from "../services/knowledge/knowledge-search.service";

/**
 * Busca semântica na base de conhecimento corporativo (RAG). Endpoint
 * interno de teste — valida qualidade/relevância antes de expor via tool
 * de agente (ver services/agent/tools/search-knowledge-base.tool.ts).
 * POST /knowledge/search { companyId, query, workspaceId?, topK? }
 */
export const searchKnowledgeBase = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });

    const { companyId, query, workspaceId, topK } = req.body as {
      companyId?: string;
      query?: string;
      workspaceId?: string;
      topK?: number;
    };

    if (!companyId) return res.status(400).json({ error: "companyId é obrigatório" });
    if (!query || !query.trim()) return res.status(400).json({ error: "query é obrigatória" });

    const isMember = await ChatService.verifyCompanyMember(userId, companyId);
    if (!isMember) return res.status(403).json({ error: "Usuário não é membro ativo da empresa" });

    const results = await searchKnowledge(query, {
      companyId,
      workspaceId,
      topK: topK && topK > 0 && topK <= 20 ? topK : 5,
    });

    return res.json({ results });
  } catch (error) {
    console.error("Erro na busca semântica de conhecimento:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};
