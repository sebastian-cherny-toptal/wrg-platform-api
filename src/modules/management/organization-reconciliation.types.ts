import type { Principal } from "../auth/auth.module.js";

export interface OrganizationAccountConflict {
  id: string;
  organizationProgramId: string;
  sourceOrganizationId: string;
  sourceOrganizationName: string;
  savedZohoAccountId: string | null;
  sourceId: string;
  zohoOrganizationName: string | null;
  zohoAccountId: string;
  matchedBy: "account" | "sourceId" | "name";
  targetOrganizationId: string | null;
  targetOrganizationName: string | null;
  reasons: string[];
  blockingReason?: string;
}

export interface OrganizationConflictSource {
  mappingConflicts(
    principal: Principal,
    programReference: string,
  ): Promise<{
    programId: string;
    conflicts: OrganizationAccountConflict[];
  }>;
}
