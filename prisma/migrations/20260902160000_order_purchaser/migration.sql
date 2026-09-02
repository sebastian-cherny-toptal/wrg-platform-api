ALTER TABLE "Order"
ADD COLUMN "purchaserUserId" UUID;

CREATE INDEX "Order_purchaserUserId_idx" ON "Order"("purchaserUserId");

ALTER TABLE "Order"
ADD CONSTRAINT "Order_purchaserUserId_fkey"
FOREIGN KEY ("purchaserUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
