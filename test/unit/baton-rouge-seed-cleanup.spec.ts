import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { clearPreviousBatonRougeSeed } from "../../src/cli/baton-rouge-seed-cleanup.js";

describe("Baton Rouge seed cleanup", () => {
  it("deletes seeded organization orders before replacing the seed namespace", async () => {
    const calls: Array<{ operation: string; args: unknown }> = [];
    const prisma = {
      order: {
        deleteMany: (args: unknown) => {
          calls.push({ operation: "orders", args });
          return Promise.resolve({ count: 1 });
        },
      },
      user: {
        deleteMany: (args: unknown) => {
          calls.push({ operation: "users", args });
          return Promise.resolve({ count: 1 });
        },
      },
      project: {
        deleteMany: (args: unknown) => {
          calls.push({ operation: "projects", args });
          return Promise.resolve({ count: 1 });
        },
      },
      organization: {
        deleteMany: (args: unknown) => {
          calls.push({ operation: "organizations", args });
          return Promise.resolve({ count: 1 });
        },
      },
    } as unknown as PrismaClient;

    await clearPreviousBatonRougeSeed(prisma);

    assert.deepEqual(
      calls.map(({ operation }) => operation),
      ["orders", "users", "projects", "organizations"],
    );
    assert.deepEqual(calls[0]?.args, {
      where: {
        organization: { externalId: { startsWith: "seed-br-org-" } },
      },
    });
  });
});
