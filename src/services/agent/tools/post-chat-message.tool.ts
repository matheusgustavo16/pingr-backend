import { ChatService } from "../../chat.service";
import type { ToolDef } from "./types";

export const postChatMessageTool: ToolDef = {
  name: "postChatMessage",
  description:
    "Posta uma mensagem como o bot PINGR no chat da sala atual. Use para avisos ou lembretes que devem ficar registrados no chat, além da sua resposta normal.",
  input_schema: {
    type: "object",
    properties: {
      content: { type: "string", description: "Texto da mensagem a publicar." },
    },
    required: ["content"],
  },
  run: async (ctx, input) => {
    const content = String(input?.content ?? "").trim();
    if (!content) throw new Error("content é obrigatório");

    const channel = await ChatService.getChannelByRoomId(ctx.roomId);
    if (!channel) throw new Error("Sala não tem canal de chat associado");

    const bot = await ChatService.getPingrBot();
    const message = await ChatService.sendMessage({
      content,
      channelId: channel.id,
      botId: bot.id,
    });

    return { messageId: message.id };
  },
};
