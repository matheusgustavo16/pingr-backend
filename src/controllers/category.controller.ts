import { Response } from "express";
import { prisma } from "../services/prisma.service";
import { AuthRequest } from "../middleware/auth.middleware";
import { resolveUserCompany } from "../services/company.service";

export const createCategory = async (req: AuthRequest, res: Response) => {
  try {
    const { title, emoji, workspaceId } = req.body;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    // Buscar a empresa do usuário (Dono ou membro ativo)
    const company = await resolveUserCompany(userId);

    if (!company) {
      return res
        .status(404)
        .json({ error: "Empresa não encontrada. Crie uma empresa primeiro." });
    }

    if (!title) {
      return res
        .status(400)
        .json({ error: "Título da categoria é obrigatório" });
    }

    // Validar workspaceId se fornecido (deve pertencer à empresa)
    let validWorkspaceId: string | null = null;
    if (workspaceId && workspaceId !== "company") {
      const workspace = await prisma.workspace.findFirst({
        where: {
          id: workspaceId,
          companyId: company.id,
        },
      });
      if (workspace) {
        validWorkspaceId = workspaceId;
      }
    }

    // Criar a categoria
    const category = await prisma.roomCategory.create({
      data: {
        title: title.trim(),
        emoji: emoji || "📁",
        companyId: company.id,
        workspaceId: validWorkspaceId,
      },
    });

    return res.status(201).json({
      category: {
        id: category.id,
        title: category.title,
        emoji: category.emoji,
        workspaceId: category.workspaceId,
      },
    });
  } catch (error) {
    console.error("Erro ao criar categoria:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const deleteCategory = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    // Verificar se a categoria pertence à empresa do usuário
    const category = await prisma.roomCategory.findFirst({
      where: {
        id,
        company: {
          ownerId: userId,
        },
      },
    });

    if (!category) {
      return res
        .status(404)
        .json({ error: "Categoria não encontrada ou permissão negada" });
    }

    // Opcional: mover salas desta categoria para uma categoria padrão ou null?
    // Por enquanto, vamos apenas deletar. Prisma cuidará de setar null se configurado,
    // mas no esquema não tem onDelete: SetNull explicitamente, embora categoryId seja opcional.

    await prisma.roomCategory.delete({
      where: { id },
    });

    return res.json({ message: "Categoria removida com sucesso" });
  } catch (error) {
    console.error("Erro ao remover categoria:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};
