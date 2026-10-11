import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCanonicalOrganization } from "../../src/modules/imports/organization-identity.js";

const organizations = [
  { id: "a", name: "Old Company", zohoAccountId: "account-1" },
  { id: "b", name: "Old Company", zohoAccountId: null },
  { id: "c", name: "Other", zohoAccountId: "account-2" },
];
describe("canonical company identity", () => {
  it("reuses a CRM account independently of its name", () => {
    assert.equal(
      resolveCanonicalOrganization(organizations, undefined, "account-1")?.id,
      "a",
    );
  });
  it("does not reuse organizations by name or program-local source ID", () => {
    assert.equal(
      resolveCanonicalOrganization(organizations, undefined, undefined),
      undefined,
    );
    assert.equal(
      resolveCanonicalOrganization(organizations, "new", undefined),
      undefined,
    );
  });
  it("accepts an explicit legacy mapping and retains reimport identity", () => {
    assert.equal(
      resolveCanonicalOrganization(organizations, "b", undefined)?.id,
      "b",
    );
    assert.equal(
      resolveCanonicalOrganization(organizations, undefined, undefined, "b")
        ?.id,
      "b",
    );
    assert.throws(
      () => resolveCanonicalOrganization(organizations, "a", undefined, "b"),
      /Reimports must retain/,
    );
  });
  it("rejects conflicting CRM mappings, deleted selections, and duplicate creation", () => {
    assert.throws(
      () => resolveCanonicalOrganization(organizations, "b", "account-1"),
      /already linked/,
    );
    assert.throws(
      () => resolveCanonicalOrganization(organizations, "new", "account-1"),
      /already linked/,
    );
    assert.throws(
      () => resolveCanonicalOrganization(organizations, "a", "account-2"),
      /already linked/,
    );
    assert.throws(
      () => resolveCanonicalOrganization(organizations, "c", "unknown-account"),
      /different CRM account/,
    );
    assert.throws(
      () => resolveCanonicalOrganization(organizations, "missing", undefined),
      /no longer exists/,
    );
  });
});
