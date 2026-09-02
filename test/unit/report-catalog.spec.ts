import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  effectiveReportCatalog,
  hasStandardPackage,
  parseReportCatalog,
  reportProductTemplates,
  standardPackagePriceCents,
} from "../../src/modules/reports/report-catalog.js";

describe("report catalog configuration", () => {
  it("accepts the supported storefront products", () => {
    assert.deepEqual(
      parseReportCatalog(reportProductTemplates),
      reportProductTemplates,
    );
  });

  it("rejects unknown products and invalid prices", () => {
    assert.throws(() =>
      parseReportCatalog([{ ...reportProductTemplates[0], id: "unknown" }]),
    );
    assert.throws(() =>
      parseReportCatalog([{ ...reportProductTemplates[0], priceCents: -1 }]),
    );
  });

  it("ignores malformed legacy prices", () => {
    const template = reportProductTemplates[0];
    assert.ok(template);
    const catalog = effectiveReportCatalog([
      { id: template.id, priceCents: "42500" },
    ]);
    assert.equal(catalog[0]?.priceCents, template.priceCents);
  });

  it("keeps new storefront products available for older saved catalogs", () => {
    const effective = effectiveReportCatalog([reportProductTemplates[1]]);
    assert.deepEqual(
      effective.map(({ id }) => id),
      reportProductTemplates.map(({ id }) => id),
    );
  });

  it("resolves all six standard-package pricing tiers", () => {
    const categoryPricing = [
      ["Boutique", 108_000],
      ["Small", 111_000],
      ["Medium", 122_500],
      ["Large", 128_500],
      ["Mega", 136_500],
      ["Major", 141_500],
    ].map(([tier, priceCents]) => ({ tier, priceCents }));
    const expected = [108_000, 111_000, 122_500, 128_500, 136_500, 141_500];
    const sizes = [15, 25, 100, 200, 500, 1_000];
    assert.deepEqual(
      sizes.map((Company_Size) =>
        standardPackagePriceCents({ categoryPricing }, { Company_Size }),
      ),
      expected,
    );
  });

  it("resolves a standard-package price from a program-specific Zoho category name", () => {
    const categoryPricing = [
      {
        tier: "Small",
        zohoCategoryName: "Small/Medium",
        employeeSize: "25-99",
        priceCents: 111_000,
      },
    ];

    assert.equal(
      standardPackagePriceCents(
        { categoryPricing },
        { currentZohoCategory: " small/medium " },
      ),
      111_000,
    );
  });

  it("uses program-specific employee ranges when the Zoho category is absent", () => {
    const categoryPricing = [
      {
        tier: "Small",
        zohoCategoryName: "Small",
        employeeSize: "25-49",
        priceCents: 55_000,
      },
      {
        tier: "Medium",
        zohoCategoryName: "Small/Medium",
        employeeSize: "50-99",
        priceCents: 65_000,
      },
    ];

    assert.equal(
      standardPackagePriceCents({ categoryPricing }, { Company_Size: 70 }),
      65_000,
    );
  });

  it("only treats the standard package as owned after all included reports are available", () => {
    assert.equal(hasStandardPackage({ WFR_Access: "yes" }), false);
    assert.equal(
      hasStandardPackage({
        WFR_Access: "yes",
        WBC_Access: "yes",
        BBP_Access: "yes",
      }),
      true,
    );
    assert.equal(hasStandardPackage({}, "Full Package"), true);
  });
});
