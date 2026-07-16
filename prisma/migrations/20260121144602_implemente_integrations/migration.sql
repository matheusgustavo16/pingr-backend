-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('GITHUB', 'VERCEL', 'GOOGLE', 'SLACK', 'NOTION', 'FIGMA', 'CUSTOM');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('ACTIVE', 'DISABLED', 'ERROR', 'REVOKED');

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "connectedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "config" JSONB NOT NULL DEFAULT '{}',
    "credentials" JSONB,
    "externalId" TEXT,
    "externalUrl" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integrations_provider_externalId_userId_key" ON "integrations"("provider", "externalId", "userId");

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
