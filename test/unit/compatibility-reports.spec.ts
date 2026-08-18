import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Prisma } from "@prisma/client";
import type { PrismaService } from "../../src/database/prisma.service.js";
import {
  CompatibilityReportsService,
  type BenchmarkQuestion,
} from "../../src/modules/reports/compatibility-reports.module.js";

function benchmarkQuestion(
  id: string,
  categoryLabel: string,
  position: number,
): BenchmarkQuestion {
  return {
    id,
    legacyId: null,
    externalId: null,
    dataLabel: `q_${id}`,
    caption: id,
    type: "likert",
    position,
    metadata: { categoryLabel },
  };
}

describe("compatibility report categories", () => {
  it("allows promotional users to preview basic reports without mutating shared report access", async () => {
    const prisma = {
      program: {
        findFirst: () => ({
          id: "program-1",
          projectId: "project-1",
          name: "Test program",
          year: 2026,
          startsAt: null,
          metadata: {} as Prisma.JsonValue,
          project: { id: "project-1", name: "Test project" },
        }),
      },
      organizationProgram: {
        findFirst: () => ({
          id: "enrollment-1",
          reportAccess: {},
          metrics: {},
          metadata: {},
        }),
        findMany: () => [],
      },
      survey: {
        findFirst: () => ({
          id: "survey-1",
          title: "Test survey",
          startsAt: null,
          endsAt: null,
        }),
      },
      question: { findMany: () => [] },
      response: { findMany: () => [] },
    } as unknown as PrismaService;
    const service = new CompatibilityReportsService(prisma);
    const query = { selectedProgramId: "program-1", isDummy: false };

    await assert.doesNotReject(
      service.sectionComparison(
        {
          sub: "promotional-user",
          organizationId: "organization-1",
          roles: ["promotional"],
          permissions: [],
        },
        query,
      ),
    );
    await assert.rejects(
      service.sectionComparison(
        {
          sub: "client-user",
          organizationId: "organization-1",
          roles: ["client"],
          permissions: [],
        },
        query,
      ),
      /This program does not include access to the requested report/u,
    );
  });

  it("sorts section comparison categories from questionGroups.keys()", async () => {
    const questions = [
      benchmarkQuestion("q-relationship-manager", "Relationship With Your Manager", 2),
      benchmarkQuestion("q-survey", "Survey Questions", 1),
      benchmarkQuestion("q-your-job", "Your Job", 2),
      benchmarkQuestion(
        "q-core-duplicate",
        "Core Employee Experience",
        3,
      ),
      benchmarkQuestion("q-unknown", "Zeta", 4),
      benchmarkQuestion(
        "q-communication-culture",
        "Communication and Workplace Culture",
        5,
      ),
      benchmarkQuestion("q-core", "Core Employee Experience", 6),
    ];
    const prisma = {
      program: {
        findFirst: () => ({
          id: "program-1",
          projectId: "project-1",
          name: "Test program",
          year: 2026,
          startsAt: null,
          metadata: {} as Prisma.JsonValue,
          project: { id: "project-1", name: "Test project" },
        }),
      },
      organizationProgram: {
        findFirst: () => ({
          id: "enrollment-1",
          reportAccess: {},
          metrics: {},
        }),
        findMany: () => [],
      },
      survey: {
        findFirst: () => ({
          id: "survey-1",
          title: "Test survey",
          startsAt: null,
          endsAt: null,
        }),
      },
      question: {
        findMany: () => questions,
      },
      response: {
        findMany: () => [],
      },
    } as unknown as PrismaService;
    const service = new CompatibilityReportsService(prisma);

    const result = await service.sectionComparison(
      {
        sub: "user-1",
        organizationId: "organization-1",
        roles: ["admin"],
        permissions: [],
      },
      {
        selectedProgramId: "program-1",
        isDummy: false,
      },
    );

    assert.deepEqual(
      result.data.map(({ category }) => category),
      [
        "Core Employee Experience",
        "Your Job",
        "Communication and Workplace Culture",
        "Relationship With Your Manager",
        "Survey Questions",
        "Zeta",
      ],
    );
  });
});
