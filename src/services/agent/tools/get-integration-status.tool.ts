import { prisma } from "../../prisma.service";
import { IntegrationProvider } from "@prisma/client";
import type { ToolDef } from "./types";

export const getIntegrationStatusTool: ToolDef = {
  name: "getIntegrationStatus",
  description:
    "Verifica se o usuário atual tem uma integração conectada e seu status (GITHUB, VERCEL, GOOGLE, SLACK, NOTION, FIGMA ou CUSTOM).",
  input_schema: {
    type: "object",
    properties: {
      provider: {
        type: "string",
        enum: Object.values(IntegrationProvider),
        description: "Provider da integração a consultar.",
      },
    },
    required: ["provider"],
  },
  run: async (ctx, input) => {
    const provider = input?.provider as IntegrationProvider | undefined;
    if (!provider || !Object.values(IntegrationProvider).includes(provider)) {
      throw new Error("provider inválido");
    }

    const integration = await prisma.integration.findFirst({
      where: { userId: ctx.userId, provider },
      select: { status: true, connectedAt: true, name: true, externalUrl: true },
    });

    return integration ?? { connected: false, provider };
  },
};
