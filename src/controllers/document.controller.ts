import { Response } from "express";
import { prisma } from "../services/prisma.service";
import { AuthRequest } from "../middleware/auth.middleware";
import { resolveUserCompany } from "../services/company.service";
import { deleteFile, uploadFile } from "../services/cloudinary.service";
import { DocumentServiceError, requireDocumentInCompany, requireFolderInCompany } from "../services/document.service";
import { updateDocumentSchema } from "../schemas/document.schema";

function handleError(res: Response, error: unknown, context: string) {
  if (error instanceof DocumentServiceError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(context, error);
  return res.status(500).json({ error: "Erro interno do servidor" });
}

export const uploadDocument = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }

    const company = await resolveUserCompany(userId);
    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const folderId = typeof req.body.folderId === "string" && req.body.folderId ? req.body.folderId : null;
    let workspaceId: string | null =
      typeof req.body.workspaceId === "string" && req.body.workspaceId ? req.body.workspaceId : null;

    if (folderId) {
      const folder = await requireFolderInCompany(folderId, company.id);
      workspaceId = folder.workspaceId;
    } else if (workspaceId) {
      const workspace = await prisma.workspace.findFirst({ where: { id: workspaceId, companyId: company.id } });
      if (!workspace) {
        return res.status(400).json({ error: "Workspace inválida" });
      }
    }

    const uploadResult = await uploadFile(
      req.file.buffer,
      `documents/${company.id}/${folderId ?? "root"}`,
      req.file.originalname,
      req.file.mimetype
    );

    const document = await prisma.document.create({
      data: {
        fileName: req.file.originalname,
        fileUrl: uploadResult.url,
        publicId: uploadResult.publicId,
        fileType: req.file.mimetype,
        fileSize: req.file.size,
        folderId,
        workspaceId,
        companyId: company.id,
        uploadedById: userId,
      },
    });

    return res.status(201).json({ document });
  } catch (error) {
    return handleError(res, error, "Erro ao enviar documento:");
  }
};

export const updateDocument = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const company = await resolveUserCompany(userId);
    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const document = await requireDocumentInCompany(req.params.id, company.id);

    const parsed = updateDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Dados inválidos" });
    }
    const data = parsed.data;

    let folderId = document.folderId;
    let workspaceId = document.workspaceId;
    if (data.folderId !== undefined) {
      folderId = data.folderId;
      if (folderId) {
        const targetFolder = await requireFolderInCompany(folderId, company.id);
        if (targetFolder.workspaceId !== document.workspaceId) {
          throw new DocumentServiceError(
            "Não é possível mover um documento entre a empresa e um workspace diferente",
            400
          );
        }
        workspaceId = targetFolder.workspaceId;
      } else if (document.workspaceId) {
        throw new DocumentServiceError(
          "Não é possível mover um documento entre a empresa e um workspace diferente",
          400
        );
      }
    }

    const updated = await prisma.document.update({
      where: { id: document.id },
      data: {
        fileName: data.fileName ?? undefined,
        folderId,
        workspaceId,
      },
    });

    return res.json({ document: updated });
  } catch (error) {
    return handleError(res, error, "Erro ao atualizar documento:");
  }
};

export const deleteDocument = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const company = await resolveUserCompany(userId);
    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const document = await requireDocumentInCompany(req.params.id, company.id);

    try {
      await deleteFile(document.publicId, document.fileType ?? undefined);
    } catch (error) {
      console.error("Erro ao deletar documento do Cloudinary:", error);
    }

    await prisma.document.delete({ where: { id: document.id } });

    return res.json({ message: "Documento removido com sucesso" });
  } catch (error) {
    return handleError(res, error, "Erro ao remover documento:");
  }
};
