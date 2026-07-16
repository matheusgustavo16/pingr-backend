-- CreateEnum
CREATE TYPE "EventVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- AlterTable
ALTER TABLE "schedule_events" ADD COLUMN     "visibility" "EventVisibility" NOT NULL DEFAULT 'PUBLIC';
