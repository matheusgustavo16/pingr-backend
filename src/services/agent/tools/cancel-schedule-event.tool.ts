import { prisma } from "../../prisma.service";
import { ScheduleService } from "../../schedule.service";
import type { ToolDef } from "./types";

export const cancelScheduleEventTool: ToolDef = {
  name: "cancelScheduleEvent",
  description:
    "Cancela (exclui) um evento de agenda existente pelo id. Use getSchedule antes pra descobrir o id do evento certo.",
  input_schema: {
    type: "object",
    properties: {
      eventId: { type: "string", description: "Id do evento a cancelar (obtido via getSchedule)." },
    },
    required: ["eventId"],
  },
  run: async (ctx, input) => {
    const eventId = String(input?.eventId ?? "").trim();
    if (!eventId) throw new Error("eventId é obrigatório");

    const event = await prisma.scheduleEvent.findUnique({
      where: { id: eventId },
      select: { id: true, title: true, companyId: true },
    });
    if (!event || event.companyId !== ctx.companyId) {
      throw new Error("Evento não encontrado nesta empresa");
    }

    await ScheduleService.deleteScheduleEvent(eventId);

    return { id: event.id, title: event.title, cancelled: true };
  },
};
