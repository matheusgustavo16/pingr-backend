-- AlterEnum
ALTER TYPE "RoomTypes" ADD VALUE 'DEV';

-- AlterTable
ALTER TABLE "room_categories" ADD COLUMN     "workspaceId" TEXT;

-- AddForeignKey
ALTER TABLE "room_categories" ADD CONSTRAINT "room_categories_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
