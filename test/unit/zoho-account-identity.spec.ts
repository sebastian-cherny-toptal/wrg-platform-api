import assert from "node:assert/strict";
import { it } from "node:test";
import { CompatibilityZohoService } from "../../src/modules/crm-sync/compatibility-zoho.module.js";

it("keeps the CRM account ID separate from the program's organization ID and prefers Company Name", async () => {
  const service = new CompatibilityZohoService(
    {} as never,
    {
      searchAllRecords: () =>
        Promise.resolve([
          {
            id: "deal",
            Program: { id: "program-2026" },
            Deal_Organization_ID: "49",
            Account_Name: {
              id: "crm-account-42",
              name: "Tri-Arrows Aluminum, Inc.",
            },
            Alias_Name: "Tri Arrows Aluminum-49-Program",
          },
        ]),
    } as never,
  );
  const organizations =
    await service.verifiedOrganizationsForProgram("program-2026");
  assert.equal(organizations[0]?.organizationId, "49");
  assert.equal(organizations[0].zohoAccountId, "crm-account-42");
  assert.equal(organizations[0].organizationName, "Tri-Arrows Aluminum, Inc.");
});
