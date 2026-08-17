import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseReportCatalog, reportProductTemplates } from "../../src/modules/reports/report-catalog.js";

describe("report catalog configuration", () => {
  it("accepts the supported storefront products", () => {
    assert.deepEqual(parseReportCatalog(reportProductTemplates), reportProductTemplates);
  });

  it("rejects unknown products and invalid prices", () => {
    assert.throws(() => parseReportCatalog([{ ...reportProductTemplates[0], id: "unknown" }]));
    assert.throws(() => parseReportCatalog([{ ...reportProductTemplates[0], priceCents: -1 }]));
  });
});
