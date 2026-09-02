ALTER TABLE "OrganizationProgram"
ADD COLUMN "current_zoho_category" TEXT,
ADD COLUMN "benchmark_category" TEXT;

UPDATE "OrganizationProgram"
SET "current_zoho_category" = NULLIF("metrics"->>'Current_Year_Category', ''),
    "benchmark_category" = CASE LOWER(NULLIF("metrics"->>'Current_Year_Category', ''))
      WHEN 'small' THEN 'Small'
      WHEN 'medium' THEN 'Medium'
      WHEN 'large' THEN 'Large'
      WHEN 'major' THEN 'Major'
      WHEN 'super' THEN 'Super'
      ELSE NULL
    END;

CREATE TABLE "ProgramZohoCategory" (
    "id" UUID NOT NULL,
    "programId" UUID NOT NULL,
    "tier" TEXT NOT NULL,
    "zoho_category_name" TEXT NOT NULL,
    "employee_size" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramZohoCategory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProgramZohoCategory_price_cents_check" CHECK ("price_cents" >= 0)
);

CREATE UNIQUE INDEX "ProgramZohoCategory_programId_tier_key"
ON "ProgramZohoCategory"("programId", "tier");

CREATE INDEX "ProgramZohoCategory_programId_sort_order_idx"
ON "ProgramZohoCategory"("programId", "sort_order");

ALTER TABLE "ProgramZohoCategory"
ADD CONSTRAINT "ProgramZohoCategory_programId_fkey"
FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ProgramZohoCategory" (
  "id",
  "programId",
  "tier",
  "zoho_category_name",
  "employee_size",
  "price_cents",
  "sort_order",
  "updatedAt"
)
SELECT
  md5(program."id"::text || ':' || (category->>'tier'))::uuid,
  program."id",
  category->>'tier',
  COALESCE(NULLIF(category->>'zohoCategoryName', ''), category->>'tier'),
  category->>'employeeSize',
  (category->>'priceCents')::INTEGER,
  CASE category->>'tier'
    WHEN 'Boutique' THEN 0
    WHEN 'Small' THEN 1
    WHEN 'Medium' THEN 2
    WHEN 'Large' THEN 3
    WHEN 'Mega' THEN 4
    WHEN 'Major' THEN 5
  END,
  CURRENT_TIMESTAMP
FROM "Program" AS program
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(program."metadata"->'categoryPricing') = 'array'
      THEN program."metadata"->'categoryPricing'
    ELSE '[]'::jsonb
  END
) AS category
WHERE category->>'tier' IN ('Boutique', 'Small', 'Medium', 'Large', 'Mega', 'Major')
  AND NULLIF(category->>'employeeSize', '') IS NOT NULL
  AND (category->>'priceCents') ~ '^[0-9]+$'
ON CONFLICT ("programId", "tier") DO NOTHING;
