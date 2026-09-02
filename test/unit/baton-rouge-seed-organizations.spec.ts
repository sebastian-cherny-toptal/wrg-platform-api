import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalSeedOrganizationName,
  defaultSeedOrganizationCount,
  seedOrganizationCount,
  selectSeedOrganizations,
  targetOrganizationName,
} from "../../src/cli/baton-rouge-seed-organizations.js";

describe("Baton Rouge seed organization selection", () => {
  it("uses a positive integer count and defaults invalid values to ten", () => {
    assert.equal(seedOrganizationCount("3"), 3);
    assert.equal(seedOrganizationCount(" 12 "), 12);
    for (const value of [undefined, "", "0", "-1", "1.5", "nope"]) {
      assert.equal(seedOrganizationCount(value), defaultSeedOrganizationCount);
    }
  });

  it("maps the sanitized fixture name to the required organization", () => {
    assert.equal(
      canonicalSeedOrganizationName("Synthetic 06f796de0c9331b9"),
      targetOrganizationName,
    );
  });

  it("selects the required organization first, then source-order entries", () => {
    const organizations = new Map([
      ["alpha", { name: "Alpha" }],
      ["commerce title abstract company", { name: targetOrganizationName }],
      ["beta", { name: "Beta" }],
    ]);

    assert.deepEqual(
      [
        ...selectSeedOrganizations(
          organizations,
          "commerce title abstract company",
          2,
        ).values(),
      ].map(({ name }) => name),
      [targetOrganizationName, "Alpha"],
    );
  });

  it("rejects a source without enough organizations", () => {
    assert.throws(
      () => selectSeedOrganizations(new Map([["target", true]]), "target", 2),
      /only 1 are available/u,
    );
  });
});
