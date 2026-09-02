export const programZohoCategoryTiers = [
  "Boutique",
  "Small",
  "Medium",
  "Large",
  "Mega",
  "Major",
] as const;

export type ProgramZohoCategoryTier = (typeof programZohoCategoryTiers)[number];

export const benchmarkCategories = [
  "Small",
  "Medium",
  "Large",
  "Major",
  "Super",
] as const;

export type BenchmarkCategory = (typeof benchmarkCategories)[number];

export function normalizeBenchmarkCategory(
  value: unknown,
): BenchmarkCategory | null {
  const normalized = normalizeZohoCategoryName(value);
  return (
    benchmarkCategories.find(
      (category) => normalizeZohoCategoryName(category) === normalized,
    ) ?? null
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
