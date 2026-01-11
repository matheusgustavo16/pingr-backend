-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "isPinned" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "chat_messages_channelId_isPinned_idx" ON "chat_messages"("channelId", "isPinned");
