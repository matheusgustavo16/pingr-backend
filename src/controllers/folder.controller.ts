import { Response } from "express";
import { prisma } from "../services/prisma.service";
import { AuthRequest } from "../middleware/auth.middleware";
import { resolveUserCompany } from "../services/company.service";
import { deleteFile } from "../services/cloudinary.service";
import {
  assertNotDescendant,
  collectFolderSubtreeIds,
  DocumentServiceError,
  getBreadcrumb,
  requireFolderInCompany,
} from "../services/document.service";
import { createFolderSchema, updateFolderSchema } from "../schemas/document.schema";

function handleError(res: Response, error: unknown, context: string) {
  if (error instanceof DocumentServiceError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(context, error);
  return res.status(500).json({ error: "Erro interno do servidor" });
}

export const listFolderContents = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const company = await resolveUserCompany(userId);
    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const folderId = typeof req.query.folderId === "string" ? req.query.folderId : null;
    const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;

    let currentFolder = null;
    let breadcrumb: { id: string; title: string }[] = [];
    if (folderId) {
      currentFolder = await requireFolderInCompany(folderId, company.id);
      breadcrumb = await getBreadcrumb(folderId, company.id);
    }

    const scopeFilter = workspaceId ? { workspaceId } : {};

    const [folders, documents] = await Promise.all([
      prisma.folder.findMany({
        where: { companyId: company.id, parentId: folderId, ...scopeFilter },
        include: { _count: { select: { documents: true, children: true } } },
        orderBy: { title: "asc" },
      }),
      prisma.document.findMany({
        where: { companyId: company.id, folderId, ...scopeFilter },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return res.json({ currentFolder, breadcrumb, folders, documents });
  } catch (error) {
    return handleError(res, error, "Erro ao listar conteúdo da pasta:");
  }
};

export const listFolderTree = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const company = await resolveUserCompany(userId);
    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;

    const folders = await prisma.folder.findMany({
      where: { companyId: company.id, ...(workspaceId ? { workspaceId } : {}) },
      select: { id: true, title: true, parentId: true, workspaceId: true },
      orderBy: { title: "asc" },
    });

    return res.json({ folders });
  } catch (error) {
    return handleError(res, error, "Erro ao listar árvore de pastas:");
  }
};

export const createFolder = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const company = await resolveUserCompany(userId);
    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const parsed = createFolderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Dados inválidos" });
    }
    const data = parsed.data;

    let workspaceId: string | null = data.workspaceId ?? null;
    if (data.parentId) {
      const parent = await requireFolderInCompany(data.parentId, company.id);
      workspaceId = parent.workspaceId;
    } else if (workspaceId) {
      const workspace = await prisma.workspace.findFirst({ where: { id: workspaceId, companyId: company.id } });
      if (!workspace) {
        return res.status(400).json({ error: "Workspace inválida" });
      }
    }

    const folder = await prisma.folder.create({
      data: {
        title: data.title,
        parentId: data.parentId ?? null,
        workspaceId,
        companyId: company.id,
        createdById: userId,
      },
    });

    return res.status(201).json({ folder });
  } catch (error) {
    return handleError(res, error, "Erro ao criar pasta:");
  }
};

export const updateFolder = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const company = await resolveUserCompany(userId);
    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const folder = await requireFolderInCompany(req.params.id, company.id);

    const parsed = updateFolderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Dados inválidos" });
    }
    const data = parsed.data;

    let parentId = folder.parentId;
    if (data.parentId !== undefined) {
      parentId = data.parentId;
      if (parentId) {
        const targetParent = await requireFolderInCompany(parentId, company.id);
        await assertNotDescendant(folder.id, parentId, company.id);
        if (targetParent.workspaceId !== folder.workspaceId) {
          throw new DocumentServiceError(
            "Não é possível mover uma pasta entre a empresa e um workspace diferente",
            400
          );
        }
      } else if (folder.workspaceId) {
        throw new DocumentServiceError(
          "Não é possível mover uma pasta entre a empresa e um workspace diferente",
          400
        );
      }
    }

    const updated = await prisma.folder.update({
      where: { id: folder.id },
      data: {
        title: data.title ?? undefined,
        parentId,
      },
    });

    return res.json({ folder: updated });
  } catch (error) {
    return handleError(res, error, "Erro ao atualizar pasta:");
  }
};

export const deleteFolder = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const company = await resolveUserCompany(userId);
    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const folder = await requireFolderInCompany(req.params.id, company.id);

    const subtreeIds = await collectFolderSubtreeIds(folder.id, company.id);
    const documents = await prisma.document.findMany({
      where: { folderId: { in: subtreeIds } },
      select: { publicId: true, fileType: true },
    });

    for (const document of documents) {
      try {
        await deleteFile(document.publicId, document.fileType ?? undefined);
      } catch (error) {
        console.error("Erro ao deletar arquivo do Cloudinary:", error);
      }
    }

    await prisma.folder.delete({ where: { id: folder.id } });

    return res.json({ message: "Pasta removida com sucesso" });
  } catch (error) {
    return handleError(res, error, "Erro ao remover pasta:");
  }
};
