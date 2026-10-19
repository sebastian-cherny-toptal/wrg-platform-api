CREATE TABLE "ServerStat" (
    "id" UUID NOT NULL,
    "capturedAt" TIMESTAMPTZ(3) NOT NULL,
    "instanceId" VARCHAR(255) NOT NULL,
    "processStartId" UUID NOT NULL,
    "processStartedAt" TIMESTAMPTZ(3) NOT NULL,
    "uptimeSeconds" INTEGER NOT NULL,
    "heapUsedMb" DOUBLE PRECISION NOT NULL,
    "heapTotalMb" DOUBLE PRECISION NOT NULL,
    "heapLimitMb" DOUBLE PRECISION NOT NULL,
    "heapUsedPercent" DOUBLE PRECISION NOT NULL,
    "rssMb" DOUBLE PRECISION NOT NULL,
    "externalMb" DOUBLE PRECISION NOT NULL,
    "arrayBuffersMb" DOUBLE PRECISION NOT NULL,
    "activeRequests" INTEGER NOT NULL,
    "gcCount" INTEGER NOT NULL,
    "gcDurationMs" DOUBLE PRECISION NOT NULL,
    "gcLongestPauseMs" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "ServerStat_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ServerStat_capturedAt_idx" ON "ServerStat"("capturedAt");
CREATE INDEX "ServerStat_instanceId_capturedAt_idx" ON "ServerStat"("instanceId", "capturedAt");
CREATE INDEX "ServerStat_processStartId_capturedAt_idx" ON "ServerStat"("processStartId", "capturedAt");
