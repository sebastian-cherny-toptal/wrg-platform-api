CREATE TABLE "KeyImpactAnalysisRow" (
    "id" UUID NOT NULL,
    "organizationProgramId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source_file_name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeyImpactAnalysisRow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KeyImpactAnalysisRow_organizationProgramId_position_key"
ON "KeyImpactAnalysisRow"("organizationProgramId", "position");

CREATE INDEX "KeyImpactAnalysisRow_organizationProgramId_idx"
ON "KeyImpactAnalysisRow"("organizationProgramId");

ALTER TABLE "KeyImpactAnalysisRow"
ADD CONSTRAINT "KeyImpactAnalysisRow_organizationProgramId_fkey"
FOREIGN KEY ("organizationProgramId") REFERENCES "OrganizationProgram"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

WITH legacy_rows AS (
  SELECT DISTINCT ON (
    organization_program."id",
    report_row.ordinality
  )
    md5(asset."id"::text || ':' || report_row.ordinality::text)::uuid AS "id",
    organization_program."id" AS "organizationProgramId",
    report_row.ordinality::integer AS "position",
    COALESCE(report_row.value->>'label', '') AS "label",
    COALESCE(report_row.value->>'key', '') AS "key",
    COALESCE(report_row.value->>'value', '') AS "value",
    asset."metadata"->>'fileName' AS "source_file_name",
    asset."createdAt" AS "createdAt",
    asset."createdAt" AS "updatedAt"
  FROM "Asset" AS asset
  JOIN "OrganizationProgram" AS organization_program
    ON organization_program."id"::text = asset."metadata"->>'organizationProgramId'
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(asset."metadata"->'report') = 'array'
        THEN asset."metadata"->'report'
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS report_row(value, ordinality)
  WHERE asset."metadata"->>'kind' = 'keyImpactAnalysis'
  ORDER BY
    organization_program."id",
    report_row.ordinality,
    asset."createdAt" DESC
)
INSERT INTO "KeyImpactAnalysisRow" (
  "id",
  "organizationProgramId",
  "position",
  "label",
  "key",
  "value",
  "source_file_name",
  "createdAt",
  "updatedAt"
)
SELECT
  "id",
  "organizationProgramId",
  "position",
  "label",
  "key",
  "value",
  "source_file_name",
  "createdAt",
  "updatedAt"
FROM legacy_rows
ON CONFLICT ("organizationProgramId", "position") DO NOTHING;

DELETE FROM "Asset"
WHERE "metadata"->>'kind' = 'keyImpactAnalysis';
