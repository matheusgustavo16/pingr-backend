-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "postGenerationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "documents_postGenerationId_key" ON "documents"("postGenerationId");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_postGenerationId_fkey" FOREIGN KEY ("postGenerationId") REFERENCES "post_generations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
