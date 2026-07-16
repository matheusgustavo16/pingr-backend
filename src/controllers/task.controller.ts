import { Response } from "express";
import { Prisma, TaskActivityType, TaskPriority, TaskStatus } from "@prisma/client";
import { prisma } from "../services/prisma.service";
import { AuthRequest } from "../middleware/auth.middleware";
import { resolveUserCompany } from "../services/company.service";
import {
  assertAssigneeInCompany,
  emitTaskEvent,
  logActivity,
  notifyTaskEvent,
  requireTaskInCompany,
  TaskServiceError,
} from "../services/task.service";
import {
  bulkActionSchema,
  createTaskSchema,
  moveTaskSchema,
  updateTaskSchema,
} from "../schemas/task.schema";

function handleTaskError(res: Response, error: unknown, context: string) {
  if (error instanceof TaskServiceError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(context, error);
  return res.status(500).json({ error: "Erro interno do servidor" });
}

const TASK_DETAIL_INCLUDE = {
  assignees: { include: { user: { select: { id: true, name: true, email: true, picture: true } } } },
  subtasks: true,
  checklists: {
    orderBy: { order: "asc" as const },
    include: { items: { orderBy: { order: "asc" as const } } },
  },
  comments: {
    where: { isDeleted: false },
    orderBy: { createdAt: "asc" as const },
    include: { author: { select: { id: true, name: true, email: true, picture: true } } },
  },
  attachments: { orderBy: { createdAt: "desc" as const } },
  activities: {
    orderBy: { createdAt: "desc" as const },
    take: 20,
    include: { actor: { select: { id: true, name: true, email: true, picture: true } } },
  },
} satisfies Prisma.TaskInclude;

export const listTasks = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const company = await resolveUserCompany(userId);
    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const {
      workspaceId,
      status,
      priority,
      assigneeId,
      search,
      labels,
      includeArchived,
      sort,
      page: pageRaw,
      pageSize: pageSizeRaw,
    } = req.query as Record<string, string | undefined>;

    const where: Prisma.TaskWhereInput = { companyId: company.id };

    if (workspaceId) {
      where.workspaceId = workspaceId;
    }

    if (status) {
      const statuses = status.split(",").filter(Boolean) as TaskStatus[];
      if (statuses.length > 0) where.status = { in: statuses };
    }

    if (priority) {
      const priorities = priority.split(",").filter(Boolean) as TaskPriority[];
      if (priorities.length > 0) where.priority = { in: priorities };
    }

    if (assigneeId) {
      where.assignees = { some: { userId: assigneeId } };
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    if (labels) {
      const labelList = labels.split(",").filter(Boolean);
      if (labelList.length > 0) where.labels = { hasSome: labelList };
    }

    if (includeArchived !== "true") {
      where.isArchived = false;
    }

    const page = Math.max(1, parseInt(pageRaw || "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeRaw || "20", 10) || 20));

    const [sortFieldRaw, sortDirRaw] = (sort || "createdAt:desc").split(":");
    const allowedSortFields = new Set(["createdAt", "updatedAt", "position", "dueDate", "priority", "title"]);
    const sortField = allowedSortFields.has(sortFieldRaw) ? sortFieldRaw : "createdAt";
    const sortDir = sortDirRaw === "asc" ? "asc" : "desc";

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        orderBy: { [sortField]: sortDir },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          assignees: {
            include: { user: { select: { id: true, name: true, email: true, picture: true } } },
          },
          _count: { select: { subtasks: true, comments: true, attachments: true } },
        },
      }),
      prisma.task.count({ where }),
    ]);

    return res.json({
      tasks,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    return handleTaskError(res, error, "Erro ao listar tasks:");
  }
};

export const getTask = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const company = await resolveUserCompany(userId);
    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const task = await prisma.task.findFirst({
      where: { id: req.params.id, companyId: company.id },
      include: TASK_DETAIL_INCLUDE,
    });

    if (!task) {
      return res.status(404).json({ error: "Task não encontrada" });
    }

    return res.json({ task });
  } catch (error) {
    return handleTaskError(res, error, "Erro ao buscar task:");
  }
};

export const createTask = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const company = await resolveUserCompany(userId);
    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Dados inválidos" });
    }
    const data = parsed.data;

    let validWorkspaceId: string | null = null;
    if (data.workspaceId) {
      const workspace = await prisma.workspace.findFirst({
        where: { id: data.workspaceId, companyId: company.id },
      });
      if (!workspace) {
        return res.status(400).json({ error: "Workspace inválida" });
      }
      validWorkspaceId = workspace.id;
    }

    if (data.parentId) {
      await requireTaskInCompany(data.parentId, company.id);
    }

    const assigneeIds = Array.from(new Set(data.assigneeIds || []));
    for (const assigneeId of assigneeIds) {
      await assertAssigneeInCompany(assigneeId, company.id);
    }

    const task = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          title: data.title,
          description: data.description ?? null,
          status: data.status ?? TaskStatus.TODO,
          priority: data.priority ?? TaskPriority.MEDIUM,
          workspaceId: validWorkspaceId,
          parentId: data.parentId ?? null,
          startDate: data.startDate ?? null,
          dueDate: data.dueDate ?? null,
          estimatedMinutes: data.estimatedMinutes ?? null,
          recurrenceRule: data.recurrenceRule ?? undefined,
          labels: data.labels ?? [],
          githubPR: data.githubPR ?? null,
          companyId: company.id,
          createdById: userId,
          assignees: assigneeIds.length
            ? { create: assigneeIds.map((assigneeUserId) => ({ userId: assigneeUserId })) }
            : undefined,
        },
        include: {
          assignees: { include: { user: { select: { id: true, name: true, email: true, picture: true } } } },
        },
      });

      await logActivity(
        created.id,
        TaskActivityType.CREATED,
        userId,
        undefined,
        { title: created.title, status: created.status, priority: created.priority },
        tx
      );

      return created;
    });

    if (assigneeIds.length > 0) {
      void notifyTaskEvent("ASSIGNEE_ADDED", task, userId, assigneeIds);
    }
    emitTaskEvent(company.id, "TASK_CREATED", task);

    return res.status(201).json({ task });
  } catch (error) {
    return handleTaskError(res, error, "Erro ao criar task:");
  }
};

export const updateTask = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const company = await resolveUserCompany(userId);
    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const existing = await requireTaskInCompany(req.params.id, company.id);

    const parsed = updateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Dados inválidos" });
    }
    const data = parsed.data;

    if (data.workspaceId !== undefined && data.workspaceId !== null) {
      const workspace = await prisma.workspace.findFirst({
        where: { id: data.workspaceId, companyId: company.id },
      });
      if (!workspace) {
        return res.status(400).json({ error: "Workspace inválida" });
      }
    }

    if (data.parentId) {
      await requireTaskInCompany(data.parentId, company.id);
    }

    const updateData: Prisma.TaskUpdateInput = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.workspaceId !== undefined) {
      updateData.workspace = data.workspaceId
        ? { connect: { id: data.workspaceId } }
        : { disconnect: true };
    }
    if (data.parentId !== undefined) {
      updateData.parent = data.parentId ? { connect: { id: data.parentId } } : { disconnect: true };
    }
    if (data.startDate !== undefined) updateData.startDate = data.startDate;
    if (data.dueDate !== undefined) updateData.dueDate = data.dueDate;
    if (data.estimatedMinutes !== undefined) updateData.estimatedMinutes = data.estimatedMinutes;
    if (data.recurrenceRule !== undefined) updateData.recurrenceRule = data.recurrenceRule;
    if (data.labels !== undefined) updateData.labels = data.labels;
    if (data.githubPR !== undefined) updateData.githubPR = data.githubPR;
    if (data.isArchived !== undefined) updateData.isArchived = data.isArchived;

    const activitiesToLog: Array<{ type: TaskActivityType; from: unknown; to: unknown }> = [];
    if (data.status !== undefined && data.status !== existing.status) {
      activitiesToLog.push({ type: TaskActivityType.STATUS_CHANGED, from: existing.status, to: data.status });
    }
    if (data.priority !== undefined && data.priority !== existing.priority) {
      activitiesToLog.push({ type: TaskActivityType.PRIORITY_CHANGED, from: existing.priority, to: data.priority });
    }
    if (data.dueDate !== undefined && data.dueDate?.getTime() !== existing.dueDate?.getTime()) {
      activitiesToLog.push({ type: TaskActivityType.DUE_DATE_CHANGED, from: existing.dueDate, to: data.dueDate });
    }
    if (data.description !== undefined && data.description !== existing.description) {
      activitiesToLog.push({ type: TaskActivityType.DESCRIPTION_CHANGED, from: existing.description, to: data.description });
    }
    if (data.isArchived !== undefined && data.isArchived !== existing.isArchived) {
      activitiesToLog.push({ type: TaskActivityType.ARCHIVED, from: existing.isArchived, to: data.isArchived });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.task.update({
        where: { id: existing.id },
        data: updateData,
        include: {
          assignees: { include: { user: { select: { id: true, name: true, email: true, picture: true } } } },
        },
      });

      for (const activity of activitiesToLog) {
        await logActivity(existing.id, activity.type, userId, activity.from, activity.to, tx);
      }

      return result;
    });

    if (data.status === TaskStatus.DONE && existing.status !== TaskStatus.DONE) {
      const watchers = await prisma.taskWatcher.findMany({
        where: { taskId: existing.id },
        select: { userId: true },
      });
      const targetUserIds = [existing.createdById, ...watchers.map((w) => w.userId)];
      void notifyTaskEvent("STATUS_DONE", updated, userId, targetUserIds);
    } else if (data.status === TaskStatus.REVIEW && existing.status !== TaskStatus.REVIEW) {
      void notifyTaskEvent("STATUS_REVIEW", updated, userId, [existing.createdById]);
    }

    emitTaskEvent(company.id, "TASK_UPDATED", updated);

    return res.json({ task: updated });
  } catch (error) {
    return handleTaskError(res, error, "Erro ao atualizar task:");
  }
};

export const moveTask = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const company = await resolveUserCompany(userId);
    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const existing = await requireTaskInCompany(req.params.id, company.id);

    const parsed = moveTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Dados inválidos" });
    }
    const { status, position } = parsed.data;

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.task.update({
        where: { id: existing.id },
        data: { status, position },
      });

      await logActivity(
        existing.id,
        TaskActivityType.MOVED,
        userId,
        { status: existing.status, position: existing.position },
        { status, position },
        tx
      );

      return result;
    });

    emitTaskEvent(company.id, "TASK_MOVED", updated);

    return res.json({ task: updated });
  } catch (error) {
    return handleTaskError(res, error, "Erro ao mover task:");
  }
};

export const deleteTask = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const company = await resolveUserCompany(userId);
    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const existing = await requireTaskInCompany(req.params.id, company.id);

    await prisma.task.delete({ where: { id: existing.id } });

    emitTaskEvent(company.id, "TASK_DELETED", { id: existing.id });

    return res.json({ message: "Task removida com sucesso" });
  } catch (error) {
    return handleTaskError(res, error, "Erro ao remover task:");
  }
};

export const bulkAction = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const company = await resolveUserCompany(userId);
    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const parsed = bulkActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Dados inválidos" });
    }
    const { taskIds, action, payload } = parsed.data;

    const uniqueTaskIds = Array.from(new Set(taskIds));
    const count = await prisma.task.count({ where: { id: { in: uniqueTaskIds }, companyId: company.id } });
    if (count !== uniqueTaskIds.length) {
      return res.status(404).json({ error: "Uma ou mais tasks não pertencem à empresa" });
    }

    switch (action) {
      case "move": {
        if (!payload?.status) {
          return res.status(400).json({ error: "status é obrigatório para action=move" });
        }
        await prisma.task.updateMany({
          where: { id: { in: uniqueTaskIds } },
          data: {
            status: payload.status,
            ...(payload.position !== undefined ? { position: payload.position } : {}),
          },
        });
        await Promise.all(
          uniqueTaskIds.map((taskId) =>
            logActivity(taskId, TaskActivityType.MOVED, userId, undefined, {
              status: payload.status,
              position: payload.position,
            })
          )
        );
        break;
      }
      case "priority": {
        if (!payload?.priority) {
          return res.status(400).json({ error: "priority é obrigatório para action=priority" });
        }
        await prisma.task.updateMany({
          where: { id: { in: uniqueTaskIds } },
          data: { priority: payload.priority },
        });
        await Promise.all(
          uniqueTaskIds.map((taskId) =>
            logActivity(taskId, TaskActivityType.PRIORITY_CHANGED, userId, undefined, payload.priority)
          )
        );
        break;
      }
      case "assign": {
        if (!payload?.userId) {
          return res.status(400).json({ error: "userId é obrigatório para action=assign" });
        }
        await assertAssigneeInCompany(payload.userId, company.id);
        for (const taskId of uniqueTaskIds) {
          await prisma.taskAssignee.upsert({
            where: { taskId_userId: { taskId, userId: payload.userId } },
            create: { taskId, userId: payload.userId },
            update: {},
          });
          await logActivity(taskId, TaskActivityType.ASSIGNEE_ADDED, userId, undefined, { userId: payload.userId });
        }
        break;
      }
      case "delete": {
        await prisma.task.deleteMany({ where: { id: { in: uniqueTaskIds } } });
        break;
      }
    }

    emitTaskEvent(company.id, "TASK_BULK_UPDATED", { taskIds: uniqueTaskIds, action, payload });

    return res.json({ message: "Ação em lote aplicada com sucesso", taskIds: uniqueTaskIds, action });
  } catch (error) {
    return handleTaskError(res, error, "Erro ao aplicar ação em lote:");
  }
};

export const addAssignee = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const company = await resolveUserCompany(userId);
    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const task = await requireTaskInCompany(req.params.id, company.id);
    const { userId: assigneeId } = req.body as { userId?: string };

    if (!assigneeId) {
      return res.status(400).json({ error: "userId é obrigatório" });
    }

    await assertAssigneeInCompany(assigneeId, company.id);

    const existing = await prisma.taskAssignee.findUnique({
      where: { taskId_userId: { taskId: task.id, userId: assigneeId } },
    });
    if (existing) {
      return res.status(400).json({ error: "Usuário já é assignee desta task" });
    }

    const assignee = await prisma.taskAssignee.create({
      data: { taskId: task.id, userId: assigneeId },
      include: { user: { select: { id: true, name: true, email: true, picture: true } } },
    });

    await logActivity(task.id, TaskActivityType.ASSIGNEE_ADDED, userId, undefined, { userId: assigneeId });
    void notifyTaskEvent("ASSIGNEE_ADDED", task, userId, [assigneeId]);
    emitTaskEvent(company.id, "TASK_ASSIGNEE_ADDED", { taskId: task.id, assignee });

    return res.status(201).json({ assignee });
  } catch (error) {
    return handleTaskError(res, error, "Erro ao adicionar assignee:");
  }
};

export const removeAssignee = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const company = await resolveUserCompany(userId);
    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const task = await requireTaskInCompany(req.params.id, company.id);
    const { userId: assigneeId } = req.params;

    await prisma.taskAssignee.deleteMany({ where: { taskId: task.id, userId: assigneeId } });
    await logActivity(task.id, TaskActivityType.ASSIGNEE_REMOVED, userId, { userId: assigneeId }, undefined);
    emitTaskEvent(company.id, "TASK_ASSIGNEE_REMOVED", { taskId: task.id, userId: assigneeId });

    return res.json({ message: "Assignee removido com sucesso" });
  } catch (error) {
    return handleTaskError(res, error, "Erro ao remover assignee:");
  }
};

export const addWatcher = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const company = await resolveUserCompany(userId);
    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const task = await requireTaskInCompany(req.params.id, company.id);
    const { userId: watcherId } = req.body as { userId?: string };

    if (!watcherId) {
      return res.status(400).json({ error: "userId é obrigatório" });
    }

    await assertAssigneeInCompany(watcherId, company.id);

    const watcher = await prisma.taskWatcher.upsert({
      where: { taskId_userId: { taskId: task.id, userId: watcherId } },
      create: { taskId: task.id, userId: watcherId },
      update: {},
      include: { user: { select: { id: true, name: true, email: true, picture: true } } },
    });

    emitTaskEvent(company.id, "TASK_WATCHER_ADDED", { taskId: task.id, watcher });

    return res.status(201).json({ watcher });
  } catch (error) {
    return handleTaskError(res, error, "Erro ao adicionar watcher:");
  }
};

export const removeWatcher = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const company = await resolveUserCompany(userId);
    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const task = await requireTaskInCompany(req.params.id, company.id);
    const { userId: watcherId } = req.params;

    await prisma.taskWatcher.deleteMany({ where: { taskId: task.id, userId: watcherId } });
    emitTaskEvent(company.id, "TASK_WATCHER_REMOVED", { taskId: task.id, userId: watcherId });

    return res.json({ message: "Watcher removido com sucesso" });
  } catch (error) {
    return handleTaskError(res, error, "Erro ao remover watcher:");
  }
};

export const getTaskActivity = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const company = await resolveUserCompany(userId);
    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const task = await requireTaskInCompany(req.params.id, company.id);

    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) || "20", 10) || 20));

    const [activities, total] = await Promise.all([
      prisma.taskActivity.findMany({
        where: { taskId: task.id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { actor: { select: { id: true, name: true, email: true, picture: true } } },
      }),
      prisma.taskActivity.count({ where: { taskId: task.id } }),
    ]);

    return res.json({
      activities,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (error) {
    return handleTaskError(res, error, "Erro ao buscar atividades da task:");
  }
};
