ALTER TABLE "OrganizationProgram"
ADD COLUMN "isWinner" BOOLEAN NOT NULL DEFAULT false;

UPDATE "OrganizationProgram"
SET "isWinner" = true
WHERE lower(
  COALESCE(
    "metrics"->>'Current_Year_Winner',
    "metrics"->>'currentYearWinner',
    "metrics"->>'winner',
    ''
  )
) IN ('yes', 'true', '1');
