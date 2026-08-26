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
    assert.deepEqual(parseReportCatalog(reportProductTemplates), reportProductTemplates);
  });

  it("rejects unknown products and invalid prices", () => {
    assert.throws(() => parseReportCatalog([{ ...reportProductTemplates[0], id: "unknown" }]));
    assert.throws(() => parseReportCatalog([{ ...reportProductTemplates[0], priceCents: -1 }]));
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

  it("only treats the standard package as owned after all included reports are available", () => {
    assert.equal(hasStandardPackage({ WFR_Access: "yes" }), false);
    assert.equal(
      hasStandardPackage({
        WFR_Access: "yes",
        EV_Access: "yes",
        WBC_Access: "yes",
        BBP_Access: "yes",
      }),
      true,
    );
    assert.equal(hasStandardPackage({}, "Full Package"), true);
  });
});
