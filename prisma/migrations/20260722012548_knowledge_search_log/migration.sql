-- CreateTable
CREATE TABLE "knowledge_search_logs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "resultsFound" INTEGER NOT NULL,
    "avgScore" DOUBLE PRECISION,

    CONSTRAINT "knowledge_search_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_search_logs_companyId_createdAt_idx" ON "knowledge_search_logs"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "knowledge_search_logs" ADD CONSTRAINT "knowledge_search_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
