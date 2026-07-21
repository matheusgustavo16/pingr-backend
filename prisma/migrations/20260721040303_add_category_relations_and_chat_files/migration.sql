-- AlterEnum
ALTER TYPE "MessageType" ADD VALUE 'FILE';

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "chatMessageId" TEXT;

-- AlterTable
ALTER TABLE "schedule_events" ADD COLUMN     "categoryId" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "categoryId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "documents_chatMessageId_key" ON "documents"("chatMessageId");

-- CreateIndex
CREATE INDEX "documents_categoryId_idx" ON "documents"("categoryId");

-- CreateIndex
CREATE INDEX "schedule_events_categoryId_idx" ON "schedule_events"("categoryId");

-- CreateIndex
CREATE INDEX "tasks_categoryId_idx" ON "tasks"("categoryId");

-- AddForeignKey
ALTER TABLE "schedule_events" ADD CONSTRAINT "schedule_events_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "room_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "room_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "room_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

