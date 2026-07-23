import { Response } from "express";
import { TaskActivityType } from "@prisma/client";
import { prisma } from "../services/prisma.service";
import { AuthRequest } from "../middleware/auth.middleware";
import { emitTaskEvent, logActivity, requireTaskInCompany, TaskServiceError } from "../services/task.service";
import {
  createChecklistItemSchema,
  createChecklistSchema,
  updateChecklistItemSchema,
  updateChecklistSchema,
} from "../schemas/task.schema";

function handleError(res: Response, error: unknown, context: string) {
  if (error instanceof TaskServiceError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(context, error);
  return res.status(500).json({ error: "Erro interno do servidor" });
}

async function requireChecklistInCompany(checklistId: string, companyId: string) {
  const checklist = await prisma.taskChecklist.findFirst({
    where: { id: checklistId, task: { companyId } },
    include: { task: { select: { id: true, companyId: true } } },
  });
  if (!checklist) {
    throw new TaskServiceError("Checklist não encontrada", 404);
  }
  return checklist;
}

async function requireChecklistItemInCompany(itemId: string, companyId: string) {
  const item = await prisma.taskChecklistItem.findFirst({
    where: { id: itemId, checklist: { task: { companyId } } },
    include: { checklist: { include: { task: { select: { id: true, companyId: true } } } } },
  });
  if (!item) {
    throw new TaskServiceError("Item de checklist não encontrado", 404);
  }
  return item;
}

export const createChecklist = async (req: AuthRequest, res: Response) => {
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

    const parsed = createChecklistSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Dados inválidos" });
    }

    const checklist = await prisma.taskChecklist.create({
      data: { taskId: task.id, title: parsed.data.title, order: parsed.data.order ?? 0 },
      include: { items: true },
    });

    emitTaskEvent(companyId, "TASK_CHECKLIST_CREATED", { taskId: task.id, checklist });

    return res.status(201).json({ checklist });
  } catch (error) {
    return handleError(res, error, "Erro ao criar checklist:");
  }
};

export const updateChecklist = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const companyId = req.companyId;
    if (!companyId) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const checklist = await requireChecklistInCompany(req.params.id, companyId);

    const parsed = updateChecklistSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Dados inválidos" });
    }

    const updated = await prisma.taskChecklist.update({
      where: { id: checklist.id },
      data: {
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(parsed.data.order !== undefined ? { order: parsed.data.order } : {}),
      },
      include: { items: true },
    });

    emitTaskEvent(companyId, "TASK_CHECKLIST_UPDATED", { taskId: checklist.task.id, checklist: updated });

    return res.json({ checklist: updated });
  } catch (error) {
    return handleError(res, error, "Erro ao atualizar checklist:");
  }
};

export const deleteChecklist = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const companyId = req.companyId;
    if (!companyId) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const checklist = await requireChecklistInCompany(req.params.id, companyId);

    await prisma.taskChecklist.delete({ where: { id: checklist.id } });

    emitTaskEvent(companyId, "TASK_CHECKLIST_DELETED", { taskId: checklist.task.id, checklistId: checklist.id });

    return res.json({ message: "Checklist removida com sucesso" });
  } catch (error) {
    return handleError(res, error, "Erro ao remover checklist:");
  }
};

export const createChecklistItem = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const companyId = req.companyId;
    if (!companyId) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const checklist = await requireChecklistInCompany(req.params.id, companyId);

    const parsed = createChecklistItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Dados inválidos" });
    }

    const item = await prisma.taskChecklistItem.create({
      data: { checklistId: checklist.id, title: parsed.data.title, order: parsed.data.order ?? 0 },
    });

    emitTaskEvent(companyId, "TASK_CHECKLIST_ITEM_CREATED", { taskId: checklist.task.id, item });

    return res.status(201).json({ item });
  } catch (error) {
    return handleError(res, error, "Erro ao criar item de checklist:");
  }
};

export const updateChecklistItem = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const companyId = req.companyId;
    if (!companyId) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const item = await requireChecklistItemInCompany(req.params.id, companyId);

    const parsed = updateChecklistItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Dados inválidos" });
    }
    const data = parsed.data;

    const updated = await prisma.taskChecklistItem.update({
      where: { id: item.id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.isDone !== undefined ? { isDone: data.isDone } : {}),
        ...(data.order !== undefined ? { order: data.order } : {}),
      },
    });

    const taskId = item.checklist.task.id;

    if (data.isDone !== undefined && data.isDone !== item.isDone) {
      await logActivity(
        taskId,
        TaskActivityType.CHECKLIST_ITEM_TOGGLED,
        userId,
        { itemId: item.id, isDone: item.isDone },
        { itemId: item.id, isDone: data.isDone }
      );
    }

    emitTaskEvent(companyId, "TASK_CHECKLIST_ITEM_UPDATED", { taskId, item: updated });

    return res.json({ item: updated });
  } catch (error) {
    return handleError(res, error, "Erro ao atualizar item de checklist:");
  }
};

export const deleteChecklistItem = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const companyId = req.companyId;
    if (!companyId) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const item = await requireChecklistItemInCompany(req.params.id, companyId);

    await prisma.taskChecklistItem.delete({ where: { id: item.id } });

    emitTaskEvent(companyId, "TASK_CHECKLIST_ITEM_DELETED", {
      taskId: item.checklist.task.id,
      itemId: item.id,
    });

    return res.json({ message: "Item removido com sucesso" });
  } catch (error) {
    return handleError(res, error, "Erro ao remover item de checklist:");
  }
};
