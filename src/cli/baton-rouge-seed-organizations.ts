export const defaultSeedOrganizationCount = 10;
export const targetOrganizationName = "Commerce Title & Abstract Company";
const sanitizedTargetOrganizationName = "Synthetic 06f796de0c9331b9";

export function seedOrganizationCount(value: string | undefined): number {
  if (value === undefined || !/^\s*\d+\s*$/u.test(value)) {
    return defaultSeedOrganizationCount;
  }
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0
    ? count
    : defaultSeedOrganizationCount;
}

export function canonicalSeedOrganizationName(
  sourceName: string | undefined,
): string | undefined {
  const name = sourceName?.trim();
  if (!name) return undefined;
  return name === targetOrganizationName ||
    name === sanitizedTargetOrganizationName
    ? targetOrganizationName
    : name;
}

export function selectSeedOrganizations<T>(
  organizations: ReadonlyMap<string, T>,
  targetKey: string,
  count: number,
): Map<string, T> {
  const target = organizations.get(targetKey);
  if (target === undefined) {
    throw new Error(
      `No rows found for required organization "${targetOrganizationName}"`,
    );
  }

  const selected = new Map<string, T>([[targetKey, target]]);
  for (const [key, organization] of organizations) {
    if (selected.size >= count) break;
    if (key !== targetKey) selected.set(key, organization);
  }
  if (selected.size < count) {
    throw new Error(
      `Requested ${count} seed organizations, but only ${selected.size} are available`,
    );
  }
  return selected;
}
