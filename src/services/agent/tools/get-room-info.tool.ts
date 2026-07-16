import { prisma } from "../../prisma.service";
import { presenceService } from "../../../ws/presence/presence-service";
import type { ToolDef } from "./types";

export const getRoomInfoTool: ToolDef = {
  name: "getRoomInfo",
  description:
    "Retorna informações da sala/call atual: título, tipo, e quem está presente agora (nome, status, se está mutado).",
  input_schema: {
    type: "object",
    properties: {},
  },
  run: async (ctx) => {
    const room = await prisma.room.findUnique({
      where: { id: ctx.roomId },
      select: { id: true, title: true, type: true },
    });

    const participants = presenceService.getRoomPresence(ctx.roomId).map((p) => ({
      userId: p.userId,
      name: p.name,
      status: p.userStatus,
      isMuted: p.isMuted ?? false,
    }));

    return { room, participants };
  },
};
