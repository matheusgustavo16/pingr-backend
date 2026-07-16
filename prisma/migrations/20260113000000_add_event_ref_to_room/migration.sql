-- AlterTable
ALTER TABLE "rooms" ADD COLUMN "eventRefId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "rooms_eventRefId_key" ON "rooms"("eventRefId");

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_eventRefId_fkey" FOREIGN KEY ("eventRefId") REFERENCES "schedule_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
