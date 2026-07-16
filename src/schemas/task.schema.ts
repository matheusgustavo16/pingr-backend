import { z } from "zod";

export const taskStatusSchema = z.enum(["TODO", "IN_PROGRESS", "REVIEW", "DONE"]);
export const taskPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Título é obrigatório"),
  description: z.string().trim().optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  workspaceId: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  estimatedMinutes: z.number().int().positive().optional().nullable(),
  recurrenceRule: z.any().optional().nullable(),
  labels: z.array(z.string()).optional(),
  githubPR: z.string().optional().nullable(),
  assigneeIds: z.array(z.string()).optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().optional().nullable(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  workspaceId: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  estimatedMinutes: z.number().int().positive().optional().nullable(),
  recurrenceRule: z.any().optional().nullable(),
  labels: z.array(z.string()).optional(),
  githubPR: z.string().optional().nullable(),
  isArchived: z.boolean().optional(),
});

export const moveTaskSchema = z.object({
  status: taskStatusSchema,
  position: z.number(),
});

export const bulkActionSchema = z.object({
  taskIds: z.array(z.string()).min(1, "Informe ao menos uma task"),
  action: z.enum(["move", "delete", "assign", "priority"]),
  payload: z
    .object({
      status: taskStatusSchema.optional(),
      position: z.number().optional(),
      userId: z.string().optional(),
      priority: taskPrioritySchema.optional(),
    })
    .optional(),
});

export const createCommentSchema = z.object({
  content: z.string().trim().min(1, "Comentário não pode ser vazio"),
  mentionedUserIds: z.array(z.string()).optional(),
});

export const updateCommentSchema = z.object({
  content: z.string().trim().min(1, "Comentário não pode ser vazio"),
});

export const createChecklistSchema = z.object({
  title: z.string().trim().min(1, "Título é obrigatório"),
  order: z.number().int().optional(),
});

export const updateChecklistSchema = z.object({
  title: z.string().trim().min(1).optional(),
  order: z.number().int().optional(),
});

export const createChecklistItemSchema = z.object({
  title: z.string().trim().min(1, "Título é obrigatório"),
  order: z.number().int().optional(),
});

export const updateChecklistItemSchema = z.object({
  title: z.string().trim().min(1).optional(),
  isDone: z.boolean().optional(),
  order: z.number().int().optional(),
});

export const assigneeSchema = z.object({
  userId: z.string().min(1, "userId é obrigatório"),
});

export const watcherSchema = z.object({
  userId: z.string().min(1, "userId é obrigatório"),
});
