import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { CompatibilityAdminService } from "../../src/modules/management/compatibility-admin.module.js";

describe("Key Impact Analysis upload", () => {
  it("stores every workbook data row in PostgreSQL without object storage", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("KIA");
    worksheet.addRow(["Ignored", "Label", "Key", "Value"]);
    worksheet.addRow(["", "Leadership", "leadership", "0.42"]);
    worksheet.addRow(["", "Benefits", "benefits", "27.5"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    let insertedRows: Array<Record<string, unknown>> = [];
    let enrollmentUpdate: Record<string, unknown> | undefined;
    const storagePut = () => {
      throw new Error("object storage must not be called");
    };
    const prisma = {
      organization: {
        findFirst: () => Promise.resolve({ id: "organization-id" }),
      },
      project: {
        findFirst: () => Promise.resolve({ id: "project-id" }),
      },
      program: {
        findFirst: () =>
          Promise.resolve({ id: "program-id", projectId: "project-id" }),
      },
      organizationProgram: {
        findFirst: () =>
          Promise.resolve({
            id: "enrollment-id",
            projectId: "project-id",
            legacyId: null,
            reportAccess: {},
            metrics: {},
          }),
        update: (args: Record<string, unknown>) => {
          enrollmentUpdate = args;
          return Promise.resolve({ id: "enrollment-id" });
        },
      },
      keyImpactAnalysisRow: {
        deleteMany: () => Promise.resolve({ count: 0 }),
        createMany: (args: { data: Array<Record<string, unknown>> }) => {
          insertedRows = args.data;
          return Promise.resolve({ count: args.data.length });
        },
      },
      $transaction: (operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
    };
    const service = new CompatibilityAdminService(
      prisma as never,
      { put: storagePut } as never,
      {} as never,
    );
    const request = {
      isMultipart: () => true,
      parts: function* () {
        yield {
          type: "file",
          filename: "kia.xlsx",
          mimetype:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          toBuffer: () => Promise.resolve(buffer),
        };
      },
    };

    const result = await service.uploadKeyImpactAnalysis(
      {
        sub: "admin-id",
        organizationId: null,
        roles: ["admin"],
        permissions: [],
      },
      request as never,
      {
        orgId: "organization-id",
        programId: "program-id",
        projectId: "project-id",
        orgProgramId: "enrollment-id",
      },
    );

    assert.deepEqual(result.data, { rowCount: 2 });
    assert.deepEqual(insertedRows, [
      {
        organizationProgramId: "enrollment-id",
        position: 1,
        label: "Leadership",
        key: "leadership",
        value: "0.42",
        sourceFileName: "kia.xlsx",
      },
      {
        organizationProgramId: "enrollment-id",
        position: 2,
        label: "Benefits",
        key: "benefits",
        value: "27.5",
        sourceFileName: "kia.xlsx",
      },
    ]);
    assert.deepEqual(
      (enrollmentUpdate?.data as Record<string, unknown>).metrics,
      { KIA_Order_Status: "Delivered" },
    );
  });
});
