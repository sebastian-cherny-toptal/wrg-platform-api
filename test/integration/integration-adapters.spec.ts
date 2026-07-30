import { ConfigService } from "@nestjs/config";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Env } from "../../src/config/env.js";
import {
  CheckMarketAdapter,
  ZohoAdapter,
} from "../../src/modules/integrations/integrations.module.js";

describe("integration adapters in safe local mode", () => {
  const config = new ConfigService({
    INTEGRATIONS_MOCK: true,
    ZOHO_BASE_URL: "http://localhost/mock/zoho",
    ZOHO_CLIENT_ID: "mock",
    ZOHO_CLIENT_SECRET: "mock",
    CHECKMARKET_BASE_URL: "http://localhost/mock/checkmarket",
    CHECKMARKET_API_KEY: "mock",
  }) as ConfigService<Env, true>;

  it("returns typed Zoho fixtures without network access", async () => {
    const records = await new ZohoAdapter(config).listRecords("Deals");
    assert.deepEqual(records, [
      { id: "zoho-mock-Deals-1", Name: "Mock Deals" },
    ]);
  });

  it("returns typed CheckMarket fixtures without network access", async () => {
    const survey = await new CheckMarketAdapter(config).getSurvey(42);
    assert.equal(survey.Id, 42);
    assert.equal(survey.SurveyStatusId, "1");
  });
});
