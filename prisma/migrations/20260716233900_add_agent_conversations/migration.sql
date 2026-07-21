-- CreateEnum
CREATE TYPE "ConversationVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "agent_conversations" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Nova conversa',
    "visibility" "ConversationVisibility" NOT NULL DEFAULT 'PRIVATE',
    "companyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "agent_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_conversation_messages" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "agentId" TEXT,
    "toolName" TEXT,
    "toolArgs" JSONB,
    "toolResult" JSONB,
    "status" "AgentActionStatus" NOT NULL DEFAULT 'SUCCESS',
    "errorMessage" TEXT,

    CONSTRAINT "agent_conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_conversations_companyId_createdById_idx" ON "agent_conversations"("companyId", "createdById");

-- CreateIndex
CREATE INDEX "agent_conversations_companyId_visibility_idx" ON "agent_conversations"("companyId", "visibility");

-- CreateIndex
CREATE INDEX "agent_conversation_messages_conversationId_createdAt_idx" ON "agent_conversation_messages"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_conversation_messages" ADD CONSTRAINT "agent_conversation_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "agent_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_conversation_messages" ADD CONSTRAINT "agent_conversation_messages_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
