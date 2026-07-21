import { createTask } from "../../task.service";
import type { ToolDef } from "./types";

export const createTaskTool: ToolDef = {
  name: "createTask",
  description:
    "Cria uma nova task para a empresa. Use para registrar trabalho a ser feito a partir da conversa.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Título da task." },
      description: { type: "string", description: "Descrição detalhada da task." },
      priority: {
        type: "string",
        enum: ["LOW", "MEDIUM", "HIGH", "URGENT"],
        description: "Prioridade da task. Padrão MEDIUM.",
      },
      dueDate: { type: "string", description: "Prazo, formato ISO 8601 (opcional)." },
    },
    required: ["title"],
  },
  run: async (ctx, input) => {
    const title = String(input?.title ?? "").trim();
    if (!title) throw new Error("title é obrigatório");

    const dueDate =
      typeof input?.dueDate === "string" && input.dueDate ? new Date(input.dueDate) : null;
    if (dueDate && Number.isNaN(dueDate.getTime())) {
      throw new Error("dueDate deve ser uma data válida (ISO 8601)");
    }

    const task = await createTask(ctx.companyId, ctx.userId, {
      title,
      description: typeof input?.description === "string" ? input.description : undefined,
      priority: ["LOW", "MEDIUM", "HIGH", "URGENT"].includes(input?.priority)
        ? input.priority
        : undefined,
      dueDate,
    });

    return { id: task.id, title: task.title, status: task.status, priority: task.priority };
  },
};
