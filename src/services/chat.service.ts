import { prisma } from "./prisma.service";
import { getSignedDeliveryUrl } from "./cloudinary.service";
import { MessageType, ChatRole, MemberStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { NotificationService } from "./notification.service";
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
  ChatPostProposalInfo,
  ChatPostProposalItemStatus,
} from "../types/chat.types";

const PROPOSAL_INCLUDE = {
  items: {
    include: { postGeneration: { select: { status: true, resultUrl: true, errorMessage: true } } },
    orderBy: { index: "asc" as const },
  },
} satisfies Prisma.ChatPostProposalInclude;

function mapProposal(
  proposal: Prisma.ChatPostProposalGetPayload<{ include: typeof PROPOSAL_INCLUDE }> | null
): ChatPostProposalInfo | null {
  if (!proposal) return null;
  return {
    id: proposal.id,
    taskId: proposal.taskId,
    items: proposal.items.map((item) => ({
      id: item.id,
      index: item.index,
      title: item.title,
      details: item.details,
      promptEn: item.promptEn,
      promptPt: item.promptPt,
      postGenerationId: item.postGenerationId,
      status: (item.postGeneration?.status ?? "DRAFT") as ChatPostProposalItemStatus,
      resultUrl: item.postGeneration?.resultUrl ?? null,
      errorMessage: item.postGeneration?.errorMessage ?? null,
    })),
  };
}

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
            categoryId: true,
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
   * Cria notificações para os participantes do canal (exceto o autor, se houver)
   */
  private static async notifyOtherParticipants(
    channel: ChatChannelInfo,
    excludeUserId: string | null,
    authorName: string,
    preview: string
  ) {
    try {
      const otherParticipants = await prisma.chatParticipant.findMany({
        where: {
          channelId: channel.id,
          ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
        },
        select: { userId: true },
      });

      await NotificationService.createMany(
        otherParticipants.map((p) => ({
          userId: p.userId,
          type: "MESSAGE" as const,
          title: `Nova mensagem em ${channel.room.title}`,
          description: `${authorName}: ${preview}`,
          actionUrl: `/office/${channel.room.type.toLowerCase()}/${channel.room.id}`,
        }))
      );
    } catch (error) {
      console.error("Erro ao criar notificações de mensagem:", error);
    }
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
            categoryId: true,
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
            categoryId: true,
          },
        },
      },
    });

    return channel;
  }

  /**
   * Igual a `getChannelByRoomId`, mas cria o canal on-demand se a sala ainda
   * não tiver um — cobre salas antigas que nasceram sem canal pareado (ex:
   * o Auditório criado no fluxo antigo de `createCompany`, antes desse par
   * ser garantido pra toda sala).
   */
  static async getOrCreateChannelByRoomId(
    roomId: string
  ): Promise<ChatChannelInfo | null> {
    const existing = await this.getChannelByRoomId(roomId);
    if (existing) return existing;

    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) return null;

    return this.createChannelForRoom(roomId);
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
        bot: {
          select: {
            id: true,
            name: true,
            picture: true,
          },
        },
        postProposal: { include: PROPOSAL_INCLUDE },
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

    // metadata.fileUrl é congelado no momento do envio e fica obsoleto pra
    // arquivos "raw" (a URL assinada não tem prazo hoje, mas não confiamos
    // nisso pra sempre) — reconstitui via Document (fonte da verdade) em
    // vez de confiar na cópia congelada.
    const fileDocumentIds = messagesToReturn
      .filter((msg) => msg.type === MessageType.FILE)
      .map((msg) => (msg.metadata as Record<string, unknown> | null)?.documentId)
      .filter((id): id is string => typeof id === "string");

    const textAttachmentDocumentIds = messagesToReturn.flatMap((msg) => {
      const attachments = (msg.metadata as Record<string, unknown> | null)?.attachments;
      if (!Array.isArray(attachments)) return [];
      return attachments
        .map((att) => (att as Record<string, unknown> | null)?.documentId)
        .filter((id): id is string => typeof id === "string");
    });

    const allDocumentIds = [...fileDocumentIds, ...textAttachmentDocumentIds];
    const documentsById = allDocumentIds.length
      ? new Map(
          (
            await prisma.document.findMany({
              where: { id: { in: allDocumentIds } },
              select: { id: true, publicId: true, fileName: true, fileType: true },
            })
          ).map((doc) => [doc.id, doc])
        )
      : new Map<string, { id: string; publicId: string; fileName: string; fileType: string | null }>();

    return {
      messages: messagesToReturn.map((msg) => {
        const rawMetadata = (msg.metadata as Record<string, unknown> | null) ?? null;
        const documentId = rawMetadata?.documentId;
        const doc = typeof documentId === "string" ? documentsById.get(documentId) : undefined;
        const rawAttachments = rawMetadata?.attachments;
        const metadata = doc
          ? {
              ...rawMetadata,
              fileUrl: getSignedDeliveryUrl({
                publicId: doc.publicId,
                fileUrl: rawMetadata?.fileUrl as string,
                fileName: doc.fileName,
                fileType: doc.fileType,
              }),
            }
          : Array.isArray(rawAttachments)
          ? {
              ...rawMetadata,
              attachments: rawAttachments.map((att) => {
                const attRecord = att as Record<string, unknown>;
                const attDoc =
                  typeof attRecord.documentId === "string" ? documentsById.get(attRecord.documentId) : undefined;
                if (!attDoc) return attRecord;
                return {
                  ...attRecord,
                  fileUrl: getSignedDeliveryUrl({
                    publicId: attDoc.publicId,
                    fileUrl: attRecord.fileUrl as string,
                    fileName: attDoc.fileName,
                    fileType: attDoc.fileType,
                  }),
                };
              }),
            }
          : rawMetadata;

        return {
        id: msg.id,
        content: msg.content,
        type: msg.type,
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt,
        isEdited: msg.isEdited,
        isDeleted: msg.isDeleted,
        isPinned: msg.isPinned,
        metadata,
        author: msg.author
          ? {
              id: msg.author.id,
              name: msg.author.name,
              email: msg.author.email,
              picture: msg.author.picture,
            }
          : msg.bot
          ? {
              id: msg.bot.id,
              name: msg.bot.name,
              email: "", // Bot não tem email
              picture: msg.bot.picture,
            }
          : null,
        proposal: mapProposal(msg.postProposal),
        };
      }),
      nextCursor: hasMore
        ? messagesToReturn[messagesToReturn.length - 1].createdAt.toISOString()
        : null,
      hasMore,
    };
  }

  /**
   * Busca o bot do agente de sistema (Pinguelo, sem companyId).
   * `provider: "pingr"` é um marcador interno de identidade de chat — não confundir com `Agent.provider` (escolha de LLM).
   */
  static async getSystemAgentBot() {
    const bot = await prisma.chatBot.findFirst({
      where: {
        companyId: null,
        provider: "pingr",
        name: "Pinguelo",
      },
    });

    if (!bot) {
      throw new Error("Bot padrão do Pinguelo não encontrado");
    }

    return bot;
  }

  /**
   * Recarrega uma mensagem POST_GENERATION_PROPOSAL já hidratada com a proposal
   * e seus itens — usado depois de criar a mensagem de fechamento da tool
   * `generateContentPosts` (a FK ChatPostProposal.chatMessageId só existe a
   * partir desse ponto, não dava pra incluir no create).
   */
  static async getMessageWithProposal(messageId: string): Promise<MessageWithAuthor> {
    const message = await prisma.chatMessage.findUniqueOrThrow({
      where: { id: messageId },
      include: {
        author: { select: { id: true, name: true, email: true, picture: true } },
        bot: { select: { id: true, name: true, picture: true } },
        postProposal: { include: PROPOSAL_INCLUDE },
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
      metadata: (message.metadata as Record<string, unknown> | null) ?? null,
      author: message.author
        ? { id: message.author.id, name: message.author.name, email: message.author.email, picture: message.author.picture }
        : message.bot
          ? { id: message.bot.id, name: message.bot.name, email: "", picture: message.bot.picture }
          : null,
      proposal: mapProposal(message.postProposal),
    };
  }

  /**
   * Envia uma mensagem
   * @param userId - Pode ser vazio para mensagens de bot
   */
  static async sendMessage(
    input: CreateMessageInput,
    userId: string = ""
  ): Promise<MessageWithAuthor> {
    const { content, type, channelId, botId, attachmentDocumentIds } = input;

    // Verificar se o canal existe
    const channel = await this.getChannel(channelId);
    if (!channel) {
      throw new Error("Canal não encontrado");
    }

    // Se for mensagem de bot, não precisa verificar participante
    if (botId) {
      // Verificar se o bot existe
      // Pode ser o bot da Pingr (sem companyId) ou um bot da empresa (com companyId)
      const bot = await prisma.chatBot.findFirst({
        where: {
          id: botId,
          OR: [
            { companyId: null }, // Bot da Pingr
            { companyId: channel.room.companyId }, // Bot da empresa
          ],
        },
      });

      if (!bot) {
        throw new Error("Bot não encontrado");
      }

      // Criar mensagem de bot
      const message = await prisma.chatMessage.create({
        data: {
          content: content.trim(),
          type: type ?? MessageType.BOT,
          botId,
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

      await this.notifyOtherParticipants(channel, null, bot.name, "Nova atualização");

      return {
        id: message.id,
        content: message.content,
        type: message.type,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        isEdited: message.isEdited,
        isDeleted: message.isDeleted,
        isPinned: message.isPinned,
        metadata: (message.metadata as Record<string, unknown> | null) ?? null,
        // Dobra o bot em "author" (mesmo contrato de listMessages) — front
        // não precisa saber a diferença entre autor humano e bot do agente.
        author: { id: bot.id, name: bot.name, email: "", picture: bot.picture },
      };
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

    // Anexos existentes (documentos da empresa) referenciados nesta mensagem —
    // ver comentário em CreateMessageInput: envio unificado com @menção de agente.
    let attachmentsMetadata: Prisma.InputJsonValue[] | null = null;
    if (attachmentDocumentIds && attachmentDocumentIds.length > 0) {
      const documents = await prisma.document.findMany({
        where: { id: { in: attachmentDocumentIds }, companyId: channel.room.companyId },
      });
      const documentsById = new Map(documents.map((doc) => [doc.id, doc]));
      attachmentsMetadata = attachmentDocumentIds
        .map((id) => documentsById.get(id))
        .filter((doc): doc is NonNullable<typeof doc> => !!doc)
        .map(
          (doc): Prisma.InputJsonValue => ({
            documentId: doc.id,
            fileUrl: getSignedDeliveryUrl({
              publicId: doc.publicId,
              fileUrl: doc.fileUrl,
              fileName: doc.fileName,
              fileType: doc.fileType,
            }),
            fileName: doc.fileName,
            fileType: doc.fileType,
            fileSize: doc.fileSize,
          })
        );
    }

    // Criar mensagem
    const message = await prisma.chatMessage.create({
      data: {
        content: content.trim(),
        type: type ?? MessageType.TEXT,
        authorId: userId,
        channelId,
        metadata: attachmentsMetadata ? { attachments: attachmentsMetadata } : undefined,
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

    const preview = content.trim().length > 80 ? `${content.trim().slice(0, 80)}...` : content.trim();
    await this.notifyOtherParticipants(channel, userId, message.author?.name || "Alguém", preview);

    return {
      id: message.id,
      content: message.content,
      type: message.type,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      isEdited: message.isEdited,
      isDeleted: message.isDeleted,
      isPinned: message.isPinned,
      metadata: (message.metadata as Record<string, unknown> | null) ?? null,
      author: message.author
        ? {
            id: message.author.id,
            name: message.author.name,
            email: message.author.email,
            picture: message.author.picture,
          }
        : null,
    };
  }

  /**
   * Envia um arquivo como mensagem — cria a mensagem (type FILE) e um
   * Document espelhado (mesmo contrato do anexo de task), herdando a
   * categoria da sala do canal automaticamente.
   */
  static async sendFileMessage(
    channelId: string,
    userId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    caption?: string
  ): Promise<MessageWithAuthor> {
    const channel = await prisma.chatChannel.findUnique({
      where: { id: channelId },
      include: {
        room: {
          select: {
            id: true,
            title: true,
            type: true,
            companyId: true,
            categoryId: true,
            workspaceId: true,
          },
        },
      },
    });
    if (!channel) {
      throw new Error("Canal não encontrado");
    }

    const isMember = await this.verifyCompanyMember(userId, channel.room.companyId);
    if (!isMember) {
      throw new Error("Usuário não é membro ativo da empresa");
    }

    let participant = await this.verifyParticipant(userId, channelId);
    if (!participant) {
      participant = await prisma.chatParticipant.create({
        data: { userId, channelId, role: ChatRole.MEMBER },
        include: {
          user: { select: { id: true, name: true, email: true, picture: true } },
        },
      });
    }
    if (!this.canSendMessage(participant)) {
      throw new Error("Usuário não tem permissão para enviar mensagens");
    }

    const { uploadFile } = await import("./cloudinary.service");
    const uploadResult = await uploadFile(
      file.buffer,
      `documents/${channel.room.companyId}/chat/${channelId}`,
      file.originalname,
      file.mimetype
    );

    const { message, document } = await prisma.$transaction(async (tx) => {
      const created = await tx.chatMessage.create({
        data: {
          content: caption?.trim() || file.originalname,
          type: MessageType.FILE,
          authorId: userId,
          channelId,
        },
      });

      const doc = await tx.document.create({
        data: {
          fileName: file.originalname,
          fileUrl: uploadResult.url,
          publicId: uploadResult.publicId,
          fileType: file.mimetype,
          fileSize: file.size,
          companyId: channel.room.companyId,
          workspaceId: channel.room.workspaceId,
          categoryId: channel.room.categoryId,
          uploadedById: userId,
          chatMessageId: created.id,
        },
      });

      const updated = await tx.chatMessage.update({
        where: { id: created.id },
        data: {
          metadata: {
            documentId: doc.id,
            // fileUrl aqui é só um cache best-effort do momento do envio —
            // resources "raw" (private) exigem URL assinada com signature/
            // timestamp; listMessages sempre recalcula na leitura via
            // getSignedDeliveryUrl (o Document é a fonte da verdade).
            fileUrl: getSignedDeliveryUrl({
              publicId: doc.publicId,
              fileUrl: doc.fileUrl,
              fileName: doc.fileName,
              fileType: doc.fileType,
            }),
            fileName: doc.fileName,
            fileType: doc.fileType,
            fileSize: doc.fileSize,
          },
        },
        include: {
          author: { select: { id: true, name: true, email: true, picture: true } },
        },
      });

      return { message: updated, document: doc };
    });

    const { documentAnalysisService } = await import("./document-analysis.service");
    void documentAnalysisService
      .enqueueForDocument(document.id, document.fileType)
      .catch((error) => console.error("Erro ao enfileirar análise de documento:", error));

    await this.notifyOtherParticipants(channel, userId, message.author?.name || "Alguém", `📎 ${file.originalname}`);

    return {
      id: message.id,
      content: message.content,
      type: message.type,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      isEdited: message.isEdited,
      isDeleted: message.isDeleted,
      isPinned: message.isPinned,
      metadata: message.metadata as Record<string, unknown>,
      author: message.author
        ? {
            id: message.author.id,
            name: message.author.name,
            email: message.author.email,
            picture: message.author.picture,
          }
        : null,
    };
  }

  /**
   * Anexa um Document já existente (escolhido no modal "Documentos da
   * empresa") como mensagem no canal — sem duplicar o arquivo, ao contrário
   * de sendFileMessage (que faz upload de um novo arquivo).
   */
  static async attachExistingDocument(
    channelId: string,
    userId: string,
    documentId: string,
    caption?: string
  ): Promise<MessageWithAuthor> {
    const channel = await prisma.chatChannel.findUnique({
      where: { id: channelId },
      include: {
        room: {
          select: {
            id: true,
            title: true,
            type: true,
            companyId: true,
            categoryId: true,
            workspaceId: true,
          },
        },
      },
    });
    if (!channel) {
      throw new Error("Canal não encontrado");
    }

    const isMember = await this.verifyCompanyMember(userId, channel.room.companyId);
    if (!isMember) {
      throw new Error("Usuário não é membro ativo da empresa");
    }

    let participant = await this.verifyParticipant(userId, channelId);
    if (!participant) {
      participant = await prisma.chatParticipant.create({
        data: { userId, channelId, role: ChatRole.MEMBER },
        include: {
          user: { select: { id: true, name: true, email: true, picture: true } },
        },
      });
    }
    if (!this.canSendMessage(participant)) {
      throw new Error("Usuário não tem permissão para enviar mensagens");
    }

    const document = await prisma.document.findFirst({
      where: { id: documentId, companyId: channel.room.companyId },
    });
    if (!document) {
      throw new Error("Documento não encontrado");
    }

    const message = await prisma.chatMessage.create({
      data: {
        content: caption?.trim() || document.fileName,
        type: MessageType.FILE,
        authorId: userId,
        channelId,
        metadata: {
          documentId: document.id,
          fileUrl: getSignedDeliveryUrl({
            publicId: document.publicId,
            fileUrl: document.fileUrl,
            fileName: document.fileName,
            fileType: document.fileType,
          }),
          fileName: document.fileName,
          fileType: document.fileType,
          fileSize: document.fileSize,
        },
      },
      include: {
        author: { select: { id: true, name: true, email: true, picture: true } },
      },
    });

    await this.notifyOtherParticipants(channel, userId, message.author?.name || "Alguém", `📎 ${document.fileName}`);

    return {
      id: message.id,
      content: message.content,
      type: message.type,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      isEdited: message.isEdited,
      isDeleted: message.isDeleted,
      isPinned: message.isPinned,
      metadata: message.metadata as Record<string, unknown>,
      author: message.author
        ? {
            id: message.author.id,
            name: message.author.name,
            email: message.author.email,
            picture: message.author.picture,
          }
        : null,
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
    // Mensagens de bot não podem ser editadas
    if (!message.authorId) {
      throw new Error("Mensagens de bot não podem ser editadas");
    }

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
      metadata: (updated.metadata as Record<string, unknown> | null) ?? null,
      author: updated.author
        ? {
            id: updated.author.id,
            name: updated.author.name,
            email: updated.author.email,
            picture: updated.author.picture,
          }
        : null,
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
    // Mensagens de bot não podem ser deletadas
    if (!message.authorId) {
      throw new Error("Mensagens de bot não podem ser deletadas");
    }

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
   * Conta mensagens não lidas por canal, para todos os canais da empresa.
   * Usado pelo badge de não lidas na sidebar. Mensagens do próprio usuário
   * não contam como não lidas.
   */
  static async getUnreadCounts(
    userId: string,
    companyId: string
  ): Promise<Record<string, number>> {
    const channels = await prisma.chatChannel.findMany({
      where: { room: { companyId } },
      select: { id: true, roomId: true },
    });
    const channelIds = channels.map((c) => c.id);
    if (channelIds.length === 0) return {};
    const roomIdByChannel = new Map(channels.map((c) => [c.id, c.roomId]));

    const readStates = await prisma.chatReadState.findMany({
      where: { userId, channelId: { in: channelIds } },
      select: { channelId: true, lastReadMessageId: true },
    });

    const lastReadMessageIds = readStates
      .map((r) => r.lastReadMessageId)
      .filter((id): id is string => !!id);

    const lastReadMessages = lastReadMessageIds.length
      ? await prisma.chatMessage.findMany({
          where: { id: { in: lastReadMessageIds } },
          select: { id: true, createdAt: true },
        })
      : [];
    const createdAtById = new Map(
      lastReadMessages.map((m) => [m.id, m.createdAt])
    );
    const readAtByChannel = new Map(
      readStates.map((r) => [
        r.channelId,
        r.lastReadMessageId ? createdAtById.get(r.lastReadMessageId) ?? null : null,
      ])
    );

    const counts: Record<string, number> = {};
    await Promise.all(
      channelIds.map(async (channelId) => {
        const readAt = readAtByChannel.get(channelId);
        const count = await prisma.chatMessage.count({
          where: {
            channelId,
            isDeleted: false,
            authorId: { not: userId },
            ...(readAt ? { createdAt: { gt: readAt } } : {}),
          },
        });
        if (count > 0) counts[roomIdByChannel.get(channelId)!] = count;
      })
    );

    return counts;
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
      metadata: (updated.metadata as Record<string, unknown> | null) ?? null,
      author: updated.author
        ? {
            id: updated.author.id,
            name: updated.author.name,
            email: updated.author.email,
            picture: updated.author.picture,
          }
        : null,
    };
  }
}
