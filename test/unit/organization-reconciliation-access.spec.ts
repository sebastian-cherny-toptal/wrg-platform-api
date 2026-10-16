import assert from "node:assert/strict";
import { it } from "node:test";
import { OrganizationReconciliationService } from "../../src/modules/management/organization-reconciliation.service.js";

it("denies scoped operators before reading cross-project organization identities or writing data", async () => {
  const service = new OrganizationReconciliationService({} as never, {
    mappingConflicts: () => {
      throw new Error("must not read CRM");
    },
  });
  const principal = {
    sub: "operator",
    roles: ["client"],
    organizationId: null,
    permissions: [
      "clientsProjectsProgramsAccess",
      "syncCheckmartketAndZohoAccess",
    ],
  };
  await assert.rejects(
    service.report(principal, "program"),
    /Administrator access required/,
  );
  await assert.rejects(
    service.preview(principal, "program", { conflictIds: ["row"] }),
    /Administrator access required/,
  );
  await assert.rejects(
    service.apply(principal, "program", {
      conflictIds: ["row"],
      revision: "a".repeat(64),
    }),
    /Administrator access required/,
  );
});
