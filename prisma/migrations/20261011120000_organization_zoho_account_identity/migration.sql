ALTER TABLE "Organization" ADD COLUMN "zohoAccountId" TEXT;
CREATE UNIQUE INDEX "Organization_zohoAccountId_key" ON "Organization"("zohoAccountId");
