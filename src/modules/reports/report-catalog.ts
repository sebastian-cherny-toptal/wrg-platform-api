import { BadRequestException } from "@nestjs/common";

export interface ReportCatalogProduct {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  available: boolean;
}

export const reportProductTemplates: ReportCatalogProduct[] = [
  {
    id: "report-verbatims-sorted",
    name: "Sorted Employee Verbatims",
    description: "Employee comments organized using a selected demographic filter.",
    priceCents: 50000,
    available: true,
  },
  {
    id: "report-kia",
    name: "Key Impact Analysis",
    description: "Analysis identifying the factors with the greatest impact on engagement.",
    priceCents: 50000,
    available: true,
  },
  {
    id: "report-resort",
    name: "Custom Report Re-sort",
    description: "A customized report configuration prepared by a WRG survey professional.",
    priceCents: 0,
    available: true,
  },
];

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
    seen.add(id);
    return { id, name, description, priceCents, available: product.available };
  });
}

export function jsonObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
