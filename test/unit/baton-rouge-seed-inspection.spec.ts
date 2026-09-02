import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  batonRougeSeedMetricsMatch,
  expectedBatonRougeSeedMetrics,
  inspectBatonRougeSeed,
  shouldSkipBatonRougeSeed,
} from "../../src/cli/baton-rouge-seed-inspection.js";

describe("Baton Rouge seed inspection", () => {
  it("builds the expected metrics with the exact enrollment union", () => {
    assert.deepEqual(expectedBatonRougeSeedMetrics(3, 31), {
      usernameExists: true,
      projectsLinked: 1,
      programsLinked: 3,
      organizationPrograms: 31,
    });
  });

  it("reads the report user's links and seeded organization programs", async () => {
    const prisma = {
      user: {
        findUnique: () =>
          Promise.resolve({
            _count: { projects: 1, programs: 3 },
          }),
      },
      organizationProgram: {
        count: () => Promise.resolve(30),
      },
    } as unknown as PrismaClient;

    assert.deepEqual(await inspectBatonRougeSeed(prisma), {
      usernameExists: true,
      projectsLinked: 1,
      programsLinked: 3,
      organizationPrograms: 30,
    });
  });

  it("returns zero user links when the username does not exist", async () => {
    const prisma = {
      user: { findUnique: () => Promise.resolve(null) },
      organizationProgram: { count: () => Promise.resolve(0) },
    } as unknown as PrismaClient;

    assert.deepEqual(await inspectBatonRougeSeed(prisma), {
      usernameExists: false,
      projectsLinked: 0,
      programsLinked: 0,
      organizationPrograms: 0,
    });
  });

  it("requires every metric to match", () => {
    const expected = expectedBatonRougeSeedMetrics(3, 31);
    assert.equal(batonRougeSeedMetricsMatch(expected, expected), true);
    assert.equal(
      batonRougeSeedMetricsMatch(
        { ...expected, organizationPrograms: 29 },
        expected,
      ),
      false,
    );
    assert.equal(
      batonRougeSeedMetricsMatch(
        { ...expected, usernameExists: false },
        expected,
      ),
      false,
    );
  });

  it('only rebuilds matching data when force update is exactly "true"', () => {
    const metrics = expectedBatonRougeSeedMetrics(3, 31);
    assert.equal(shouldSkipBatonRougeSeed(metrics, metrics, undefined), true);
    assert.equal(shouldSkipBatonRougeSeed(metrics, metrics, "false"), true);
    assert.equal(shouldSkipBatonRougeSeed(metrics, metrics, "TRUE"), true);
    assert.equal(shouldSkipBatonRougeSeed(metrics, metrics, "true"), false);
    assert.equal(
      shouldSkipBatonRougeSeed(
        { ...metrics, programsLinked: 2 },
        metrics,
        undefined,
      ),
      false,
    );
  });
});
