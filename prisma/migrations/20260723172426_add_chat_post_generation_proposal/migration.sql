-- AlterEnum
ALTER TYPE "MessageType" ADD VALUE 'POST_GENERATION_PROPOSAL';

-- AlterTable
ALTER TABLE "post_generations" ADD COLUMN     "taskId" TEXT;

-- CreateTable
CREATE TABLE "chat_post_proposals" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "chatMessageId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "agentId" TEXT,
    "taskId" TEXT,

    CONSTRAINT "chat_post_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_post_proposal_items" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "proposalId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "promptEn" TEXT NOT NULL,
    "promptPt" TEXT NOT NULL,
    "postGenerationId" TEXT,

    CONSTRAINT "chat_post_proposal_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ChatPostProposalAttachments" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ChatPostProposalAttachments_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_post_proposals_chatMessageId_key" ON "chat_post_proposals"("chatMessageId");

-- CreateIndex
CREATE INDEX "chat_post_proposals_companyId_createdAt_idx" ON "chat_post_proposals"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_post_proposals_roomId_idx" ON "chat_post_proposals"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_post_proposal_items_postGenerationId_key" ON "chat_post_proposal_items"("postGenerationId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_post_proposal_items_proposalId_index_key" ON "chat_post_proposal_items"("proposalId", "index");

-- CreateIndex
CREATE INDEX "_ChatPostProposalAttachments_B_index" ON "_ChatPostProposalAttachments"("B");

-- CreateIndex
CREATE INDEX "post_generations_taskId_idx" ON "post_generations"("taskId");

-- AddForeignKey
ALTER TABLE "chat_post_proposals" ADD CONSTRAINT "chat_post_proposals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_post_proposals" ADD CONSTRAINT "chat_post_proposals_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "chat_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_post_proposals" ADD CONSTRAINT "chat_post_proposals_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_post_proposals" ADD CONSTRAINT "chat_post_proposals_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_post_proposals" ADD CONSTRAINT "chat_post_proposals_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_post_proposals" ADD CONSTRAINT "chat_post_proposals_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_post_proposal_items" ADD CONSTRAINT "chat_post_proposal_items_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "chat_post_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_post_proposal_items" ADD CONSTRAINT "chat_post_proposal_items_postGenerationId_fkey" FOREIGN KEY ("postGenerationId") REFERENCES "post_generations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_generations" ADD CONSTRAINT "post_generations_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ChatPostProposalAttachments" ADD CONSTRAINT "_ChatPostProposalAttachments_A_fkey" FOREIGN KEY ("A") REFERENCES "chat_post_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ChatPostProposalAttachments" ADD CONSTRAINT "_ChatPostProposalAttachments_B_fkey" FOREIGN KEY ("B") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

