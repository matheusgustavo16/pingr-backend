import { MessageType, ChatRole } from "@prisma/client";

export interface CreateMessageInput {
  content: string;
  type?: MessageType;
  channelId: string;
  botId?: string; // Para mensagens de bot
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
  author: {
    id: string;
    name: string;
    email: string;
    picture: string | null;
  } | null;
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
  };
}
