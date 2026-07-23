import { MessageType, ChatRole } from "@prisma/client";

export interface CreateMessageInput {
  content: string;
  type?: MessageType;
  channelId: string;
  botId?: string; // Para mensagens de bot
  /** Documentos da empresa a anexar nessa mesma mensagem (envio unificado com @menção de agente). */
  attachmentDocumentIds?: string[];
}

export type ChatPostProposalItemStatus = "DRAFT" | "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface ChatPostProposalItemInfo {
  id: string;
  index: number;
  title: string;
  details: string;
  promptEn: string;
  promptPt: string;
  postGenerationId: string | null;
  status: ChatPostProposalItemStatus;
  resultUrl: string | null;
  errorMessage: string | null;
}

export interface ChatPostProposalInfo {
  id: string;
  taskId: string | null;
  items: ChatPostProposalItemInfo[];
}

export interface EditMessageInput {
  content: string;
  messageId: string;
}

export interface DeleteMessageInput {
  messageId: string;
}

export interface PinMessageInput {
  messageId: string;
  isPinned: boolean;
}

export interface UpdateReadStateInput {
  channelId: string;
  lastReadMessageId: string;
}

export interface ListMessagesQuery {
  channelId: string;
  page?: number;
  limit?: number;
  cursor?: string; // createdAt cursor para paginação
}

export interface MessageWithAuthor {
  id: string;
  content: string;
  type: MessageType;
  createdAt: Date;
  updatedAt: Date;
  isEdited: boolean;
  isDeleted: boolean;
  isPinned: boolean;
  /** Preenchido para type = FILE: { documentId, fileUrl, fileName, fileType, fileSize }. */
  metadata: Record<string, unknown> | null;
  author: {
    id: string;
    name: string;
    email: string;
    picture: string | null;
  } | null;
  /** Preenchido para type = POST_GENERATION_PROPOSAL. */
  proposal?: ChatPostProposalInfo | null;
}

export interface PaginatedMessages {
  messages: MessageWithAuthor[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ChatParticipantInfo {
  id: string;
  userId: string;
  channelId: string;
  role: ChatRole;
  joinedAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
    picture: string | null;
  };
}

export interface ChatChannelInfo {
  id: string;
  roomId: string;
  createdAt: Date;
  updatedAt: Date;
  isArchived: boolean;
  room: {
    id: string;
    title: string;
    type: string;
    companyId: string;
    categoryId: string | null;
  };
}
