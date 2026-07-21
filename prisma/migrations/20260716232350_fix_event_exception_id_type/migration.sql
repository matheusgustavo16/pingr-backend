/*
  Warnings:

  - The primary key for the `schedule_event_exceptions` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE "schedule_event_exceptions" DROP CONSTRAINT "schedule_event_exceptions_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "schedule_event_exceptions_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "schedule_event_exceptions_id_seq";
