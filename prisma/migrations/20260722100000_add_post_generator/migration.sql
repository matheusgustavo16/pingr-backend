-- CreateEnum
CREATE TYPE "PostAssetJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PostResultType" AS ENUM ('IMAGE', 'VIDEO');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "postTemplateId" TEXT;

-- CreateTable
CREATE TABLE "post_templates" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "description" TEXT,
    "status" "PostAssetJobStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,

    CONSTRAINT "post_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_generations" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "resultType" "PostResultType" NOT NULL DEFAULT 'IMAGE',
    "replicateModel" TEXT NOT NULL,
    "replicatePredictionId" TEXT,
    "status" "PostAssetJobStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "resultUrl" TEXT,
    "publicId" TEXT,

    CONSTRAINT "post_generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_PostGenerationTemplates" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PostGenerationTemplates_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "post_templates_companyId_idx" ON "post_templates"("companyId");

-- CreateIndex
CREATE INDEX "post_generations_companyId_createdAt_idx" ON "post_generations"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "_PostGenerationTemplates_B_index" ON "_PostGenerationTemplates"("B");

-- CreateIndex
CREATE UNIQUE INDEX "documents_postTemplateId_key" ON "documents"("postTemplateId");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_postTemplateId_fkey" FOREIGN KEY ("postTemplateId") REFERENCES "post_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_templates" ADD CONSTRAINT "post_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_templates" ADD CONSTRAINT "post_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_generations" ADD CONSTRAINT "post_generations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_generations" ADD CONSTRAINT "post_generations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PostGenerationTemplates" ADD CONSTRAINT "_PostGenerationTemplates_A_fkey" FOREIGN KEY ("A") REFERENCES "post_generations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PostGenerationTemplates" ADD CONSTRAINT "_PostGenerationTemplates_B_fkey" FOREIGN KEY ("B") REFERENCES "post_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

