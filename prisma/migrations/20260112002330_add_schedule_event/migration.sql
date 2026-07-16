-- CreateTable
CREATE TABLE "schedule_events" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "roomId" TEXT,
    "createdById" TEXT NOT NULL,
    "provider" TEXT,
    "externalId" TEXT,

    CONSTRAINT "schedule_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "schedule_events_companyId_startAt_idx" ON "schedule_events"("companyId", "startAt");

-- AddForeignKey
ALTER TABLE "schedule_events" ADD CONSTRAINT "schedule_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_events" ADD CONSTRAINT "schedule_events_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_events" ADD CONSTRAINT "schedule_events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
