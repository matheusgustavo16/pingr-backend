/*
  Warnings:

  - Added the required column `companyId` to the `room_categories` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "room_categories" ADD COLUMN     "companyId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "room_categories" ADD CONSTRAINT "room_categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
