import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPaidReportPaymentType,
  reportZohoEntitlementData,
} from "../../src/modules/reports/kia-zoho-entitlement.js";

describe("Zoho report payment entitlements", () => {
  for (const value of [
    "Paid via Credit Card",
    "Paid via ACH",
    "Paid via Check",
  ]) {
    it(`grants Response Detail access, not KIA access, for RD ${value}`, () => {
      const result = reportZohoEntitlementData(value, null, {
        reportAccess: { KIA_Access: "no", WFR_Access: "yes" },
        metrics: { Existing: "preserved" },
      });

      assert.equal(isPaidReportPaymentType(value), true);
      assert.equal(result.rdPaymentType, value);
      assert.equal(result.kiaPaymentType, null);
      assert.deepEqual(result.reportAccess, {
        KIA_Access: "no",
        RD_Access: "yes",
        WFR_Access: "yes",
      });
      assert.deepEqual(result.metrics, { Existing: "preserved" });
    });
  }

  it("grants KIA access and processing status only from the KIA payment type", () => {
    const result = reportZohoEntitlementData(null, "Paid via ACH", {
      reportAccess: { KIA_Access: "no", RD_Access: "no" },
      metrics: { Existing: "preserved" },
    });

    assert.equal(result.rdPaymentType, null);
    assert.equal(result.kiaPaymentType, "Paid via ACH");
    assert.deepEqual(result.reportAccess, {
      KIA_Access: "yes",
      RD_Access: "no",
    });
    assert.deepEqual(result.metrics, {
      Existing: "preserved",
      KIA_Order_Status: "Processing",
    });
  });

  it("stores unpaid values without revoking access or overwriting delivery", () => {
    const result = reportZohoEntitlementData("Invoice Sent", "Invoice Sent", {
      reportAccess: { KIA_Access: "yes", RD_Access: "yes" },
      metrics: { KIA_Order_Status: "Delivered" },
    });

    assert.equal(result.rdPaymentType, "Invoice Sent");
    assert.equal(result.kiaPaymentType, "Invoice Sent");
    assert.deepEqual(result.reportAccess, {
      KIA_Access: "yes",
      RD_Access: "yes",
    });
    assert.deepEqual(result.metrics, { KIA_Order_Status: "Delivered" });
  });
});
