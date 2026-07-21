import { prisma } from "./prisma.service";
import { MemberStatus, TaskActivityType, TaskPriority, TaskStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { WebSocketServer } from "../ws/socket-server";
import { NotificationService } from "./notification.service";
import type { createTaskSchema, updateTaskSchema } from "../schemas/task.schema";

export type CreateTaskData = z.infer<typeof createTaskSchema>;
export type UpdateTaskData = z.infer<typeof updateTaskSchema>;

export class TaskServiceError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Garante que userId é dono ou membro ACTIVE da company. Lança TaskServiceError caso contrário.
 */
export async function assertAssigneeInCompany(
  userId: string,
  companyId: string
): Promise<void> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { ownerId: true },
  });

  if (!company) {
    throw new TaskServiceError("Empresa não encontrada", 404);
  }

  if (company.ownerId === userId) {
    return;
  }

  const membership = await prisma.companyMember.findFirst({
    where: { userId, companyId, status: MemberStatus.ACTIVE },
  });

  if (!membership) {
    throw new TaskServiceError("Usuário não é membro ativo desta empresa", 400);
  }
}

/**
 * Busca uma task garantindo que pertence à company informada.
 * Lança TaskServiceError(404) caso não exista ou pertença a outra company —
 * nunca vaza a existência de tasks de terceiros.
 */
export async function requireTaskInCompany(taskId: string, companyId: string) {
  const task = await prisma.task.findFirst({ where: { id: taskId, companyId } });
  if (!task) {
    throw new TaskServiceError("Task não encontrada", 404);
  }
  return task;
}

export async function logActivity(
  taskId: string,
  type: TaskActivityType,
  actorId: string | null,
  fromValue?: unknown,
  toValue?: unknown,
  tx?: Prisma.TransactionClient
) {
  const client = tx ?? prisma;
  return client.taskActivity.create({
    data: {
      taskId,
      type,
      actorId,
      fromValue:
        fromValue === undefined ? undefined : (fromValue as Prisma.InputJsonValue),
      toValue: toValue === undefined ? undefined : (toValue as Prisma.InputJsonValue),
    },
  });
}

export function emitTaskEvent(companyId: string, event: string, payload: unknown) {
  try {
    WebSocketServer.getInstance()
      .getIO()
      .to(`company:${companyId}`)
      .emit(event, payload);
  } catch (error) {
    console.error(`Erro ao emitir evento ${event} via socket:`, error);
  }
}

interface TaskNotificationContext {
  id: string;
  title: string;
  createdById: string;
  companyId: string;
}

type TaskNotificationKind =
  | "ASSIGNEE_ADDED"
  | "STATUS_DONE"
  | "STATUS_REVIEW"
  | "NEW_COMMENT"
  | "MENTION";

const NOTIFICATION_MESSAGES: Record<
  TaskNotificationKind,
  { type: "MENTION" | "TASK"; title: string; description: (taskTitle: string) => string }
> = {
  ASSIGNEE_ADDED: {
    type: "TASK",
    title: "Nova task atribuída",
    description: (title) => `Você foi atribuído à task "${title}"`,
  },
  STATUS_DONE: {
    type: "TASK",
    title: "Task concluída",
    description: (title) => `A task "${title}" foi marcada como concluída`,
  },
  STATUS_REVIEW: {
    type: "TASK",
    title: "Task em revisão",
    description: (title) => `A task "${title}" está pronta para revisão`,
  },
  NEW_COMMENT: {
    type: "TASK",
    title: "Novo comentário",
    description: (title) => `Novo comentário na task "${title}"`,
  },
  MENTION: {
    type: "MENTION",
    title: "Você foi mencionado",
    description: (title) => `Você foi mencionado na task "${title}"`,
  },
};

/**
 * Wrapper fino sobre NotificationService para eventos de task. Nunca lança —
 * falha de notificação não deve quebrar a resposta HTTP principal.
 */
export async function notifyTaskEvent(
  kind: TaskNotificationKind,
  task: TaskNotificationContext,
  actorId: string,
  targetUserIds: string[]
): Promise<void> {
  try {
    const recipients = Array.from(new Set(targetUserIds)).filter(
      (id) => id && id !== actorId
    );
    if (recipients.length === 0) return;

    const message = NOTIFICATION_MESSAGES[kind];

    await NotificationService.createMany(
      recipients.map((userId) => ({
        userId,
        type: message.type,
        title: message.title,
        description: message.description(task.title),
        actionUrl: `/office/tasks/${task.id}`,
      }))
    );
  } catch (error) {
    console.error(`Erro ao notificar evento de task (${kind}):`, error);
  }
}

const TASK_WITH_ASSIGNEES_INCLUDE = {
  assignees: { include: { user: { select: { id: true, name: true, email: true, picture: true } } } },
  category: { select: { id: true, title: true, emoji: true } },
} satisfies Prisma.TaskInclude;

/** Garante que a categoria (se informada) pertence à empresa da task. */
async function resolveCategoryId(
  companyId: string,
  categoryId: string | null | undefined
): Promise<string | null | undefined> {
  if (categoryId === undefined) return undefined;
  if (categoryId === null) return null;
  const category = await prisma.roomCategory.findFirst({ where: { id: categoryId, companyId } });
  return category ? category.id : null;
}

/**
 * Cria uma task, validando workspace/parent/assignees, registrando atividade
 * e emitindo os eventos de socket + notificações correspondentes. Usado
 * tanto pelo controller HTTP (`createTask`) quanto pela tool de agente
 * (`create-task.tool.ts`).
 */
export async function createTask(companyId: string, userId: string, data: CreateTaskData) {
  let validWorkspaceId: string | null = null;
  if (data.workspaceId) {
    const workspace = await prisma.workspace.findFirst({
      where: { id: data.workspaceId, companyId },
    });
    if (!workspace) {
      throw new TaskServiceError("Workspace inválida", 400);
    }
    validWorkspaceId = workspace.id;
  }

  if (data.parentId) {
    await requireTaskInCompany(data.parentId, companyId);
  }

  const categoryId = await resolveCategoryId(companyId, data.categoryId);

  const assigneeIds = Array.from(new Set(data.assigneeIds || []));
  for (const assigneeId of assigneeIds) {
    await assertAssigneeInCompany(assigneeId, companyId);
  }

  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        title: data.title,
        description: data.description ?? null,
        status: data.status ?? TaskStatus.TODO,
        priority: data.priority ?? TaskPriority.MEDIUM,
        workspaceId: validWorkspaceId,
        categoryId: categoryId ?? null,
        parentId: data.parentId ?? null,
        startDate: data.startDate ?? null,
        dueDate: data.dueDate ?? null,
        estimatedMinutes: data.estimatedMinutes ?? null,
        recurrenceRule: data.recurrenceRule ?? undefined,
        labels: data.labels ?? [],
        githubPR: data.githubPR ?? null,
        companyId,
        createdById: userId,
        assignees: assigneeIds.length
          ? { create: assigneeIds.map((assigneeUserId) => ({ userId: assigneeUserId })) }
          : undefined,
      },
      include: TASK_WITH_ASSIGNEES_INCLUDE,
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
  emitTaskEvent(companyId, "TASK_CREATED", task);

  return task;
}

/**
 * Atualiza uma task, calculando o diff de atividades a logar (status,
 * prioridade, prazo, descrição, arquivamento) e emitindo eventos/
 * notificações correspondentes. Compartilhado entre o controller HTTP
 * (`updateTask`) e a tool de agente (`update-task.tool.ts`).
 */
export async function updateTask(
  companyId: string,
  userId: string,
  taskId: string,
  data: UpdateTaskData
) {
  const existing = await requireTaskInCompany(taskId, companyId);

  if (data.workspaceId !== undefined && data.workspaceId !== null) {
    const workspace = await prisma.workspace.findFirst({
      where: { id: data.workspaceId, companyId },
    });
    if (!workspace) {
      throw new TaskServiceError("Workspace inválida", 400);
    }
  }

  if (data.parentId) {
    await requireTaskInCompany(data.parentId, companyId);
  }

  const categoryId = await resolveCategoryId(companyId, data.categoryId);

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
  if (categoryId !== undefined) {
    updateData.category = categoryId ? { connect: { id: categoryId } } : { disconnect: true };
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
      include: TASK_WITH_ASSIGNEES_INCLUDE,
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

  emitTaskEvent(companyId, "TASK_UPDATED", updated);

  return updated;
}
