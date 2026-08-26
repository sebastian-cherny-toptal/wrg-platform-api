import { BadRequestException } from "@nestjs/common";

export type ReportPurchaseMode = "checkout" | "contact";
export type ReportFulfillment = "instant" | "manual";

export interface ReportCatalogProduct {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  available: boolean;
  purchaseMode: ReportPurchaseMode;
  fulfillment: ReportFulfillment;
  requiresStandardPackage: boolean;
}

export const STANDARD_PACKAGE_ID = "report-standard-package";
export const SORTED_VERBATIMS_ID = "report-verbatims-sorted";
export const KEY_IMPACT_ID = "report-kia";
export const RESPONSE_DETAIL_ID = "report-response-detail";

export const standardReportAccessKeys = [
  "WFR_Access",
  "EV_Access",
  "WBC_Access",
  "BBP_Access",
] as const;

export const reportProductTemplates: ReportCatalogProduct[] = [
  {
    id: STANDARD_PACKAGE_ID,
    name: "The Feedback Data Dashboard",
    description:
      "Your employee feedback in one place, including WRG's standard report package, online dashboard, and review call.",
    priceCents: 0,
    available: true,
    purchaseMode: "checkout",
    fulfillment: "instant",
    requiresStandardPackage: false,
  },
  {
    id: SORTED_VERBATIMS_ID,
    name: "Sorted Employee Verbatims",
    description: "Sort open-ended responses by your choice of demographic.",
    priceCents: 42_500,
    available: true,
    purchaseMode: "checkout",
    fulfillment: "instant",
    requiresStandardPackage: true,
  },
  {
    id: KEY_IMPACT_ID,
    name: "Key Impact Analysis",
    description:
      "Identifies the workplace factors with the greatest impact on employee engagement. A minimum of 100 employee responses is required.",
    priceCents: 82_000,
    available: true,
    purchaseMode: "checkout",
    fulfillment: "manual",
    requiresStandardPackage: true,
  },
  {
    id: RESPONSE_DETAIL_ID,
    name: "Response Detail Report",
    description:
      "A breakdown of employee responses across the 6-point agree/disagree scale. A minimum of 50 employee responses is required.",
    priceCents: 42_500,
    available: true,
    purchaseMode: "checkout",
    fulfillment: "instant",
    requiresStandardPackage: true,
  },
  {
    id: "report-resort",
    name: "Re-Sorted Workforce Feedback",
    description: "A WRG-prepared re-sort of existing workforce feedback data.",
    priceCents: 0,
    available: true,
    purchaseMode: "contact",
    fulfillment: "manual",
    requiresStandardPackage: true,
  },
  {
    id: "report-custom",
    name: "Custom Reports",
    description: "Tailored advanced reporting prepared with a WRG specialist.",
    priceCents: 0,
    available: true,
    purchaseMode: "contact",
    fulfillment: "manual",
    requiresStandardPackage: true,
  },
];

const templateById = new Map(
  reportProductTemplates.map((product) => [product.id, product]),
);

export function effectiveReportCatalog(value: unknown): ReportCatalogProduct[] {
  const configured = new Map<string, unknown>();
  const entries: unknown[] = Array.isArray(value) ? value as unknown[] : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const id = (entry as Record<string, unknown>).id;
    if (typeof id === "string") configured.set(id, entry);
  }
  return reportProductTemplates.map((template) => {
    const override = configured.get(template.id);
    return override && typeof override === "object" && !Array.isArray(override)
      ? { ...template, ...(override as Partial<ReportCatalogProduct>), id: template.id }
      : { ...template };
  });
}

export function parseReportCatalog(value: unknown): ReportCatalogProduct[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException("products must be an array");
  }
  const allowed = new Set(reportProductTemplates.map(({ id }) => id));
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new BadRequestException(`products[${index}] must be an object`);
    }
    const product = entry as Record<string, unknown>;
    const id = typeof product.id === "string" ? product.id.trim() : "";
    const name = typeof product.name === "string" ? product.name.trim() : "";
    const description = typeof product.description === "string" ? product.description.trim() : "";
    const priceCents = product.priceCents;
    if (!allowed.has(id)) throw new BadRequestException(`Unsupported report product: ${id || index}`);
    if (seen.has(id)) throw new BadRequestException(`Duplicate report product: ${id}`);
    if (!name || name.length > 120) throw new BadRequestException(`Invalid product name: ${id}`);
    if (!description || description.length > 500) throw new BadRequestException(`Invalid product description: ${id}`);
    if (typeof priceCents !== "number" || !Number.isInteger(priceCents) || priceCents < 0) {
      throw new BadRequestException(`Invalid product price: ${id}`);
    }
    if (typeof product.available !== "boolean") throw new BadRequestException(`Invalid availability: ${id}`);
    const template = templateById.get(id);
    if (!template) throw new BadRequestException(`Unsupported report product: ${id}`);
    seen.add(id);
    return {
      ...template,
      id,
      name,
      description,
      priceCents,
      available: product.available,
    };
  });
}

export function jsonObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numeric(value: unknown): number | null {
  const normalized = String(value ?? "").replace(/[^0-9.-]+/gu, "").trim();
  if (!normalized) return null;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

const pricingFieldByTier: Record<string, string> = {
  boutique: "Category_15_24_Fee",
  small: "Category_25_99_Fee",
  medium: "Category_100_199_Fee",
  large: "Category_200_499_Fee",
  mega: "Category_500_999_Fee",
  major: "Category_1000_Fee",
};

function tierForCompanySize(size: number): string | null {
  if (size < 15) return null;
  if (size <= 24) return "boutique";
  if (size <= 99) return "small";
  if (size <= 199) return "medium";
  if (size <= 499) return "large";
  if (size <= 999) return "mega";
  return "major";
}

export function standardPackagePriceCents(
  programMetadata: unknown,
  enrollmentMetrics: unknown,
): number | null {
  const metadata = jsonObject(programMetadata);
  const metrics = jsonObject(enrollmentMetrics);
  const category = String(metrics.Current_Year_Category ?? "").trim().toLowerCase();
  const companySize = numeric(
    metrics.Company_Size ??
      metrics.Program_EE_Count ??
      metrics.Total_Number_of_Program_EEs ??
      metrics.Surveys_Sent,
  );
  const tier = pricingFieldByTier[category]
    ? category
    : companySize === null
      ? null
      : tierForCompanySize(companySize);
  if (!tier) return null;
  const categoryPricing: unknown = metadata.categoryPricing;
  const configuredTiers: unknown[] = Array.isArray(categoryPricing)
    ? categoryPricing as unknown[]
    : [];
  const configured = configuredTiers.find((entry) => {
    const value = jsonObject(entry);
    return String(value.tier ?? "").trim().toLowerCase() === tier;
  });
  const cents = numeric(jsonObject(configured).priceCents);
  if (cents !== null && Number.isInteger(cents) && cents > 0) return cents;
  const legacyDollars = numeric(metadata[pricingFieldByTier[tier] ?? ""]);
  return legacyDollars !== null && legacyDollars > 0
    ? Math.round(legacyDollars * 100)
    : null;
}

export function hasStandardPackage(reportAccess: unknown, stage?: string | null): boolean {
  if ((stage ?? "").trim().toLowerCase() === "full package") return true;
  const access = jsonObject(reportAccess);
  return standardReportAccessKeys.every(
    (key) => String(access[key] ?? "").trim().toLowerCase() === "yes",
  );
}

export function productIsOwned(productId: string, reportAccess: unknown, stage?: string | null): boolean {
  const access = jsonObject(reportAccess);
  if (productId === STANDARD_PACKAGE_ID) return hasStandardPackage(access, stage);
  if (productId === SORTED_VERBATIMS_ID) return access.SEV_Access === "yes";
  if (productId === RESPONSE_DETAIL_ID) return access.RD_Access === "yes";
  if (productId === KEY_IMPACT_ID) return access.KIA_Access === "yes";
  return false;
}
