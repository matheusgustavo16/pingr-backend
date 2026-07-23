import { Response } from "express";
import { TaskActivityType } from "@prisma/client";
import { prisma } from "../services/prisma.service";
import { AuthRequest } from "../middleware/auth.middleware";
import { resolveUserCompany } from "../services/company.service";
import { deleteFile, getSignedDeliveryUrl, uploadFile } from "../services/cloudinary.service";
import { ensureTaskAttachmentsFolder } from "../services/document.service";
import { emitTaskEvent, logActivity, requireTaskInCompany, TaskServiceError } from "../services/task.service";

function handleError(res: Response, error: unknown, context: string) {
  if (error instanceof TaskServiceError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(context, error);
  return res.status(500).json({ error: "Erro interno do servidor" });
}

async function requireAttachmentInCompany(attachmentId: string, companyId: string) {
  const attachment = await prisma.taskAttachment.findFirst({
    where: { id: attachmentId, task: { companyId } },
    include: {
      task: { select: { id: true, companyId: true } },
      document: { select: { id: true } },
    },
  });
  if (!attachment) {
    throw new TaskServiceError("Anexo não encontrado", 404);
  }
  return attachment;
}

export const createAttachment = async (req: AuthRequest, res: Response) => {
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

    const task = await requireTaskInCompany(req.params.id, company.id);

    const uploadResult = await uploadFile(
      req.file.buffer,
      `task-attachments/${company.id}`,
      req.file.originalname,
      req.file.mimetype
    );

    const folder = await ensureTaskAttachmentsFolder(company.id, userId);

    const attachment = await prisma.$transaction(async (tx) => {
      const created = await tx.taskAttachment.create({
        data: {
          taskId: task.id,
          fileName: req.file!.originalname,
          fileUrl: uploadResult.url,
          publicId: uploadResult.publicId,
          fileType: req.file!.mimetype,
          fileSize: req.file!.size,
          uploadedById: userId,
        },
        include: { uploadedBy: { select: { id: true, name: true, email: true, picture: true } } },
      });

      // Espelha o mesmo arquivo em Documentos (pasta "Anexos de tarefas").
      await tx.document.create({
        data: {
          fileName: created.fileName,
          fileUrl: created.fileUrl,
          publicId: created.publicId,
          fileType: created.fileType,
          fileSize: created.fileSize,
          companyId: company.id,
          workspaceId: task.workspaceId,
          folderId: folder.id,
          uploadedById: userId,
          taskAttachmentId: created.id,
        },
      });

      return created;
    });

    await logActivity(task.id, TaskActivityType.ATTACHMENT_ADDED, userId, undefined, {
      attachmentId: attachment.id,
      fileName: attachment.fileName,
    });

    const attachmentWithSignedUrl = {
      ...attachment,
      fileUrl: getSignedDeliveryUrl({
        publicId: attachment.publicId,
        fileUrl: attachment.fileUrl,
        fileName: attachment.fileName,
        fileType: attachment.fileType,
      }),
    };

    emitTaskEvent(company.id, "TASK_ATTACHMENT_CREATED", { taskId: task.id, attachment: attachmentWithSignedUrl });

    return res.status(201).json({ attachment: attachmentWithSignedUrl });
  } catch (error) {
    return handleError(res, error, "Erro ao criar anexo:");
  }
};

export const deleteAttachment = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const company = await resolveUserCompany(userId);
    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const attachment = await requireAttachmentInCompany(req.params.id, company.id);

    try {
      await deleteFile(attachment.publicId, attachment.fileType ?? undefined);
    } catch (error) {
      console.error("Erro ao deletar anexo do Cloudinary:", error);
    }

    // Cascade remove o Document espelhado (FK onDelete: Cascade).
    await prisma.taskAttachment.delete({ where: { id: attachment.id } });

    emitTaskEvent(company.id, "TASK_ATTACHMENT_DELETED", {
      taskId: attachment.task.id,
      attachmentId: attachment.id,
    });

    return res.json({ message: "Anexo removido com sucesso" });
  } catch (error) {
    return handleError(res, error, "Erro ao remover anexo:");
  }
};
