import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeZohoReportCategory } from "../../src/modules/crm-sync/compatibility-zoho.module.js";

describe("Zoho report category conversion", () => {
  it("normalizes Category_Online display labels to report ranges", () => {
    assert.equal(
      normalizeZohoReportCategory("Category 100 – 199"),
      "100-199",
    );
    assert.equal(
      normalizeZohoReportCategory("Category 200 – 499"),
      "200-499",
    );
    assert.equal(normalizeZohoReportCategory("Category 25 – 99"), "25-99");
    assert.equal(normalizeZohoReportCategory(null), null);
  });
});
