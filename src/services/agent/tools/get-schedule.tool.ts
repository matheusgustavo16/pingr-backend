import { ScheduleService } from "../../schedule.service";
import type { ToolDef } from "./types";

export const getScheduleTool: ToolDef = {
  name: "getSchedule",
  description:
    "Retorna os próximos eventos de agenda da empresa (públicos + privados do usuário atual) dentro de um intervalo de dias a partir de agora.",
  input_schema: {
    type: "object",
    properties: {
      daysAhead: {
        type: "number",
        description: "Quantos dias à frente da agenda buscar. Padrão 7.",
      },
    },
  },
  run: async (ctx, input) => {
    const daysAhead =
      typeof input?.daysAhead === "number" && input.daysAhead > 0
        ? Math.min(input.daysAhead, 60)
        : 7;

    const startDate = new Date();
    const endDate = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);

    const events = await ScheduleService.listScheduleEventsByCompany(
      { companyId: ctx.companyId, startDate, endDate },
      true,
      ctx.userId
    );

    return events.map((e) => ({
      id: e.id,
      title: e.title,
      startAt: e.startAt,
      endAt: e.endAt,
      room: e.room?.title ?? null,
    }));
  },
};
