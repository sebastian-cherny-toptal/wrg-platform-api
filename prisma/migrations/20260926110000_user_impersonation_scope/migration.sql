CREATE TYPE "ImpersonationScope" AS ENUM ('PROGRAM', 'USER');

ALTER TABLE "ImpersonationGrant"
ADD COLUMN "scope" "ImpersonationScope" NOT NULL DEFAULT 'PROGRAM',
ALTER COLUMN "programId" DROP NOT NULL;
