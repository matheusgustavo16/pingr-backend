-- CreateEnum
CREATE TYPE "EventExceptionAction" AS ENUM ('CANCELLED', 'MODIFIED');

-- AlterTable
ALTER TABLE "schedule_events" ADD COLUMN     "isRecurring" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recurrenceRule" TEXT,
ADD COLUMN     "recurrenceUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "schedule_event_exceptions" (
    "id" BIGSERIAL NOT NULL,
    "eventId" TEXT NOT NULL,
    "occurrenceDate" TIMESTAMP(3) NOT NULL,
    "action" "EventExceptionAction" NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_event_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "schedule_event_exceptions_eventId_idx" ON "schedule_event_exceptions"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_event_exceptions_eventId_occurrenceDate_key" ON "schedule_event_exceptions"("eventId", "occurrenceDate");

-- AddForeignKey
ALTER TABLE "schedule_event_exceptions" ADD CONSTRAINT "schedule_event_exceptions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "schedule_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
