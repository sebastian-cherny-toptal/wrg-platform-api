import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPaidRdPaymentType,
  kiaZohoEntitlementData,
} from "../../src/modules/reports/kia-zoho-entitlement.js";

describe("Zoho RD payment KIA entitlement", () => {
  for (const value of [
    "Paid via Credit Card",
    "Paid via ACH",
    "Paid via Check",
  ]) {
    it(`grants KIA access for ${value}`, () => {
      const result = kiaZohoEntitlementData(value, {
        reportAccess: { KIA_Access: "no", WFR_Access: "yes" },
        metrics: { Existing: "preserved" },
      });

      assert.equal(isPaidRdPaymentType(value), true);
      assert.equal(result.rdPaymentType, value);
      assert.deepEqual(result.reportAccess, {
        KIA_Access: "yes",
        WFR_Access: "yes",
      });
      assert.deepEqual(result.metrics, {
        Existing: "preserved",
        KIA_Order_Status: "Processing",
      });
    });
  }

  it("stores unpaid values without revoking access or overwriting delivery", () => {
    const result = kiaZohoEntitlementData("Invoice Sent", {
      reportAccess: { KIA_Access: "yes" },
      metrics: { KIA_Order_Status: "Delivered" },
    });

    assert.equal(result.rdPaymentType, "Invoice Sent");
    assert.deepEqual(result.reportAccess, { KIA_Access: "yes" });
    assert.deepEqual(result.metrics, { KIA_Order_Status: "Delivered" });
  });
});
