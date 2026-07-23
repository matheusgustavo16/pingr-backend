-- AlterTable
ALTER TABLE "call_sessions" ADD COLUMN     "mergedIntoId" TEXT;

-- CreateIndex
CREATE INDEX "call_sessions_mergedIntoId_idx" ON "call_sessions"("mergedIntoId");

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "call_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
