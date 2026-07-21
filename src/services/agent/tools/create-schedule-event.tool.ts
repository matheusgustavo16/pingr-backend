import { ScheduleService } from "../../schedule.service";
import type { ToolDef } from "./types";

export const createScheduleEventTool: ToolDef = {
  name: "createScheduleEvent",
  description:
    "Cria um novo evento de agenda para a empresa. Se roomId não for informado, uma sala de reunião é criada automaticamente para o evento.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Título do evento." },
      startAt: { type: "string", description: "Data/hora de início, formato ISO 8601." },
      endAt: { type: "string", description: "Data/hora de término, formato ISO 8601." },
      visibility: {
        type: "string",
        enum: ["PUBLIC", "PRIVATE"],
        description: "Visibilidade do evento. Padrão PUBLIC.",
      },
    },
    required: ["title", "startAt", "endAt"],
  },
  run: async (ctx, input) => {
    const title = String(input?.title ?? "").trim();
    if (!title) throw new Error("title é obrigatório");

    const startAt = new Date(String(input?.startAt ?? ""));
    const endAt = new Date(String(input?.endAt ?? ""));
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new Error("startAt e endAt devem ser datas válidas (ISO 8601)");
    }

    const event = await ScheduleService.createScheduleEvent({
      title,
      startAt,
      endAt,
      companyId: ctx.companyId,
      createdById: ctx.userId,
      visibility: input?.visibility === "PRIVATE" ? "PRIVATE" : "PUBLIC",
    });

    return { id: event.id, title: event.title, startAt: event.startAt, endAt: event.endAt };
  },
};
