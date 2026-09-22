import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { CompatibilityAdminService } from "../../src/modules/management/compatibility-admin.module.js";

describe("Key Impact Analysis upload", () => {
  it("leaves delivery pending when the workbook has no report rows", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("KIA").addRow(["Ignored", "Label", "Key", "Value"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    let transactionCalls = 0;
    const service = new CompatibilityAdminService(
      {
        organization: {
          findFirst: () => Promise.resolve({ id: "organization-id" }),
        },
        project: { findFirst: () => Promise.resolve({ id: "project-id" }) },
        program: {
          findFirst: () =>
            Promise.resolve({ id: "program-id", projectId: "project-id" }),
        },
        organizationProgram: {
          findFirst: () =>
            Promise.resolve({
              id: "enrollment-id",
              projectId: "project-id",
              reportAccess: { KIA_Access: "yes" },
              metrics: { KIA_Order_Status: "Processing" },
            }),
        },
        $transaction: () => {
          transactionCalls += 1;
        },
      } as never,
      {} as never,
      {} as never,
    );
    const request = {
      isMultipart: () => true,
      parts: function* () {
        yield {
          type: "file",
          filename: "empty.xlsx",
          mimetype:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          toBuffer: () => Promise.resolve(buffer),
        };
      },
    };

    await assert.rejects(
      service.uploadKeyImpactAnalysis(
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
      ),
      /workbook has no data rows/,
    );
    assert.equal(transactionCalls, 0);
  });

  it("rejects rows that cannot provide a unique label and contribution to both views", async () => {
    for (const { rows, message } of [
      {
        rows: [["", "", "leadership", "0.42"]],
        message: /must have a label, key and value/u,
      },
      {
        rows: [["", "Leadership", "leadership", "unknown"]],
        message: /invalid contribution value/u,
      },
      {
        rows: [["", "Leadership", "leadership", "-1"]],
        message: /invalid contribution value/u,
      },
      {
        rows: [["", "Leadership", "leadership", "101"]],
        message: /invalid contribution value/u,
      },
      {
        rows: [
          ["", "Leadership", "leadership", "0.42"],
          ["", "Team", "leadership", "0.27"],
        ],
        message: /duplicate key/u,
      },
    ]) {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("KIA");
      worksheet.addRow(["Ignored", "Label", "Key", "Value"]);
      rows.forEach((row) => worksheet.addRow(row));
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      let transactionCalls = 0;
      const service = new CompatibilityAdminService(
        {
          organization: {
            findFirst: () => Promise.resolve({ id: "organization-id" }),
          },
          project: { findFirst: () => Promise.resolve({ id: "project-id" }) },
          program: {
            findFirst: () =>
              Promise.resolve({ id: "program-id", projectId: "project-id" }),
          },
          organizationProgram: {
            findFirst: () =>
              Promise.resolve({ id: "enrollment-id", projectId: "project-id" }),
          },
          $transaction: () => {
            transactionCalls += 1;
          },
        } as never,
        {} as never,
        {} as never,
      );
      const request = {
        isMultipart: () => true,
        parts: function* () {
          yield {
            type: "file",
            filename: "invalid.xlsx",
            mimetype:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            toBuffer: () => Promise.resolve(buffer),
          };
        },
      };

      await assert.rejects(
        service.uploadKeyImpactAnalysis(
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
        ),
        message,
      );
      assert.equal(transactionCalls, 0);
    }
  });

  it("stores every workbook data row in PostgreSQL without object storage", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("KIA");
    worksheet.addRow(["Ignored", "Label", "Key", "Value"]);
    worksheet.addRow(["", "Leadership", "leadership", "0.42"]);
    worksheet.addRow(["", "Benefits", "benefits", "27.5"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    let insertedRows: Array<Record<string, unknown>> = [];
    let historyEntry: Record<string, unknown> | undefined;
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
      user: {
        findUnique: () => Promise.resolve({ username: "administrator" }),
      },
      keyImpactAnalysisUpload: {
        create: (args: { data: Record<string, unknown> }) => {
          historyEntry = args.data;
          return Promise.resolve({ id: "upload-id" });
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
    assert.deepEqual(historyEntry, {
      organizationProgramId: "enrollment-id",
      sourceFileName: "kia.xlsx",
      rows: [
        { label: "Leadership", key: "leadership", value: "0.42" },
        { label: "Benefits", key: "benefits", value: "27.5" },
      ],
      uploadedByUsername: "administrator",
    });
  });

  it("lists each upload and reconstructs the selected workbook", async () => {
    const uploadedAt = new Date("2026-09-20T12:00:00Z");
    const record = {
      id: "8fe69e52-dcb2-4d40-9a7b-0a24c89497dc",
      organizationProgramId: "enrollment-id",
      sourceFileName: "original.xlsx",
      uploadedByUsername: "admin-user",
      uploadedAt,
      rows: [{ label: "Leadership", key: "leadership", value: "42" }],
    };
    const enrollment = {
      id: "enrollment-id",
      organizationId: "org-id",
      projectId: "project-id",
      programId: "program-id",
      createdAt: uploadedAt,
      organization: { name: "Example" },
      program: { name: "2026 Program", year: 2026 },
      project: { name: "Project" },
      orders: [
        {
          items: [{ productId: "report-kia" }],
          updatedAt: uploadedAt,
          purchaser: { username: "buyer" },
        },
      ],
    };
    const service = new CompatibilityAdminService(
      {
        keyImpactAnalysisUpload: {
          findMany: () =>
            Promise.resolve([{ ...record, organizationProgram: enrollment }]),
          findUnique: () => Promise.resolve(record),
        },
      } as never,
      {} as never,
      {} as never,
    );
    const principal = {
      sub: "admin-id",
      organizationId: null,
      roles: ["admin"],
      permissions: [],
    };
    const history = await service.uploadedKeyImpactAnalyses(principal);
    assert.deepEqual(history.data[0], {
      id: record.id,
      organizationId: "org-id",
      organizationName: "Example",
      organizationProgramId: "enrollment-id",
      programId: "program-id",
      programName: "2026 Program",
      programYear: 2026,
      projectId: "project-id",
      projectName: "Project",
      purchasedAt: uploadedAt.toISOString(),
      purchasedByUsername: "buyer",
      status: "Uploaded",
      uploadedByUsername: "admin-user",
      uploadedAt: uploadedAt.toISOString(),
      sourceFileName: "original.xlsx",
    });
    let result: Buffer | undefined;
    const reply = {
      header: () => reply,
      send: (buffer: Buffer) => {
        result = buffer;
        return reply;
      },
    };
    await service.downloadKeyImpactAnalysis(
      principal,
      record.id,
      reply as never,
    );
    const workbook = new ExcelJS.Workbook();
    assert.ok(result);
    await workbook.xlsx.load(result as never);
    const sheet = workbook.worksheets[0];
    assert.ok(sheet);
    assert.equal(sheet.getRow(2).getCell(2).value, "Leadership");
    assert.equal(sheet.getRow(2).getCell(4).value, "42");
  });
});
