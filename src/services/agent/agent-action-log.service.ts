import { prisma } from "../prisma.service";
import { AgentActionStatus, AgentTriggerType, Prisma } from "@prisma/client";

interface LogParams {
  roomId: string;
  callSessionId: string | null;
  triggeredByUserId: string | null;
  trigger: AgentTriggerType;
  input: string;
  output: string;
  toolName: string | null;
  toolArgs?: unknown;
  toolResult?: unknown;
  status: AgentActionStatus;
  errorMessage?: string | null;
}

async function log(params: LogParams) {
  return prisma.agentActionLog.create({
    data: {
      roomId: params.roomId,
      callSessionId: params.callSessionId,
      triggeredByUserId: params.triggeredByUserId,
      trigger: params.trigger,
      input: params.input,
      output: params.output,
      toolName: params.toolName,
      toolArgs: params.toolArgs as Prisma.InputJsonValue | undefined,
      toolResult: params.toolResult as Prisma.InputJsonValue | undefined,
      status: params.status,
      errorMessage: params.errorMessage ?? null,
    },
  });
}

async function listByRoom(roomId: string, limit = 50) {
  return prisma.agentActionLog.findMany({
    where: { roomId },
    include: {
      triggeredBy: { select: { id: true, name: true, picture: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export const agentActionLogService = {
  log,
  listByRoom,
};
