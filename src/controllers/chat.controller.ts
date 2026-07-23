import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { ChatService } from "../services/chat.service";
import {
  CreateMessageInput,
  EditMessageInput,
  DeleteMessageInput,
  UpdateReadStateInput,
  ListMessagesQuery,
  PinMessageInput,
} from "../types/chat.types";
import { WebSocketServer } from "../ws/socket-server";
import { prisma } from "../services/prisma.service";
import { LinkPreviewService } from "../services/link-preview.service";
import { maybeTriggerAgentMention } from "../services/agent/chat-mention.service";
import { notifyMentionedUsers } from "../services/chat/user-mention.service";

/**
 * Lista mensagens de um canal (paginado)
 * GET /chat/channels/:channelId/messages?page=1&limit=50&cursor=...
 */
export const listMessages = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { channelId } = req.params;
    const page = req.query.page ? parseInt(req.query.page as string) : 1;
    const limit = req.query.limit
      ? parseInt(req.query.limit as string)
      : 50;
    const cursor = req.query.cursor as string | undefined;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    if (!channelId) {
      return res.status(400).json({ error: "channelId é obrigatório" });
    }

    const query: ListMessagesQuery = {
      channelId,
      page,
      limit: Math.min(limit, 100), // Limitar a 100 mensagens por página
      cursor,
    };

    const result = await ChatService.listMessages(query, userId);

    return res.json(result);
  } catch (error: any) {
    console.error("Erro ao listar mensagens:", error);
    if (error.message.includes("não é participante")) {
      return res.status(403).json({ error: error.message });
    }
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Envia uma mensagem
 * POST /chat/messages
 */
export const sendMessage = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { content, type, channelId, botId } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    if (!content || !channelId) {
      return res
        .status(400)
        .json({ error: "content e channelId são obrigatórios" });
    }

    if (typeof content !== "string" || content.trim().length === 0) {
      return res.status(400).json({ error: "content não pode estar vazio" });
    }

    const input: CreateMessageInput = {
      content,
      type,
      channelId,
      botId,
    };

    const message = await ChatService.sendMessage(input, userId);

    // Emitir evento WebSocket para atualização em tempo real
    try {
      const wsServer = WebSocketServer.getInstance();
      const io = wsServer.getIO();
      const channel = await ChatService.getChannel(channelId);
      if (channel) {
        // Emitir para quem está na sala (chat aberto) e para toda a empresa
        // (sidebar com badge de não lidas, mesmo sem o canal aberto).
        // Socket.IO dedupe automaticamente sockets presentes nas duas salas.
        io.to(channel.roomId)
          .to(`company:${channel.room.companyId}`)
          .emit("NEW_MESSAGE", {
            channelId,
            roomId: channel.roomId,
            message,
          });

        // "@NomeDoAgente" numa mensagem humana aciona o agente associado à
        // categoria da sala — não bloqueia a resposta deste request.
        if (!botId) {
          void maybeTriggerAgentMention({ io, channel, content, userId }).catch((error) => {
            console.error("Erro ao acionar agente mencionado no chat:", error);
          });

          // "@NomeDoUsuário" dispara um toast em tempo real pra quem foi
          // marcado (se estiver online) — não bloqueia a resposta deste request.
          void notifyMentionedUsers({
            io,
            channel,
            content,
            messageId: message.id,
            authorId: userId,
            authorName: message.author?.name || "Alguém",
          }).catch((error) => {
            console.error("Erro ao notificar usuário mencionado no chat:", error);
          });
        }
      }
    } catch (error) {
      console.error("Erro ao emitir evento WebSocket:", error);
      // Continuar mesmo se o WebSocket falhar
    }

    return res.status(201).json({ message });
  } catch (error: any) {
    console.error("Erro ao enviar mensagem:", error);
    if (
      error.message.includes("não encontrado") ||
      error.message.includes("não é membro") ||
      error.message.includes("não tem permissão")
    ) {
      return res.status(403).json({ error: error.message });
    }
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Envia um arquivo como mensagem no canal (cria Document espelhado,
 * herdando a categoria da sala)
 * POST /chat/channels/:channelId/attachments
 */
export const uploadChatAttachment = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { channelId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }

    const caption = typeof req.body?.content === "string" ? req.body.content : undefined;

    const message = await ChatService.sendFileMessage(
      channelId,
      userId,
      {
        buffer: req.file.buffer,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
      },
      caption
    );

    try {
      const wsServer = WebSocketServer.getInstance();
      const io = wsServer.getIO();
      const channel = await ChatService.getChannel(channelId);
      if (channel) {
        io.to(channel.roomId)
          .to(`company:${channel.room.companyId}`)
          .emit("NEW_MESSAGE", {
            channelId,
            roomId: channel.roomId,
            message,
          });
      }
    } catch (error) {
      console.error("Erro ao emitir evento WebSocket:", error);
    }

    return res.status(201).json({ message });
  } catch (error: any) {
    console.error("Erro ao enviar arquivo no chat:", error);
    if (
      error.message.includes("não encontrado") ||
      error.message.includes("não é membro") ||
      error.message.includes("não tem permissão")
    ) {
      return res.status(403).json({ error: error.message });
    }
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Edita uma mensagem
 * PUT /chat/messages/:messageId
 */
export const editMessage = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { messageId } = req.params;
    const { content } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return res.status(400).json({ error: "content é obrigatório e não pode estar vazio" });
    }

    const input: EditMessageInput = {
      content,
      messageId,
    };

    const message = await ChatService.editMessage(input, userId);

    return res.json({ message });
  } catch (error: any) {
    console.error("Erro ao editar mensagem:", error);
    if (
      error.message.includes("não encontrada") ||
      error.message.includes("não é membro") ||
      error.message.includes("não tem permissão") ||
      error.message.includes("não é possível editar")
    ) {
      return res.status(403).json({ error: error.message });
    }
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Deleta uma mensagem (soft delete)
 * DELETE /chat/messages/:messageId
 */
export const deleteMessage = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { messageId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const input: DeleteMessageInput = {
      messageId,
    };

    await ChatService.deleteMessage(input, userId);

    return res.json({ message: "Mensagem deletada com sucesso" });
  } catch (error: any) {
    console.error("Erro ao deletar mensagem:", error);
    if (
      error.message.includes("não encontrada") ||
      error.message.includes("não é membro") ||
      error.message.includes("não tem permissão")
    ) {
      return res.status(403).json({ error: error.message });
    }
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Atualiza lastReadMessageId
 * PUT /chat/channels/:channelId/read
 */
export const updateReadState = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { channelId } = req.params;
    const { lastReadMessageId } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const input: UpdateReadStateInput = {
      channelId,
      lastReadMessageId,
    };

    await ChatService.updateReadState(input, userId);

    // Zerar badge de não lidas em outras abas/dispositivos do mesmo usuário
    try {
      const wsServer = WebSocketServer.getInstance();
      const channel = await ChatService.getChannel(channelId);
      if (channel) {
        wsServer
          .getIO()
          .to(`user:${userId}`)
          .emit("CHANNEL_READ", { channelId, roomId: channel.roomId });
      }
    } catch (error) {
      console.error("Erro ao emitir evento WebSocket:", error);
    }

    return res.json({ message: "Estado de leitura atualizado com sucesso" });
  } catch (error: any) {
    console.error("Erro ao atualizar estado de leitura:", error);
    if (
      error.message.includes("não é participante") ||
      error.message.includes("não encontrada")
    ) {
      return res.status(403).json({ error: error.message });
    }
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Obtém informações do canal
 * GET /chat/channels/:channelId
 */
export const getChannel = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { channelId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const channel = await ChatService.getChannel(channelId);

    if (!channel) {
      return res.status(404).json({ error: "Canal não encontrado" });
    }

    // Verificar se é participante
    const participant = await ChatService.verifyParticipant(userId, channelId);
    if (!participant) {
      return res.status(403).json({ error: "Usuário não é participante do canal" });
    }

    return res.json({ channel });
  } catch (error: any) {
    console.error("Erro ao buscar canal:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Obtém canal pelo roomId
 * GET /chat/rooms/:roomId/channel
 */
export const getChannelByRoom = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { roomId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const channel = await ChatService.getOrCreateChannelByRoomId(roomId);

    if (!channel) {
      return res.status(404).json({ error: "Sala não encontrada" });
    }

    // Verificar se é membro ativo da empresa
    const isMember = await ChatService.verifyCompanyMember(
      userId,
      channel.room.companyId
    );
    if (!isMember) {
      return res.status(403).json({ error: "Usuário não é membro ativo da empresa" });
    }

    // Verificar se é participante, se não for, adicionar automaticamente
    let participant = await ChatService.verifyParticipant(userId, channel.id);
    if (!participant) {
      // Adicionar como participante automaticamente se for membro da empresa
      participant = await ChatService.addParticipant(userId, channel.id);
    }

    return res.json({ channel });
  } catch (error: any) {
    console.error("Erro ao buscar canal por sala:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Conta mensagens não lidas por canal, para a sidebar
 * GET /chat/companies/:companyId/unread-counts
 */
export const getUnreadCounts = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { companyId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const isMember = await ChatService.verifyCompanyMember(userId, companyId);
    if (!isMember) {
      return res.status(403).json({ error: "Usuário não é membro ativo da empresa" });
    }

    const counts = await ChatService.getUnreadCounts(userId, companyId);

    return res.json({ counts });
  } catch (error: any) {
    console.error("Erro ao buscar contagem de não lidas:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Busca (com cache) metadados de preview (Open Graph) de uma URL
 * POST /chat/link-preview
 */
export const getLinkPreview = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { url } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "url é obrigatória" });
    }

    const preview = await LinkPreviewService.getOrFetchPreview(url);

    return res.json({ preview });
  } catch (error: any) {
    console.error("Erro ao buscar preview de link:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Busca o bot do agente de sistema (Pinguelo)
 * GET /chat/bots/pingr
 */
export const getSystemAgentBot = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const bot = await ChatService.getSystemAgentBot();

    return res.json({ bot });
  } catch (error: any) {
    console.error("Erro ao buscar bot do Pinguelo:", error);
    if (error.message.includes("não encontrado")) {
      return res.status(404).json({ error: error.message });
    }
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Pina ou despina uma mensagem
 * PATCH /chat/messages/:messageId/pin
 */
export const pinMessage = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { messageId } = req.params;
    const { isPinned } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    if (typeof isPinned !== "boolean") {
      return res.status(400).json({ error: "isPinned deve ser um booleano" });
    }

    const input: PinMessageInput = {
      messageId,
      isPinned,
    };

    const message = await ChatService.pinMessage(input, userId);

    // Buscar o canal para obter o roomId e emitir evento WebSocket
    try {
      const wsServer = WebSocketServer.getInstance();
      const io = wsServer.getIO();
      // Buscar a mensagem novamente para obter o channelId
      const messageWithChannel = await prisma.chatMessage.findUnique({
        where: { id: messageId },
        include: {
          channel: {
            include: {
              room: {
                select: {
                  id: true,
                },
              },
            },
          },
        },
      });
      
      if (messageWithChannel) {
        io.to(messageWithChannel.channel.room.id).emit("MESSAGE_PINNED", {
          channelId: messageWithChannel.channelId,
          message,
        });
      }
    } catch (error) {
      console.error("Erro ao emitir evento WebSocket:", error);
    }

    return res.json({ message });
  } catch (error: any) {
    console.error("Erro ao pinar mensagem:", error);
    if (
      error.message.includes("não encontrada") ||
      error.message.includes("não é membro") ||
      error.message.includes("não tem permissão") ||
      error.message.includes("administradores")
    ) {
      return res.status(403).json({ error: error.message });
    }
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};
