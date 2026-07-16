-- CreateEnum
CREATE TYPE "AgentTriggerType" AS ENUM ('VOICE_COMMAND', 'CHAT_MESSAGE', 'AUTONOMOUS');

-- CreateEnum
CREATE TYPE "AgentActionStatus" AS ENUM ('SUCCESS', 'ERROR');

-- CreateTable
CREATE TABLE "call_sessions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "roomId" TEXT NOT NULL,
    "startedById" TEXT NOT NULL,

    CONSTRAINT "call_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_segments" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "callSessionId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isFinal" BOOLEAN NOT NULL DEFAULT true,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION,

    CONSTRAINT "transcript_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_action_logs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "callSessionId" TEXT,
    "roomId" TEXT NOT NULL,
    "triggeredByUserId" TEXT,
    "trigger" "AgentTriggerType" NOT NULL,
    "input" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "toolName" TEXT,
    "toolArgs" JSONB,
    "toolResult" JSONB,
    "status" "AgentActionStatus" NOT NULL DEFAULT 'SUCCESS',
    "errorMessage" TEXT,

    CONSTRAINT "agent_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "call_sessions_roomId_createdAt_idx" ON "call_sessions"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "transcript_segments_callSessionId_startMs_idx" ON "transcript_segments"("callSessionId", "startMs");

-- CreateIndex
CREATE INDEX "transcript_segments_roomId_createdAt_idx" ON "transcript_segments"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_action_logs_roomId_createdAt_idx" ON "agent_action_logs"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_action_logs_callSessionId_idx" ON "agent_action_logs"("callSessionId");

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_callSessionId_fkey" FOREIGN KEY ("callSessionId") REFERENCES "call_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_action_logs" ADD CONSTRAINT "agent_action_logs_callSessionId_fkey" FOREIGN KEY ("callSessionId") REFERENCES "call_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_action_logs" ADD CONSTRAINT "agent_action_logs_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
