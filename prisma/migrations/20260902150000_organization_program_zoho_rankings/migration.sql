ALTER TABLE "OrganizationProgram"
ADD COLUMN "employees_count" INTEGER,
ADD COLUMN "overall_rank" TEXT,
ADD COLUMN "category_rank" TEXT;

UPDATE "OrganizationProgram"
SET "employees_count" = CASE
  WHEN ("metrics"->>'Total_Number_of_Program_EEs') ~ '^[0-9]+$'
    THEN ("metrics"->>'Total_Number_of_Program_EEs')::INTEGER
  WHEN ("metrics"->>'Company_Size') ~ '^[0-9]+$'
    THEN ("metrics"->>'Company_Size')::INTEGER
  ELSE NULL
END,
"overall_rank" = NULLIF("metrics"->>'Current_Year_Overall_Rank', ''),
"category_rank" = NULLIF("metrics"->>'Current_Year_Category_Rank', '');
