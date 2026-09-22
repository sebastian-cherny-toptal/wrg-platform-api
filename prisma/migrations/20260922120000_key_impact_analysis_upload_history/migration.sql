CREATE TABLE "KeyImpactAnalysisUpload" (
    "id" UUID NOT NULL,
    "organizationProgramId" UUID NOT NULL,
    "sourceFileName" TEXT,
    "rows" JSONB NOT NULL,
    "uploadedByUsername" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KeyImpactAnalysisUpload_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KeyImpactAnalysisUpload_organizationProgramId_uploadedAt_idx"
ON "KeyImpactAnalysisUpload"("organizationProgramId", "uploadedAt");

ALTER TABLE "KeyImpactAnalysisUpload"
ADD CONSTRAINT "KeyImpactAnalysisUpload_organizationProgramId_fkey"
FOREIGN KEY ("organizationProgramId") REFERENCES "OrganizationProgram"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- The current report rows are the only surviving copy of uploads predating this
-- migration. Preserve them as one downloadable historical report per enrollment.
INSERT INTO "KeyImpactAnalysisUpload" (
  "id", "organizationProgramId", "sourceFileName", "rows", "uploadedAt"
)
SELECT
  md5("organizationProgramId"::text || ':kia-history')::uuid,
  "organizationProgramId",
  (array_agg("source_file_name" ORDER BY "position"))[1],
  jsonb_agg(jsonb_build_object('label', "label", 'key', "key", 'value', "value") ORDER BY "position"),
  min("createdAt")
FROM "KeyImpactAnalysisRow"
GROUP BY "organizationProgramId";
