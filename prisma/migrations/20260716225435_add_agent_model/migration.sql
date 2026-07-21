-- CreateEnum
CREATE TYPE "AgentKind" AS ENUM ('SYSTEM', 'TEMPLATE', 'COMPANY');

-- CreateEnum
CREATE TYPE "AgentLLMProvider" AS ENUM ('ANTHROPIC', 'OPENAI', 'DEEPSEEK');

-- AlterEnum
ALTER TYPE "RoomTypes" ADD VALUE 'PINGUELO';

-- AlterTable
ALTER TABLE "agent_action_logs" ADD COLUMN     "agentId" TEXT;

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "kind" "AgentKind" NOT NULL DEFAULT 'COMPANY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT,
    "templateId" TEXT,
    "name" TEXT NOT NULL,
    "age" INTEGER,
    "avatarUrl" TEXT,
    "specialty" TEXT NOT NULL,
    "philosophy" TEXT,
    "jobFunction" TEXT NOT NULL,
    "provider" "AgentLLMProvider" NOT NULL DEFAULT 'ANTHROPIC',
    "model" TEXT,
    "allowedTools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "triggerConfig" JSONB,
    "createdById" TEXT,
    "chatBotId" TEXT,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agents_chatBotId_key" ON "agents"("chatBotId");

-- CreateIndex
CREATE INDEX "agents_companyId_idx" ON "agents"("companyId");

-- CreateIndex
CREATE INDEX "agents_kind_idx" ON "agents"("kind");

-- CreateIndex
CREATE INDEX "agent_action_logs_agentId_idx" ON "agent_action_logs"("agentId");

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_chatBotId_fkey" FOREIGN KEY ("chatBotId") REFERENCES "chat_bots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_action_logs" ADD CONSTRAINT "agent_action_logs_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
