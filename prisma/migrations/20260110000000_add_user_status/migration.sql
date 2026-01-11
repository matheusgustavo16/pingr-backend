-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('AVAILABLE', 'BUSY', 'IN_MEETING', 'AWAY', 'FOCUS', 'CODING', 'REVIEWING');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'AVAILABLE';
