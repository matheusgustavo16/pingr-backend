-- Habilita pgvector (idempotente; extversion 0.8.2 já confirmada no Postgres do projeto)
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('MEETING_SUMMARY');

-- CreateEnum
CREATE TYPE "KnowledgeChunkStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "sourceType" "KnowledgeSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "sourceTitle" TEXT,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "embedding" vector(1536),
    "embeddingModel" TEXT,
    "tokenCount" INTEGER,
    "status" "KnowledgeChunkStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_usage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL,
    "costUsd" DECIMAL(10,6) NOT NULL,

    CONSTRAINT "knowledge_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_chunks_companyId_sourceType_idx" ON "knowledge_chunks"("companyId", "sourceType");

-- CreateIndex
CREATE INDEX "knowledge_chunks_sourceId_idx" ON "knowledge_chunks"("sourceId");

-- CreateIndex
CREATE INDEX "knowledge_usage_companyId_createdAt_idx" ON "knowledge_usage"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_usage" ADD CONSTRAINT "knowledge_usage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (HNSW, cosine distance — pgvector 0.8.2 confirmado no Postgres do projeto)
CREATE INDEX "knowledge_chunks_embedding_hnsw_idx" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);
