-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "description" TEXT,
ADD COLUMN     "analysisStatus" "PostAssetJobStatus",
ADD COLUMN     "analysisError" TEXT;
