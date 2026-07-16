import { prisma } from "./prisma.service";
import { MemberStatus, TaskActivityType } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { WebSocketServer } from "../ws/socket-server";
import { NotificationService } from "./notification.service";

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
        actionUrl: `/tasks/${task.id}`,
      }))
    );
  } catch (error) {
    console.error(`Erro ao notificar evento de task (${kind}):`, error);
  }
}
