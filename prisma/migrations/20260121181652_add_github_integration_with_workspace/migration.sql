-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "githubRepoFullName" TEXT,
ADD COLUMN     "githubRepoId" INTEGER,
ADD COLUMN     "githubRepoName" TEXT,
ADD COLUMN     "githubRepoUrl" TEXT,
ADD COLUMN     "githubWebhookId" INTEGER;
