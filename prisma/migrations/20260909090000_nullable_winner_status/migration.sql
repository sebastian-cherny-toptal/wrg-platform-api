CREATE TYPE "WinnerStatus" AS ENUM ('Y', 'N');

ALTER TABLE "OrganizationProgram"
ALTER COLUMN "isWinner" DROP DEFAULT,
ALTER COLUMN "isWinner" DROP NOT NULL,
ALTER COLUMN "isWinner" TYPE "WinnerStatus"
USING (
  CASE
    WHEN "isWinner" = true THEN 'Y'::"WinnerStatus"
    ELSE 'N'::"WinnerStatus"
  END
);
