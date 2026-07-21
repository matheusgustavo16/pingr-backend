-- CreateEnum
CREATE TYPE "MeetingSummaryStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "meeting_summaries" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "callSessionId" TEXT NOT NULL,
    "status" "MeetingSummaryStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "provider" "AgentLLMProvider",
    "model" TEXT,
    "summary" TEXT,
    "decisions" JSONB,
    "actionItems" JSONB,
    "risks" JSONB,
    "insights" JSONB,
    "discussedTopics" JSONB,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "markdown" TEXT,

    CONSTRAINT "meeting_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meeting_summaries_callSessionId_key" ON "meeting_summaries"("callSessionId");

-- AddForeignKey
ALTER TABLE "meeting_summaries" ADD CONSTRAINT "meeting_summaries_callSessionId_fkey" FOREIGN KEY ("callSessionId") REFERENCES "call_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
