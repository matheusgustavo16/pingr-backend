import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { prisma } from "../services/prisma.service";
import { ChatService } from "../services/chat.service";
import { AgentManagementService } from "../services/agent-management.service";
import { AgentLLMProvider } from "@prisma/client";

async function requireCompanyMember(userId: string, companyId: string) {
  return ChatService.verifyCompanyMember(userId, companyId);
}

async function requireCompanyAdmin(userId: string, companyId: string) {
  const member = await prisma.companyMember.findFirst({
    where: { userId, companyId },
  });
  return !!member && (member.role === "OWNER" || member.role === "ADMIN");
}

/** Lê largura/altura do logical screen descriptor do GIF (bytes 6-9), sem depender de libs de imagem. */
function parseGifDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 10 || buffer.toString("ascii", 0, 3) !== "GIF") return null;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

/**
 * GET /agents?companyId=
 */
export const listAgents = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { companyId } = req.query as { companyId?: string };

    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });
    if (!companyId) return res.status(400).json({ error: "companyId é obrigatório" });

    const isMember = await requireCompanyMember(userId, companyId);
    if (!isMember) return res.status(403).json({ error: "Usuário não é membro ativo da empresa" });

    const agents = await AgentManagementService.listAgentsByCompany(companyId);
    return res.json({ agents });
  } catch (error) {
    console.error("Erro ao listar agentes:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * GET /agents/templates
 */
export const listAgentTemplates = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "Usuário não autenticado" });
    const templates = await AgentManagementService.listTemplates();
    return res.json({ templates });
  } catch (error) {
    console.error("Erro ao listar templates de agente:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * GET /agents/:agentId?companyId=
 */
export const getAgent = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { agentId } = req.params;
    const { companyId } = req.query as { companyId?: string };

    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });
    if (!companyId) return res.status(400).json({ error: "companyId é obrigatório" });

    const isMember = await requireCompanyMember(userId, companyId);
    if (!isMember) return res.status(403).json({ error: "Usuário não é membro ativo da empresa" });

    const agent = await AgentManagementService.getAgent(agentId, companyId);
    return res.json({ agent });
  } catch (error: any) {
    console.error("Erro ao buscar agente:", error);
    if (error.message === "Agente não encontrado") {
      return res.status(404).json({ error: error.message });
    }
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * POST /agents
 */
export const createAgent = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const {
      companyId,
      templateId,
      name,
      age,
      avatarUrl,
      specialty,
      philosophy,
      jobFunction,
      provider,
      model,
      allowedTools,
      categoryId,
    } = req.body as {
      companyId?: string;
      templateId?: string;
      name?: string;
      age?: number;
      avatarUrl?: string;
      specialty?: string;
      philosophy?: string;
      jobFunction?: string;
      provider?: AgentLLMProvider;
      model?: string;
      allowedTools?: string[];
      categoryId?: string | null;
    };

    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });
    if (!companyId) return res.status(400).json({ error: "companyId é obrigatório" });

    const isAdmin = await requireCompanyAdmin(userId, companyId);
    if (!isAdmin) return res.status(403).json({ error: "Acesso negado" });

    if (!templateId && (!name || !specialty || !jobFunction)) {
      return res.status(400).json({ error: "name, specialty e jobFunction são obrigatórios" });
    }

    const agent = await AgentManagementService.createAgent({
      companyId,
      createdById: userId,
      templateId,
      name: name || "",
      age,
      avatarUrl,
      specialty: specialty || "",
      philosophy,
      jobFunction: jobFunction || "",
      provider,
      model,
      allowedTools,
      categoryId,
    });

    return res.status(201).json({ agent });
  } catch (error: any) {
    console.error("Erro ao criar agente:", error);
    if (error.message === "Template não encontrado") {
      return res.status(404).json({ error: error.message });
    }
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * PATCH /agents/:agentId
 */
export const updateAgent = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { agentId } = req.params;
    const { companyId, ...patch } = req.body as { companyId?: string; [key: string]: unknown };

    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });
    if (!companyId) return res.status(400).json({ error: "companyId é obrigatório" });

    const isAdmin = await requireCompanyAdmin(userId, companyId);
    if (!isAdmin) return res.status(403).json({ error: "Acesso negado" });

    const agent = await AgentManagementService.updateAgent(agentId, companyId, patch);
    return res.json({ agent });
  } catch (error: any) {
    console.error("Erro ao atualizar agente:", error);
    if (error.message === "Agente não encontrado") {
      return res.status(404).json({ error: error.message });
    }
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * POST /agents/avatar
 * Sobe a foto/avatar de um agente pro Cloudinary e devolve a URL. Não
 * depende de agentId — usada tanto na criação (agente ainda não existe)
 * quanto na edição, o form manda a URL junto no payload de create/update.
 * GIFs só são aceitos em proporção 1:1 (não dá pra recortar sem quebrar a
 * animação, então a validação de quadrado perfeito é obrigatória aqui).
 */
export const uploadAgentAvatar = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { companyId } = req.body as { companyId?: string };

    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });
    if (!companyId) return res.status(400).json({ error: "companyId é obrigatório" });
    if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado" });

    const isAdmin = await requireCompanyAdmin(userId, companyId);
    if (!isAdmin) return res.status(403).json({ error: "Acesso negado" });

    if (req.file.mimetype === "image/gif") {
      const dimensions = parseGifDimensions(req.file.buffer);
      if (!dimensions || dimensions.width !== dimensions.height) {
        return res.status(400).json({ error: "GIFs precisam ter proporção quadrada (1:1)" });
      }
    }

    const { uploadImage } = await import("../services/cloudinary.service");
    const uploadResult = await uploadImage(req.file.buffer, "agent-avatars", companyId);

    return res.status(201).json({ url: uploadResult.url });
  } catch (error) {
    console.error("Erro ao subir avatar do agente:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * DELETE /agents/:agentId?companyId=
 */
export const deleteAgent = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { agentId } = req.params;
    const { companyId } = req.body as { companyId?: string };

    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });
    if (!companyId) return res.status(400).json({ error: "companyId é obrigatório" });

    const isAdmin = await requireCompanyAdmin(userId, companyId);
    if (!isAdmin) return res.status(403).json({ error: "Acesso negado" });

    const agent = await AgentManagementService.deleteAgent(agentId, companyId);
    return res.json({ agent });
  } catch (error: any) {
    console.error("Erro ao remover agente:", error);
    if (error.message === "Agente não encontrado") {
      return res.status(404).json({ error: error.message });
    }
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};
