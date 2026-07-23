import { Response } from "express";
import { TaskActivityType } from "@prisma/client";
import { prisma } from "../services/prisma.service";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  emitTaskEvent,
  logActivity,
  notifyTaskEvent,
  requireTaskInCompany,
  TaskServiceError,
} from "../services/task.service";
import { createCommentSchema, updateCommentSchema } from "../schemas/task.schema";

function handleError(res: Response, error: unknown, context: string) {
  if (error instanceof TaskServiceError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(context, error);
  return res.status(500).json({ error: "Erro interno do servidor" });
}

const COMMENT_AUTHOR_SELECT = { id: true, name: true, email: true, picture: true } as const;

async function requireCommentInCompany(commentId: string, companyId: string) {
  const comment = await prisma.taskComment.findFirst({
    where: { id: commentId, task: { companyId } },
    include: { task: { select: { id: true, companyId: true } } },
  });
  if (!comment) {
    throw new TaskServiceError("Comentário não encontrado", 404);
  }
  return comment;
}

export const listComments = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const companyId = req.companyId;
    if (!companyId) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const task = await requireTaskInCompany(req.params.id, companyId);

    const comments = await prisma.taskComment.findMany({
      where: { taskId: task.id, isDeleted: false },
      orderBy: { createdAt: "asc" },
      include: { author: { select: COMMENT_AUTHOR_SELECT } },
    });

    return res.json({ comments });
  } catch (error) {
    return handleError(res, error, "Erro ao listar comentários:");
  }
};

export const createComment = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const companyId = req.companyId;
    if (!companyId) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const task = await requireTaskInCompany(req.params.id, companyId);

    const parsed = createCommentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Dados inválidos" });
    }
    const { content, mentionedUserIds } = parsed.data;

    const comment = await prisma.taskComment.create({
      data: {
        taskId: task.id,
        authorId: userId,
        content,
        mentionedUserIds: mentionedUserIds ?? [],
      },
      include: { author: { select: COMMENT_AUTHOR_SELECT } },
    });

    await logActivity(task.id, TaskActivityType.COMMENTED, userId, undefined, { commentId: comment.id });

    const [assignees, watchers] = await Promise.all([
      prisma.taskAssignee.findMany({ where: { taskId: task.id }, select: { userId: true } }),
      prisma.taskWatcher.findMany({ where: { taskId: task.id }, select: { userId: true } }),
    ]);
    const notifyTargets = [
      task.createdById,
      ...assignees.map((a) => a.userId),
      ...watchers.map((w) => w.userId),
    ];
    void notifyTaskEvent("NEW_COMMENT", task, userId, notifyTargets);

    if (mentionedUserIds && mentionedUserIds.length > 0) {
      void notifyTaskEvent("MENTION", task, userId, mentionedUserIds);
    }

    emitTaskEvent(companyId, "TASK_COMMENT_CREATED", { taskId: task.id, comment });

    return res.status(201).json({ comment });
  } catch (error) {
    return handleError(res, error, "Erro ao criar comentário:");
  }
};

export const updateComment = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const companyId = req.companyId;
    if (!companyId) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const comment = await requireCommentInCompany(req.params.id, companyId);

    if (comment.authorId !== userId) {
      return res.status(403).json({ error: "Apenas o autor pode editar o comentário" });
    }

    const parsed = updateCommentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Dados inválidos" });
    }

    const updated = await prisma.taskComment.update({
      where: { id: comment.id },
      data: { content: parsed.data.content, isEdited: true },
      include: { author: { select: COMMENT_AUTHOR_SELECT } },
    });

    emitTaskEvent(companyId, "TASK_COMMENT_UPDATED", { taskId: comment.task.id, comment: updated });

    return res.json({ comment: updated });
  } catch (error) {
    return handleError(res, error, "Erro ao atualizar comentário:");
  }
};

export const deleteComment = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const companyId = req.companyId;
    if (!companyId) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const comment = await requireCommentInCompany(req.params.id, companyId);

    if (comment.authorId !== userId) {
      return res.status(403).json({ error: "Apenas o autor pode remover o comentário" });
    }

    await prisma.taskComment.update({
      where: { id: comment.id },
      data: { isDeleted: true },
    });

    emitTaskEvent(companyId, "TASK_COMMENT_DELETED", { taskId: comment.task.id, commentId: comment.id });

    return res.json({ message: "Comentário removido com sucesso" });
  } catch (error) {
    return handleError(res, error, "Erro ao remover comentário:");
  }
};
