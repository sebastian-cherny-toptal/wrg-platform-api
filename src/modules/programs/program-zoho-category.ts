export const programZohoCategoryTiers = [
  "Boutique",
  "Small",
  "Medium",
  "Large",
  "Mega",
  "Major",
] as const;

export type ProgramZohoCategoryTier = (typeof programZohoCategoryTiers)[number];

export const pricingCategoryNameByTier: Record<
  ProgramZohoCategoryTier,
  string
> = {
  Boutique: "15-24",
  Small: "25-99",
  Medium: "100-199",
  Large: "200-499",
  Mega: "500-999",
  Major: "1000+",
};

export const defaultZohoCategoryOrder = [
  "Small",
  "Medium",
  "Large",
  "Major",
  "Super",
] as const;

export function normalizeZohoCategory(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = normalizeZohoCategoryName(value);
  return (
    defaultZohoCategoryOrder.find(
      (category) => normalizeZohoCategoryName(category) === normalized,
    ) ?? trimmed
  );
}

export function normalizeZohoCategoryName(value: unknown): string {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("en") : "";
}

export function employeeSizeRange(
  value: unknown,
): { minimum: number; maximum: number } | null {
  if (typeof value !== "string") return null;
  const normalized = value.replaceAll(",", "").trim();
  const bounded = /^(\d+)\s*[-–—]\s*(\d+)$/u.exec(normalized);
  if (bounded) {
    return { minimum: Number(bounded[1]), maximum: Number(bounded[2]) };
  }
  const openEnded = /^(\d+)\s*\+$/u.exec(normalized);
  return openEnded
    ? { minimum: Number(openEnded[1]), maximum: Number.POSITIVE_INFINITY }
    : null;
}

/** Missing Category List names mean a single benchmark group for the program. */
export function benchmarkCategoryNames(value: unknown): string[] {
  const names = Array.isArray(value)
    ? [
        ...new Set(
          value.flatMap((entry) => {
            const name = typeof entry === "string" ? entry.trim() : "";
            return name ? [name] : [];
          }),
        ),
      ]
    : [];
  return names.length ? names : ["Default"];
}

export function usesDefaultBenchmarkCategory(value: unknown): boolean {
  const names = benchmarkCategoryNames(value);
  return names.length === 1 && names[0] === "Default";
}
