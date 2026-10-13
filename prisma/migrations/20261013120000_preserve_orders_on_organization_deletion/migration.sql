ALTER TABLE "Order" ALTER COLUMN "organizationId" DROP NOT NULL;
ALTER TABLE "Order" DROP CONSTRAINT "Order_organizationId_fkey";
ALTER TABLE "Order" ADD CONSTRAINT "Order_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
