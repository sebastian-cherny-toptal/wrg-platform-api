import "dotenv/config";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ZohoService,
  type ZohoRecord,
} from "../../src/modules/crm-sync/zoho.service.js";

const hasLiveEnvironment = Boolean(
  process.env.ZOHO_CLIENT_ID &&
  process.env.ZOHO_CLIENT_SECRET &&
  process.env.ZOHO_REFRESH_TOKEN,
);

function logSample(label: string, value: unknown): void {
  const sample = Array.isArray(value) ? value.slice(0, 3) : value;
  console.log(`\n===== ${label} =====`);
  console.dir(sample, { depth: null, colors: false });
}

describe("ZohoService", () => {
  it("creates bulk-write CSV and field mappings", () => {
    const service = new ZohoService({ clientId: "test", clientSecret: "test", refreshToken: "test" });
    assert.equal(service.createCSVForBulkWrite([{ id: "1", Name: "Acme, Inc." }]), 'id,Name\n1,"Acme, Inc."');
    assert.deepEqual(service.getFieldMappings({ id: "1", Name: "Acme" }), [
      { api_name: "id", index: 0 },
      { api_name: "Name", index: 1 },
    ]);
  });

  it(
    "requests every read endpoint and prints three sample records",
    { skip: true, timeout: 120_000 },
    async () => {
      const service = ZohoService.fromEnv();
      const failures: Array<{ endpoint: string; error: unknown }> = [];
      const run = async <T>(endpoint: string, operation: () => Promise<T>): Promise<T | undefined> => {
        try {
          const result = await operation();
          logSample(endpoint, result);
          return result;
        } catch (error) {
          failures.push({ endpoint, error });
          console.error(`\n===== ${endpoint} FAILED =====`, error);
          return undefined;
        }
      };

      const token = await service.getAuthToken();
      assert.ok(token.access_token);
      console.log("\n===== OAuth token =====\nAccess token acquired (value intentionally hidden)");

      await run("GET /crm/v5/settings/modules", () => service.getZohoModules());

      const knownModules: Array<{
        label: string;
        apiName: string;
        retrieve: () => Promise<ZohoRecord[]>;
      }> = [
        { label: "Programs", apiName: service.program_module, retrieve: () => service.getAllProgram() },
        { label: "Projects", apiName: service.project_module, retrieve: () => service.getAllProjects() },
        { label: "Contacts", apiName: service.client_module, retrieve: () => service.getAllClients() },
        { label: "Organizations", apiName: service.org_module, retrieve: () => service.getAllOrganizations() },
        { label: "Deals", apiName: service.deal_module, retrieve: () => service.getAllDeals() },
        { label: "Products", apiName: service.product_module, retrieve: () => service.getAllProducts() },
      ];

      const recordsByModule = new Map<string, ZohoRecord[]>();
      for (const module of knownModules) {
        const records = await run(`${module.label} via its ZohoService helper`, module.retrieve);
        if (records) recordsByModule.set(module.apiName, records);
      }

      const selectedModule = process.env.ZOHO_TEST_MODULE ?? service.org_module;
      const selectedRecords = await run(
        `${selectedModule} via getAllRecords (CRM v2 pagination)`,
        () => service.getAllRecords({ module: selectedModule }),
      );
      if (selectedRecords) recordsByModule.set(selectedModule, selectedRecords);

      await run(`${selectedModule} via CRM v5 count/list pagination`, () =>
        service.fetchDataWithRecursiveCall(selectedModule, token.access_token),
      );
      await run(`${selectedModule} via CRM v2 pagination directly`, () =>
        service.fetchDataWithRecursiveCallV2(selectedModule, token.access_token),
      );
      await run(`${selectedModule} via generated COQL`, () =>
        service.fetchDataWithCOQL(selectedModule, token.access_token),
      );
      await run(`${selectedModule} via custom COQL`, () =>
        service.fetchDataWithCOQLV2(
          process.env.ZOHO_TEST_COQL ?? `select id from ${selectedModule} limit 3`,
        ),
      );

      const discoveredId =
        process.env.ZOHO_TEST_RECORD_ID ?? recordsByModule.get(selectedModule)?.[0]?.id;
      if (discoveredId) {
        await run(`${selectedModule}/${discoveredId} via getRecordById`, () =>
          service.getRecordById({ module: selectedModule, id: discoveredId }),
        );
        await run(`${selectedModule}/${discoveredId} via CRM v2 IDs query`, () =>
          service.fetchDataWithRecursiveCallV2(selectedModule, token.access_token, [discoveredId]),
        );
        await run(`${selectedModule}/${discoveredId} via CRM v5 ID query`, () =>
          service.fetchDataWithRecursiveCall(selectedModule, token.access_token, [discoveredId]),
        );
        await run(`${selectedModule} search endpoint`, () =>
          service.getRecordBySearch({
            module: selectedModule,
            criteria: process.env.ZOHO_TEST_SEARCH_CRITERIA ?? `(id:equals:${discoveredId})`,
          }),
        );
      } else {
        console.log(`\nNo ${selectedModule} record was found; record-by-ID and search samples were skipped.`);
      }

      assert.deepEqual(
        failures.map(({ endpoint, error }) => ({
          endpoint,
          error: error instanceof Error ? error.message : String(error),
        })),
        [],
        "One or more Zoho read endpoints failed; inspect the samples above",
      );
    },
  );

  it("executes an explicitly enabled update against Zoho", { skip: !hasLiveEnvironment || process.env.ZOHO_TEST_ALLOW_WRITE !== "true" }, async () => {
    const module = process.env.ZOHO_TEST_MODULE;
    const id = process.env.ZOHO_TEST_RECORD_ID;
    const payload = process.env.ZOHO_TEST_UPDATE_PAYLOAD;
    assert.ok(module && id && payload, "ZOHO_TEST_MODULE, ZOHO_TEST_RECORD_ID and ZOHO_TEST_UPDATE_PAYLOAD are required for a write test");
    assert.ok(await ZohoService.fromEnv().updateCrm({ module, id, payload: JSON.parse(payload) as Record<string, unknown> }));
  });
});
