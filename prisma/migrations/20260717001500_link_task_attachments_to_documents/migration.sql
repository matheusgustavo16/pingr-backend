-- AlterTable
ALTER TABLE "documents" ADD COLUMN "taskAttachmentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "documents_taskAttachmentId_key" ON "documents"("taskAttachmentId");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_taskAttachmentId_fkey" FOREIGN KEY ("taskAttachmentId") REFERENCES "task_attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
