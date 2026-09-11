import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaService } from "../../src/database/prisma.service.js";
import {
  parseCategoryPriceUpdates,
  ReportCatalogAdminController,
} from "../../src/modules/reports/report-catalog-admin.module.js";

describe("program category price updates", () => {
  const tiers = ["Boutique", "Small"];

  it("accepts one non-negative price for every configured category", () => {
    assert.deepEqual(
      parseCategoryPriceUpdates(
        {
          prices: [
            { tier: "Boutique", priceCents: 110_000 },
            { tier: "Small", priceCents: 120_000 },
          ],
        },
        tiers,
      ),
      [
        { tier: "Boutique", priceCents: 110_000 },
        { tier: "Small", priceCents: 120_000 },
      ],
    );
  });

  it("rejects missing, duplicate, unknown, and blank prices", () => {
    assert.throws(() =>
      parseCategoryPriceUpdates(
        { prices: [{ tier: "Boutique", priceCents: 110_000 }] },
        tiers,
      ),
    );
    assert.throws(() =>
      parseCategoryPriceUpdates(
        {
          prices: [
            { tier: "Boutique", priceCents: 110_000 },
            { tier: "Boutique", priceCents: 120_000 },
          ],
        },
        tiers,
      ),
    );
    assert.throws(() =>
      parseCategoryPriceUpdates(
        {
          prices: [
            { tier: "Boutique", priceCents: 110_000 },
            { tier: "Other", priceCents: 120_000 },
          ],
        },
        tiers,
      ),
    );
    assert.throws(() =>
      parseCategoryPriceUpdates(
        {
          prices: [
            { tier: "Boutique", priceCents: null },
            { tier: "Small", priceCents: 120_000 },
          ],
        },
        tiers,
      ),
    );
  });

  it("updates only prices while returning fixed pricing-band names", async () => {
    const categoryWrites: Array<Record<string, unknown>> = [];
    let programWrite: Record<string, unknown> | undefined;
    const prisma = {
      program: {
        findUniqueOrThrow: () =>
          Promise.resolve({
            metadata: { historicalImportId: "import-id" },
            zohoCategories: [
              {
                tier: "Boutique",
                zohoCategoryName: "Community",
                employeeSize: "15-24",
                priceCents: 100_000,
              },
              {
                tier: "Small",
                zohoCategoryName: "Growing",
                employeeSize: "25-99",
                priceCents: 110_000,
              },
            ],
          }),
        update: (args: Record<string, unknown>) => {
          programWrite = args;
          return Promise.resolve(args);
        },
      },
      programZohoCategory: {
        update: (args: Record<string, unknown>) => {
          categoryWrites.push(args);
          return Promise.resolve(args);
        },
      },
      $transaction: async (operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
    } as unknown as PrismaService;
    const controller = new ReportCatalogAdminController(prisma);

    const result = await controller.updateProgramCategoryPrices(
      {
        sub: "admin-id",
        organizationId: null,
        roles: ["admin"],
        permissions: [],
      },
      "program-id",
      {
        prices: [
          { tier: "Boutique", priceCents: 125_000 },
          { tier: "Small", priceCents: 135_000 },
        ],
      },
    );

    assert.equal(categoryWrites.length, 2);
    assert.deepEqual(result.data, [
      {
        tier: "Boutique",
        pricingCategoryName: "15-24",
        priceCents: 125_000,
      },
      {
        tier: "Small",
        pricingCategoryName: "25-99",
        priceCents: 135_000,
      },
    ]);
    assert.deepEqual(
      (
        (programWrite?.data as Record<string, unknown>).metadata as Record<
          string,
          unknown
        >
      ).categoryPricing,
      result.data,
    );
  });
});
