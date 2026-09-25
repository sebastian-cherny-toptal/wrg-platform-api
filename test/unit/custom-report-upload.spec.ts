import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FastifyRequest } from "fastify";
import type { Principal } from "../../src/modules/auth/auth.module.js";
import { CompatibilityAdminService } from "../../src/modules/management/compatibility-admin.module.js";

const principal: Principal = {
  sub: "admin-id",
  organizationId: null,
  roles: ["admin"],
  permissions: [],
};

function multipartRequest(filename: string, contents = "report") {
  const fields = {
    organizationProgramId: "9c74bf95-8464-4dc1-a187-058eff655860",
    reportName: "Executive Summary",
    description: "Prepared for the board",
  };
  return {
    isMultipart: () => true,
    parts: async function* () {
      await Promise.resolve();
      for (const [fieldname, value] of Object.entries(fields)) {
        yield { type: "field", fieldname, value };
      }
      yield {
        type: "file",
        filename,
        mimetype: "application/octet-stream",
        toBuffer: () => Promise.resolve(Buffer.from(contents)),
      };
    },
  } as unknown as FastifyRequest;
}

describe("custom report uploads", () => {
  it("stores an immutable file record and grants custom-report access", async () => {
    let created: Record<string, unknown> | undefined;
    let updated: Record<string, unknown> | undefined;
    const enrollment = {
      id: "9c74bf95-8464-4dc1-a187-058eff655860",
      reportAccess: { KIA_Access: "yes" },
    };
    const transaction = {
      customReportUpload: {
        create: ({ data }: { data: Record<string, unknown> }) => {
          created = data;
          return Promise.resolve({
            id: "d079f93c-3195-4278-be34-52ee2866782d",
          });
        },
      },
      organizationProgram: {
        update: (input: Record<string, unknown>) => {
          updated = input;
          return Promise.resolve(enrollment);
        },
      },
    };
    const prisma = {
      organizationProgram: { findFirst: () => Promise.resolve(enrollment) },
      user: { findUnique: () => Promise.resolve({ username: "admin-user" }) },
      $transaction: (callback: (tx: typeof transaction) => unknown) =>
        Promise.resolve(callback(transaction)),
    };
    const service = new CompatibilityAdminService(
      prisma as never,
      {} as never,
      {} as never,
    );

    await service.uploadCustomReport(
      principal,
      multipartRequest("results.xlsx"),
    );

    assert.ok(created);
    assert.equal(created.sourceFileName, "results.xlsx");
    assert.equal(created.reportName, "Executive Summary");
    assert.equal(created.uploadedByUsername, "admin-user");
    assert.ok(updated);
    assert.deepEqual(
      (updated.data as { reportAccess: Record<string, string> }).reportAccess,
      { KIA_Access: "yes", CR_Access: "yes" },
    );
  });

  it("rejects files outside the supported report formats", async () => {
    const service = new CompatibilityAdminService(
      {} as never,
      {} as never,
      {} as never,
    );
    await assert.rejects(
      service.uploadCustomReport(principal, multipartRequest("report.docx")),
      /file must be a PPTX, CSV, XLSX, or PDF/u,
    );
  });
});
