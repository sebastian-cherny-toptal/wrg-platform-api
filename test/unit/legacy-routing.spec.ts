import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findLegacyRoute, LEGACY_ROUTES } from "../../src/modules/legacy-endpoints/legacy-routes.js";

describe("native legacy route registry", () => {
  it("contains the complete compatibility surface", () => {
    assert.ok(LEGACY_ROUTES.length >= 100);
    assert.ok(findLegacyRoute("POST", "/user/login"));
    assert.ok(findLegacyRoute("GET", "/client/employeeComparisonReport"));
    assert.ok(findLegacyRoute("POST", "/webhook/dealsWebhook"));
    assert.ok(findLegacyRoute("POST", "/payment/checkout"));
    assert.ok(findLegacyRoute("GET", "/admin/getprojects/123"));
  });

  it("keeps route methods and parameterized paths distinct", () => {
    assert.equal(findLegacyRoute("GET", "/user/update/123"), undefined);
    assert.equal(findLegacyRoute("PUT", "/user/update/123")?.handler, "updateUser");
    assert.equal(findLegacyRoute("GET", "/client/generateHeatMap")?.handler, "generateHeatMapSummary");
    assert.equal(findLegacyRoute("POST", "/client/generateHeatMap")?.handler, "generateHeatMapSummary");
  });
});
