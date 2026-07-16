-- DropForeignKey
ALTER TABLE "chat_messages" DROP CONSTRAINT "chat_messages_authorId_fkey";

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "botId" TEXT,
ALTER COLUMN "authorId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "chat_bots" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'pingr',
    "picture" TEXT,
    "companyId" TEXT,

    CONSTRAINT "chat_bots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_messages_botId_idx" ON "chat_messages"("botId");

-- AddForeignKey
ALTER TABLE "chat_bots" ADD CONSTRAINT "chat_bots_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_botId_fkey" FOREIGN KEY ("botId") REFERENCES "chat_bots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
