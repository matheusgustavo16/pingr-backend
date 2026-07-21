-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "categoryId" TEXT;

-- CreateIndex
CREATE INDEX "agents_categoryId_idx" ON "agents"("categoryId");

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "room_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
