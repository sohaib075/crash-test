-- CreateEnum
CREATE TYPE "Area" AS ENUM ('SELL', 'BOOK', 'BILL', 'HYGIENE');

-- CreateEnum
CREATE TYPE "RunTrigger" AS ENUM ('MANUAL', 'GATE', 'SCHEDULE');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'PLANNING', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "TestStatus" AS ENUM ('QUEUED', 'RUNNING', 'PASS', 'FAIL', 'NEEDS_APPROVAL', 'FIXED', 'ERROR');

-- CreateEnum
CREATE TYPE "FixAction" AS ENUM ('PAUSE_SEQUENCE', 'RESUME_SEQUENCE', 'WITHDRAW_CONTACT', 'ADD_SUPPRESSION', 'REOWN_VIA_LIST', 'CREATE_TASK', 'ADD_DEAL_NOTE', 'CANCEL_TEST_BOOKING');

-- CreateEnum
CREATE TYPE "FixMode" AS ENUM ('AUTOPILOT', 'APPROVE', 'OFF');

-- CreateEnum
CREATE TYPE "FixStatus" AS ENUM ('PROPOSED', 'APPLIED', 'REJECTED', 'UNDONE', 'FAILED');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('EMAIL', 'QUOTE', 'BOOKING', 'CONTACT', 'DEAL', 'SEQUENCE');

-- CreateEnum
CREATE TYPE "GateResult" AS ENUM ('CHECKING', 'BLOCKED', 'RELEASED');

-- CreateEnum
CREATE TYPE "HealthBand" AS ENUM ('HEALTHY', 'AT_RISK', 'BROKEN');

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "graph8Id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discoveredAt" TIMESTAMP(3),
    "summary" JSONB,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "id" TEXT NOT NULL,
    "graph8Id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "raw" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceSnapshot" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "stepHashes" TEXT[],
    "steps" JSONB NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SequenceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area" "Area" NOT NULL,
    "weight" INTEGER NOT NULL,
    "tier" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TestDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixModeSetting" (
    "action" "FixAction" NOT NULL,
    "mode" "FixMode" NOT NULL DEFAULT 'APPROVE',

    CONSTRAINT "FixModeSetting_pkey" PRIMARY KEY ("action")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "trigger" "RunTrigger" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "plan" JSONB,
    "testIds" TEXT[],
    "targetIds" TEXT[],
    "error" TEXT,
    "leadsProtected" INTEGER NOT NULL DEFAULT 0,
    "pipelineAtRisk" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tagListId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "cleanedUp" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunLog" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "area" "Area" NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetName" TEXT NOT NULL,
    "status" "TestStatus" NOT NULL DEFAULT 'QUEUED',
    "summary" TEXT,
    "whyItMatters" TEXT,
    "expected" TEXT NOT NULL,
    "actual" TEXT,
    "error" TEXT,
    "leadsAffected" INTEGER,
    "pipelineAtRisk" DECIMAL(14,2),
    "goalSec" INTEGER,
    "actualSec" INTEGER,
    "retestStatus" "TestStatus",
    "state" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "graph8Id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "excerpt" TEXT,
    "highlight" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "raw" JSONB NOT NULL,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FakeBuyer" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "persona" JSONB NOT NULL,
    "cleanedUp" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FakeBuyer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fix" (
    "id" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "action" "FixAction" NOT NULL,
    "mode" "FixMode" NOT NULL,
    "status" "FixStatus" NOT NULL DEFAULT 'PROPOSED',
    "targetId" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "preview" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "error" TEXT,
    "appliedAt" TIMESTAMP(3),
    "undoneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Writeback" (
    "id" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "graph8Id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Writeback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GateEvent" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "runId" TEXT,
    "changedSteps" INTEGER[],
    "message" TEXT,
    "result" "GateResult" NOT NULL DEFAULT 'CHECKING',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "GateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthScore" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "band" "HealthBand" NOT NULL,
    "reasons" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "testsRun" INTEGER NOT NULL,
    "failures" INTEGER NOT NULL,
    "autoFixed" INTEGER NOT NULL,
    "leadsProtected" INTEGER NOT NULL,
    "pipelineSaved" DECIMAL(14,2) NOT NULL,
    "summary" TEXT NOT NULL,
    "data" JSONB,
    "graph8TaskId" TEXT,
    "shareToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmCache" (
    "hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "output" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCache_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "Heartbeat" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Heartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_graph8Id_key" ON "Workspace"("graph8Id");

-- CreateIndex
CREATE UNIQUE INDEX "Sequence_graph8Id_key" ON "Sequence"("graph8Id");

-- CreateIndex
CREATE INDEX "SequenceSnapshot_sequenceId_takenAt_idx" ON "SequenceSnapshot"("sequenceId", "takenAt");

-- CreateIndex
CREATE INDEX "RunLog_runId_at_idx" ON "RunLog"("runId", "at");

-- CreateIndex
CREATE INDEX "TestResult_runId_status_idx" ON "TestResult"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TestResult_runId_testId_targetId_key" ON "TestResult"("runId", "testId", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "FakeBuyer_contactId_key" ON "FakeBuyer"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "FakeBuyer_email_key" ON "FakeBuyer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Writeback_resultId_kind_key" ON "Writeback"("resultId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "GateEvent_runId_key" ON "GateEvent"("runId");

-- CreateIndex
CREATE INDEX "HealthScore_sequenceId_createdAt_idx" ON "HealthScore"("sequenceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HealthScore_sequenceId_runId_key" ON "HealthScore"("sequenceId", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "Report_shareToken_key" ON "Report"("shareToken");

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceSnapshot" ADD CONSTRAINT "SequenceSnapshot_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunLog" ADD CONSTRAINT "RunLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_testId_fkey" FOREIGN KEY ("testId") REFERENCES "TestDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "TestResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FakeBuyer" ADD CONSTRAINT "FakeBuyer_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fix" ADD CONSTRAINT "Fix_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "TestResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Writeback" ADD CONSTRAINT "Writeback_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "TestResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateEvent" ADD CONSTRAINT "GateEvent_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateEvent" ADD CONSTRAINT "GateEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthScore" ADD CONSTRAINT "HealthScore_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthScore" ADD CONSTRAINT "HealthScore_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
