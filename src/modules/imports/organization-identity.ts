import { BadRequestException, ConflictException } from "@nestjs/common";

export interface CanonicalOrganization {
  id: string;
  name: string;
  zohoAccountId?: string | null;
}

/** Company names and workbook IDs are suggestions, never cross-program identity. */
export function resolveCanonicalOrganization<T extends CanonicalOrganization>(
  organizations: T[],
  selection: string | undefined,
  verifiedAccountId: string | undefined,
  existingOrganizationId?: string,
): T | undefined {
  const linked = verifiedAccountId
    ? organizations.find(
        (organization) => organization.zohoAccountId === verifiedAccountId,
      )
    : undefined;
  const selectedId =
    existingOrganizationId ?? (selection === "new" ? undefined : selection);
  const selected = selectedId
    ? organizations.find(({ id }) => id === selectedId)
    : undefined;
  if (selectedId && !selected)
    throw new BadRequestException("Selected organization no longer exists");
  if (
    existingOrganizationId &&
    selection &&
    selection !== existingOrganizationId
  ) {
    throw new ConflictException(
      "Reimports must retain the existing organization",
    );
  }
  if (
    linked &&
    ((selected && selected.id !== linked.id) || selection === "new")
  ) {
    throw new ConflictException(
      "CRM account is already linked to another organization; select that organization",
    );
  }
  if (
    selected?.zohoAccountId &&
    verifiedAccountId &&
    selected.zohoAccountId !== verifiedAccountId
  ) {
    throw new ConflictException(
      "Selected organization belongs to a different CRM account",
    );
  }
  return selected ?? linked;
}
