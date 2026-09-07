ALTER TABLE "Program"
ADD COLUMN "latest_zoho_sync" TIMESTAMP(3);

UPDATE "Program"
SET "latest_zoho_sync" = "createdAt"
WHERE "latest_zoho_sync" IS NULL;

ALTER TABLE "Program"
ALTER COLUMN "latest_zoho_sync" SET NOT NULL,
ALTER COLUMN "latest_zoho_sync" SET DEFAULT CURRENT_TIMESTAMP;
