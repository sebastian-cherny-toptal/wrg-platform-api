-- CreateTable
CREATE TABLE "ImpersonationGrant" (
    "id" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "targetUserId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "programId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpersonationGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImpersonationGrant_actorUserId_createdAt_idx" ON "ImpersonationGrant"("actorUserId", "createdAt");
CREATE INDEX "ImpersonationGrant_targetUserId_expiresAt_idx" ON "ImpersonationGrant"("targetUserId", "expiresAt");
CREATE INDEX "ImpersonationGrant_organizationId_programId_idx" ON "ImpersonationGrant"("organizationId", "programId");

ALTER TABLE "ImpersonationGrant" ADD CONSTRAINT "ImpersonationGrant_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImpersonationGrant" ADD CONSTRAINT "ImpersonationGrant_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImpersonationGrant" ADD CONSTRAINT "ImpersonationGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImpersonationGrant" ADD CONSTRAINT "ImpersonationGrant_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
