-- CreateEnum
CREATE TYPE "RepoImportStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "RepoImport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "repoUrl" TEXT NOT NULL,
    "repoOwner" TEXT NOT NULL,
    "repoName" TEXT NOT NULL,
    "repoBranch" TEXT,
    "source" TEXT NOT NULL DEFAULT 'url',
    "status" "RepoImportStatus" NOT NULL DEFAULT 'PENDING',
    "nodeCount" INTEGER,
    "edgeCount" INTEGER,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepoImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RepoImport_runId_key" ON "RepoImport"("runId");

-- CreateIndex
CREATE INDEX "RepoImport_projectId_createdAt_idx" ON "RepoImport"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "RepoImport_userId_idx" ON "RepoImport"("userId");

-- CreateIndex
CREATE INDEX "RepoImport_runId_idx" ON "RepoImport"("runId");
