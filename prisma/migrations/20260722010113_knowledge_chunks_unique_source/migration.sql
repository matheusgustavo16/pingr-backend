-- CreateIndex
DROP INDEX IF EXISTS "knowledge_chunks_sourceId_idx";
CREATE UNIQUE INDEX "knowledge_chunks_sourceType_sourceId_chunkIndex_key" ON "knowledge_chunks"("sourceType", "sourceId", "chunkIndex");
