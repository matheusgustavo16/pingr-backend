import { updateTask } from "../../task.service";
import type { ToolDef } from "./types";

export const updateTaskTool: ToolDef = {
  name: "updateTask",
  description:
    "Atualiza uma task existente da empresa (status, prioridade, título, descrição ou prazo). Requer o id da task.",
  input_schema: {
    type: "object",
    properties: {
      taskId: { type: "string", description: "Id da task a atualizar." },
      title: { type: "string", description: "Novo título (opcional)." },
      description: { type: "string", description: "Nova descrição (opcional)." },
      status: {
        type: "string",
        enum: ["TODO", "IN_PROGRESS", "REVIEW", "DONE"],
        description: "Novo status (opcional).",
      },
      priority: {
        type: "string",
        enum: ["LOW", "MEDIUM", "HIGH", "URGENT"],
        description: "Nova prioridade (opcional).",
      },
      dueDate: { type: "string", description: "Novo prazo, formato ISO 8601 (opcional)." },
    },
    required: ["taskId"],
  },
  run: async (ctx, input) => {
    const taskId = String(input?.taskId ?? "").trim();
    if (!taskId) throw new Error("taskId é obrigatório");

    const dueDate =
      typeof input?.dueDate === "string" && input.dueDate ? new Date(input.dueDate) : undefined;
    if (dueDate && Number.isNaN(dueDate.getTime())) {
      throw new Error("dueDate deve ser uma data válida (ISO 8601)");
    }

    const task = await updateTask(ctx.companyId, ctx.userId, taskId, {
      title: typeof input?.title === "string" ? input.title : undefined,
      description: typeof input?.description === "string" ? input.description : undefined,
      status: ["TODO", "IN_PROGRESS", "REVIEW", "DONE"].includes(input?.status)
        ? input.status
        : undefined,
      priority: ["LOW", "MEDIUM", "HIGH", "URGENT"].includes(input?.priority)
        ? input.priority
        : undefined,
      dueDate,
    });

    return { id: task.id, title: task.title, status: task.status, priority: task.priority };
  },
};
