CREATE TABLE "CustomReportUpload" (
    "id" UUID NOT NULL,
    "organizationProgramId" UUID NOT NULL,
    "reportName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contents" BYTEA NOT NULL,
    "uploadedByUsername" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomReportUpload_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomReportUpload_organizationProgramId_uploadedAt_idx"
ON "CustomReportUpload"("organizationProgramId", "uploadedAt");

ALTER TABLE "CustomReportUpload"
ADD CONSTRAINT "CustomReportUpload_organizationProgramId_fkey"
FOREIGN KEY ("organizationProgramId") REFERENCES "OrganizationProgram"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
