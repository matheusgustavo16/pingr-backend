import { prisma } from "./prisma.service";
import { MessageType, ChatRole, MemberStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import {
  CreateMessageInput,
  EditMessageInput,
  DeleteMessageInput,
  UpdateReadStateInput,
  ListMessagesQuery,
  PinMessageInput,
  MessageWithAuthor,
  PaginatedMessages,
  ChatParticipantInfo,
  ChatChannelInfo,
} from "../types/chat.types";

export class ChatService {
  /**
   * Cria um ChatChannel automaticamente ao criar uma Room do tipo CHAT
   * @param roomId ID da sala
   * @param tx Cliente Prisma opcional para transações
   */
  static async createChannelForRoom(
    roomId: string,
    tx?: Prisma.TransactionClient
  ): Promise<ChatChannelInfo> {
    const client = tx || prisma;
    const channel = await client.chatChannel.create({
      data: {
        roomId,
      },
      include: {
        room: {
          select: {
            id: true,
            title: true,
            type: true,
            companyId: true,
          },
        },
      },
    });

    return channel;
  }

  /**
   * Verifica se o usuário é membro ativo da empresa
   */
  static async verifyCompanyMember(
    userId: string,
    companyId: string
  ): Promise<boolean> {
    const membership = await prisma.companyMember.findFirst({
      where: {
        userId,
        companyId,
        status: MemberStatus.ACTIVE,
      },
    });

    return !!membership;
  }

  /**
   * Verifica se o usuário é participante do canal
   */
  static async verifyParticipant(
    userId: string,
    channelId: string
  ): Promise<ChatParticipantInfo | null> {
    const participant = await prisma.chatParticipant.findUnique({
      where: {
        userId_channelId: {
          userId,
          channelId,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            picture: true,
          },
        },
      },
    });

    return participant;
  }

  /**
   * Verifica se o usuário pode enviar mensagens (não é READ_ONLY)
   */
  static canSendMessage(participant: ChatParticipantInfo | null): boolean {
    if (!participant) return false;
    return participant.role !== ChatRole.READ_ONLY;
  }

  /**
   * Verifica se o usuário pode editar/deletar mensagem (autor ou ADMIN)
   */
  static canModifyMessage(
    userId: string,
    authorId: string,
    participant: ChatParticipantInfo | null
  ): boolean {
    if (userId === authorId) return true;
    if (!participant) return false;
    return participant.role === ChatRole.ADMIN;
  }

  /**
   * Obtém informações do canal
   */
  static async getChannel(channelId: string): Promise<ChatChannelInfo | null> {
    const channel = await prisma.chatChannel.findUnique({
      where: { id: channelId },
      include: {
        room: {
          select: {
            id: true,
            title: true,
            type: true,
            companyId: true,
          },
        },
      },
    });

    return channel;
  }

  /**
   * Obtém canal pelo roomId
   */
  static async getChannelByRoomId(roomId: string): Promise<ChatChannelInfo | null> {
    const channel = await prisma.chatChannel.findUnique({
      where: { roomId },
      include: {
        room: {
          select: {
            id: true,
            title: true,
            type: true,
            companyId: true,
          },
        },
      },
    });

    return channel;
  }

  /**
   * Lista mensagens do canal (paginado)
   */
  static async listMessages(
    query: ListMessagesQuery,
    userId: string
  ): Promise<PaginatedMessages> {
    const { channelId, page = 1, limit = 50, cursor } = query;
    const skip = (page - 1) * limit;

    // Verificar se é participante
    const participant = await this.verifyParticipant(userId, channelId);
    if (!participant) {
      throw new Error("Usuário não é participante do canal");
    }

    // Construir where clause
    const where: any = {
      channelId,
      isDeleted: false,
    };

    // Se houver cursor, usar para paginação baseada em cursor
    if (cursor) {
      where.createdAt = {
        lt: new Date(cursor),
      };
    }

    // Buscar mensagens
    const messages = await prisma.chatMessage.findMany({
      where,
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
            picture: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit + 1, // +1 para verificar se há mais
      skip: cursor ? 0 : skip,
    });

    const hasMore = messages.length > limit;
    const messagesToReturn = hasMore ? messages.slice(0, limit) : messages;

    // Reverter ordem para mostrar mais antigas primeiro
    messagesToReturn.reverse();

    return {
      messages: messagesToReturn.map((msg) => ({
        id: msg.id,
        content: msg.content,
        type: msg.type,
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt,
        isEdited: msg.isEdited,
        isDeleted: msg.isDeleted,
        isPinned: msg.isPinned,
        author: msg.author,
      })),
      nextCursor: hasMore
        ? messagesToReturn[messagesToReturn.length - 1].createdAt.toISOString()
        : null,
      hasMore,
    };
  }

  /**
   * Envia uma mensagem
   */
  static async sendMessage(
    input: CreateMessageInput,
    userId: string
  ): Promise<MessageWithAuthor> {
    const { content, type = MessageType.TEXT, channelId } = input;

    // Verificar se o canal existe
    const channel = await this.getChannel(channelId);
    if (!channel) {
      throw new Error("Canal não encontrado");
    }

    // Verificar se é membro ativo da empresa
    const isMember = await this.verifyCompanyMember(
      userId,
      channel.room.companyId
    );
    if (!isMember) {
      throw new Error("Usuário não é membro ativo da empresa");
    }

    // Verificar se é participante
    let participant = await this.verifyParticipant(userId, channelId);
    if (!participant) {
      // Criar participante automaticamente se não existir
      participant = await prisma.chatParticipant.create({
        data: {
          userId,
          channelId,
          role: ChatRole.MEMBER,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              picture: true,
            },
          },
        },
      });
    }

    // Verificar permissão para enviar
    if (!this.canSendMessage(participant)) {
      throw new Error("Usuário não tem permissão para enviar mensagens");
    }

    // Criar mensagem
    const message = await prisma.chatMessage.create({
      data: {
        content: content.trim(),
        type,
        authorId: userId,
        channelId,
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
            picture: true,
          },
        },
      },
    });

    return {
      id: message.id,
      content: message.content,
      type: message.type,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      isEdited: message.isEdited,
      isDeleted: message.isDeleted,
      isPinned: message.isPinned,
      author: message.author,
    };
  }

  /**
   * Edita uma mensagem
   */
  static async editMessage(
    input: EditMessageInput,
    userId: string
  ): Promise<MessageWithAuthor> {
    const { content, messageId } = input;

    // Buscar mensagem
    const message = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      include: {
        channel: {
          include: {
            room: {
              select: {
                companyId: true,
              },
            },
          },
        },
      },
    });

    if (!message) {
      throw new Error("Mensagem não encontrada");
    }

    if (message.isDeleted) {
      throw new Error("Não é possível editar mensagem deletada");
    }

    // Verificar se é membro ativo
    const isMember = await this.verifyCompanyMember(
      userId,
      message.channel.room.companyId
    );
    if (!isMember) {
      throw new Error("Usuário não é membro ativo da empresa");
    }

    // Verificar permissão para editar
    const participant = await this.verifyParticipant(
      userId,
      message.channelId
    );
    if (!this.canModifyMessage(userId, message.authorId, participant)) {
      throw new Error("Usuário não tem permissão para editar esta mensagem");
    }

    // Atualizar mensagem
    const updated = await prisma.chatMessage.update({
      where: { id: messageId },
      data: {
        content: content.trim(),
        isEdited: true,
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
            picture: true,
          },
        },
      },
    });

    return {
      id: updated.id,
      content: updated.content,
      type: updated.type,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      isEdited: updated.isEdited,
      isDeleted: updated.isDeleted,
      isPinned: updated.isPinned,
      author: updated.author,
    };
  }

  /**
   * Soft delete de mensagem
   */
  static async deleteMessage(
    input: DeleteMessageInput,
    userId: string
  ): Promise<void> {
    const { messageId } = input;

    // Buscar mensagem
    const message = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      include: {
        channel: {
          include: {
            room: {
              select: {
                companyId: true,
              },
            },
          },
        },
      },
    });

    if (!message) {
      throw new Error("Mensagem não encontrada");
    }

    if (message.isDeleted) {
      return; // Já está deletada
    }

    // Verificar se é membro ativo
    const isMember = await this.verifyCompanyMember(
      userId,
      message.channel.room.companyId
    );
    if (!isMember) {
      throw new Error("Usuário não é membro ativo da empresa");
    }

    // Verificar permissão para deletar
    const participant = await this.verifyParticipant(
      userId,
      message.channelId
    );
    if (!this.canModifyMessage(userId, message.authorId, participant)) {
      throw new Error("Usuário não tem permissão para deletar esta mensagem");
    }

    // Soft delete
    await prisma.chatMessage.update({
      where: { id: messageId },
      data: {
        isDeleted: true,
      },
    });
  }

  /**
   * Atualiza lastReadMessageId
   */
  static async updateReadState(
    input: UpdateReadStateInput,
    userId: string
  ): Promise<void> {
    const { channelId, lastReadMessageId } = input;

    // Verificar se é participante
    const participant = await this.verifyParticipant(userId, channelId);
    if (!participant) {
      throw new Error("Usuário não é participante do canal");
    }

    // Verificar se a mensagem existe e pertence ao canal
    if (lastReadMessageId) {
      const message = await prisma.chatMessage.findFirst({
        where: {
          id: lastReadMessageId,
          channelId,
        },
      });

      if (!message) {
        throw new Error("Mensagem não encontrada no canal");
      }
    }

    // Upsert read state
    await prisma.chatReadState.upsert({
      where: {
        userId_channelId: {
          userId,
          channelId,
        },
      },
      update: {
        lastReadMessageId: lastReadMessageId || null,
      },
      create: {
        userId,
        channelId,
        lastReadMessageId: lastReadMessageId || null,
      },
    });
  }

  /**
   * Adiciona participante ao canal
   */
  static async addParticipant(
    userId: string,
    channelId: string,
    role: ChatRole = ChatRole.MEMBER
  ): Promise<ChatParticipantInfo> {
    const participant = await prisma.chatParticipant.upsert({
      where: {
        userId_channelId: {
          userId,
          channelId,
        },
      },
      update: {
        role,
      },
      create: {
        userId,
        channelId,
        role,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            picture: true,
          },
        },
      },
    });

    return participant;
  }

  /**
   * Pina ou despina uma mensagem
   */
  static async pinMessage(
    input: PinMessageInput,
    userId: string
  ): Promise<MessageWithAuthor> {
    const { messageId, isPinned } = input;

    // Buscar mensagem
    const message = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      include: {
        channel: {
          include: {
            room: {
              select: {
                companyId: true,
              },
            },
          },
        },
      },
    });

    if (!message) {
      throw new Error("Mensagem não encontrada");
    }

    if (message.isDeleted) {
      throw new Error("Não é possível pinar mensagem deletada");
    }

    // Verificar se é membro ativo
    const isMember = await this.verifyCompanyMember(
      userId,
      message.channel.room.companyId
    );
    if (!isMember) {
      throw new Error("Usuário não é membro ativo da empresa");
    }

    // Verificar permissão (apenas ADMIN ou OWNER da empresa podem pinar)
    const companyMember = await prisma.companyMember.findFirst({
      where: {
        userId,
        companyId: message.channel.room.companyId,
      },
    });
    
    if (!companyMember || (companyMember.role !== "ADMIN" && companyMember.role !== "OWNER")) {
      throw new Error("Apenas administradores podem pinar mensagens");
    }

    // Se estiver pinando, despin todas as outras mensagens do canal
    if (isPinned) {
      await prisma.chatMessage.updateMany({
        where: {
          channelId: message.channelId,
          isPinned: true,
        },
        data: {
          isPinned: false,
        },
      });
    }

    // Atualizar mensagem
    const updated = await prisma.chatMessage.update({
      where: { id: messageId },
      data: {
        isPinned,
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
            picture: true,
          },
        },
      },
    });

    return {
      id: updated.id,
      content: updated.content,
      type: updated.type,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      isEdited: updated.isEdited,
      isDeleted: updated.isDeleted,
      isPinned: updated.isPinned,
      author: updated.author,
    };
  }
}
