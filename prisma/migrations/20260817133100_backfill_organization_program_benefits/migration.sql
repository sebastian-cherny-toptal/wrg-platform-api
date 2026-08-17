UPDATE "OrganizationProgram" AS enrollment
SET "metadata" = jsonb_set(
  enrollment."metadata",
  '{publishedReports}',
  COALESCE(enrollment."metadata" -> 'publishedReports', '{}') ||
    jsonb_build_object(
      'benefitsBestPractices',
      program."metadata" #> '{publishedReports,benefitsBestPractices}'
    ),
  true
)
FROM "Program" AS program
WHERE enrollment."programId" = program."id"
  AND program."metadata" #> '{publishedReports,benefitsBestPractices}' IS NOT NULL;

UPDATE "Program"
SET "metadata" = "metadata" #- '{publishedReports,benefitsBestPractices}'
WHERE "metadata" #> '{publishedReports,benefitsBestPractices}' IS NOT NULL;
