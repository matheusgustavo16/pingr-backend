import { prisma } from "../../prisma.service";
import { ChatService } from "../../chat.service";
import type { ToolDef } from "./types";

export const postChatMessageTool: ToolDef = {
  name: "postChatMessage",
  description:
    "Posta uma mensagem no chat da sala atual, usando a identidade do próprio agente. Use para avisos ou lembretes que devem ficar registrados no chat, além da sua resposta normal.",
  input_schema: {
    type: "object",
    properties: {
      content: { type: "string", description: "Texto da mensagem a publicar." },
      channelId: {
        type: "string",
        description: "Id do canal de destino (opcional, padrão o canal da sala atual).",
      },
    },
    required: ["content"],
  },
  run: async (ctx, input) => {
    const content = String(input?.content ?? "").trim();
    if (!content) throw new Error("content é obrigatório");

    const channelId =
      typeof input?.channelId === "string" && input.channelId
        ? input.channelId
        : ctx.roomId
          ? (await ChatService.getChannelByRoomId(ctx.roomId))?.id ?? null
          : null;
    if (!channelId) {
      throw new Error(
        "Nenhum canal de chat disponível — informe channelId explicitamente (esta conversa não está em uma sala)."
      );
    }

    const agent = await prisma.agent.findUnique({ where: { id: ctx.agentId } });
    const bot = agent?.chatBotId
      ? await prisma.chatBot.findUnique({ where: { id: agent.chatBotId } })
      : null;
    const resolvedBot = bot ?? (await ChatService.getSystemAgentBot());

    const message = await ChatService.sendMessage({
      content,
      channelId,
      botId: resolvedBot.id,
    });

    return { messageId: message.id };
  },
};
