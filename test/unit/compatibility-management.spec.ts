import {
  Injectable,
  Module,
  RequestMethod,
  VersioningType,
} from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { NestFactory } from "@nestjs/core";
import { PassportModule, PassportStrategy } from "@nestjs/passport";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../../src/database/prisma.service.js";
import {
  JwtAuthGuard,
  type Principal,
} from "../../src/modules/auth/auth.module.js";
import {
  CompatibilityManagementController,
  CompatibilityManagementService,
  ProgramZohoResyncService,
} from "../../src/modules/management/compatibility-management.module.js";

const testJwtSecret = "test-secret-that-is-at-least-32-characters";
const calls = new Map<string, number>();
const mark = (name: string) => {
  calls.set(name, (calls.get(name) ?? 0) + 1);
  return { success: true, message: "success", data: [] };
};
const managementStub = {
  roles: () => mark("roles"),
  projects: () => mark("projects"),
  programs: () => mark("programs"),
  program: () => mark("program"),
  organizationsConnectionWorkbook: () => {
    mark("organizationsConnectionWorkbook");
    return Buffer.from("workbook");
  },
  deleteProject: () => mark("deleteProject"),
  deleteProgram: () => mark("deleteProgram"),
  permissions: () => mark("permissions"),
};
const programZohoResyncStub = {
  preview: () => mark("programZohoResyncPreview"),
  apply: () => mark("programZohoResyncApply"),
};

@Injectable()
class TestJwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: testJwtSecret,
    });
  }

  validate(payload: Principal): Principal {
    return payload;
  }
}

@Module({
  imports: [PassportModule, JwtModule.register({ secret: testJwtSecret })],
  controllers: [CompatibilityManagementController],
  providers: [
    { provide: CompatibilityManagementService, useValue: managementStub },
    { provide: ProgramZohoResyncService, useValue: programZohoResyncStub },
    TestJwtStrategy,
    JwtAuthGuard,
  ],
})
class CompatibilityManagementTestModule {}

async function createTestApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    CompatibilityManagementTestModule,
    new FastifyAdapter(),
    { logger: false },
  );
  app.setGlobalPrefix("api", {
    exclude: [
      { path: "admin/:one", method: RequestMethod.ALL },
      { path: "admin/:one/:two", method: RequestMethod.ALL },
      { path: "admin/:one/:two/:three", method: RequestMethod.ALL },
      { path: "admin/:one/:two/:three/:four", method: RequestMethod.ALL },
    ],
  });
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: "1",
  });
  await app.init();
  return app;
}

describe("native management compatibility endpoints", () => {
  it("previews program-scoped Zoho changes without changing local organizations", async () => {
    let requestedZohoProgramId = "";
    let writes = 0;
    const prisma = {
      program: {
        findFirst: () =>
          Promise.resolve({
            id: "program-id",
            externalId: "zoho-program-id",
            organizations: [
              {
                id: "enrollment-id",
                updatedAt: new Date("2026-01-01T00:00:00.000Z"),
                stage: "Invited",
                isWinner: false,
                employeesCount: 40,
                overallRank: "8",
                categoryRank: "3",
                currentZohoCategory: "Small",
                metrics: {
                  Source_Organization_ID: "49",
                  Source_Organization_Name: "Acme Health",
                  Surveys_Sent: 50,
                  Company_Size: 45,
                  Report_Category: "25-99",
                  Current_Year_Category: "Small",
                },
                organization: { name: "Acme Health LLC" },
              },
            ],
          }),
      },
      organizationProgram: {
        updateMany: () => {
          writes += 1;
          return Promise.resolve({ count: 1 });
        },
      },
    } as unknown as PrismaService;
    const zoho = {
      listOrganizationsForProgram: (
        _principal: Principal,
        programId: string,
      ) => {
        requestedZohoProgramId = programId;
        return Promise.resolve([
          {
            organizationId: "49",
            organizationName: "Acme Health Group",
            isWinner: true,
            surveysSent: 60,
            stage: "Closed",
            companySize: 55,
            employeesCount: 52,
            currentZohoCategory: "Community",
            reportCategory: "50-99",
            overallRank: "4",
            categoryRank: "1",
          },
          {
            organizationId: "99",
            organizationName: "New Zoho Company",
            isWinner: false,
            surveysSent: 10,
            stage: "Invited",
            companySize: 10,
            employeesCount: 9,
            currentZohoCategory: "Boutique",
            reportCategory: "15-24",
            overallRank: null,
            categoryRank: null,
          },
        ]);
      },
    };
    const service = new ProgramZohoResyncService(prisma, zoho as never);
    const preview = await service.preview(
      {
        sub: "admin-id",
        organizationId: null,
        roles: ["admin"],
        permissions: [],
      },
      "program-id",
    );

    assert.equal(requestedZohoProgramId, "zoho-program-id");
    assert.equal(writes, 0);
    assert.equal(preview.changedRows.length, 1);
    assert.deepEqual(
      preview.changedRows[0]?.changes.map(({ field, previous, next }) => ({
        field,
        previous,
        next,
      })),
      [
        {
          field: "organizationName",
          previous: "Acme Health",
          next: "Acme Health Group",
        },
        { field: "stage", previous: "Invited", next: "Closed" },
        { field: "isWinner", previous: false, next: true },
        { field: "surveysSent", previous: 50, next: 60 },
        { field: "companySize", previous: 45, next: 55 },
        { field: "employeesCount", previous: 40, next: 52 },
        { field: "overallRank", previous: "8", next: "4" },
        { field: "categoryRank", previous: "3", next: "1" },
        { field: "reportCategory", previous: "25-99", next: "50-99" },
        { field: "currentZohoCategory", previous: "Small", next: "Community" },
      ],
    );
    assert.deepEqual(preview.unmatchedZoho, [
      { organizationId: "99", organizationName: "New Zoho Company" },
    ]);
    assert.deepEqual(preview.missingLocal, []);
    assert.match(preview.revision, /^[a-f0-9]{64}$/u);
  });

  it("applies the reviewed Zoho snapshot atomically and rejects a stale revision", async () => {
    const enrollment = {
      id: "enrollment-id",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      stage: "Invited",
      isWinner: false,
      employeesCount: 40,
      overallRank: "8",
      categoryRank: "3",
      currentZohoCategory: "Small",
      metrics: {
        Source_Organization_ID: "49",
        Source_Organization_Name: "Acme Health",
        Surveys_Sent: 50,
        Company_Size: 45,
        Report_Category: "25-99",
        Current_Year_Category: "Small",
        Existing_Value: "preserved",
      },
      organization: { name: "Acme Health LLC" },
    };
    let update:
      | { where: Record<string, unknown>; data: Record<string, unknown> }
      | undefined;
    let latestZohoSync: Date | undefined;
    const transactionClient = {
      organizationProgram: {
        updateMany: (args: typeof update) => {
          update = args;
          return Promise.resolve({ count: 1 });
        },
      },
      program: {
        update: ({ data }: { data: { latestZohoSync: Date } }) => {
          latestZohoSync = data.latestZohoSync;
          return Promise.resolve({ id: "program-id" });
        },
      },
    };
    const prisma = {
      program: {
        findFirst: () =>
          Promise.resolve({
            id: "program-id",
            externalId: "zoho-program-id",
            legacyId: null,
            organizations: [enrollment],
          }),
      },
      $transaction: (callback: (client: typeof transactionClient) => unknown) =>
        callback(transactionClient),
    } as unknown as PrismaService;
    const zoho = {
      listOrganizationsForProgram: () =>
        Promise.resolve([
          {
            organizationId: "49",
            organizationName: "Acme Health Group",
            isWinner: true,
            surveysSent: 60,
            stage: null,
            companySize: null,
            employeesCount: null,
            currentZohoCategory: "Community",
            reportCategory: null,
            overallRank: null,
            categoryRank: null,
          },
        ]),
    };
    const service = new ProgramZohoResyncService(prisma, zoho as never);
    const principal = {
      sub: "admin-id",
      organizationId: null,
      roles: ["admin"],
      permissions: [],
    } satisfies Principal;
    const preview = await service.preview(principal, "program-id");

    await assert.rejects(
      service.apply(principal, "program-id", "b".repeat(64)),
      /Zoho preview changed/u,
    );
    const applied = await service.apply(
      principal,
      "program-id",
      preview.revision,
    );

    assert.equal(applied.appliedCount, 1);
    assert.ok(update);
    assert.ok(latestZohoSync instanceof Date);
    assert.deepEqual(update.where, {
      id: "enrollment-id",
      programId: "program-id",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    assert.deepEqual(
      { ...update.data, updatedAt: "timestamp" },
      {
        stage: null,
        isWinner: true,
        employeesCount: null,
        overallRank: null,
        categoryRank: null,
        currentZohoCategory: "Community",
        metrics: {
          Source_Organization_ID: "49",
          Source_Organization_Name: "Acme Health Group",
          Surveys_Sent: 60,
          Company_Size: null,
          Report_Category: null,
          Current_Year_Category: "Community",
          Existing_Value: "preserved",
        },
        updatedAt: "timestamp",
      },
    );
    assert.equal(
      (update.data.updatedAt as Date).toISOString(),
      latestZohoSync.toISOString(),
    );
  });

  it("serves the migrated administration routes", async () => {
    const app = await createTestApp();
    calls.clear();
    const token = app.get(JwtService).sign({
      sub: "6c79998f-10bd-45af-bdd1-61e11b50297a",
      organizationId: null,
      roles: ["admin"],
      permissions: ["ops.manage"],
    } satisfies Principal);
    const headers = { authorization: `Bearer ${token}` };
    try {
      const responses = await Promise.all([
        app.inject({ method: "GET", url: "/admin/getroles", headers }),
        app.inject({
          method: "GET",
          url: "/admin/getprojects?expand=programs",
          headers,
        }),
        app.inject({
          method: "GET",
          url: "/admin/getprojects/project-1",
          headers,
        }),
        app.inject({
          method: "GET",
          url: "/admin/getProgramsByProjectId?projectId=project-1&expand=orgs",
          headers,
        }),
        app.inject({
          method: "GET",
          url: "/admin/getProgramById/program-1",
          headers,
        }),
        app.inject({
          method: "GET",
          url: "/admin/programs/program-1/organizations-connection-fields.xlsx",
          headers,
        }),
        app.inject({
          method: "DELETE",
          url: "/admin/projects/project-1",
          headers,
        }),
        app.inject({
          method: "DELETE",
          url: "/admin/programs/program-1",
          headers,
        }),
        app.inject({
          method: "GET",
          url: "/admin/getpermissions/role-1",
          headers,
        }),
        app.inject({
          method: "POST",
          url: "/admin/programs/program-1/zoho-resync/preview",
          headers,
        }),
        app.inject({
          method: "POST",
          url: "/admin/programs/program-1/zoho-resync/apply",
          headers,
          payload: { revision: "a".repeat(64) },
        }),
      ]);
      for (const response of responses) {
        assert.equal(response.statusCode, 200, response.body);
      }
      assert.deepEqual(Object.fromEntries(calls), {
        roles: 1,
        projects: 2,
        programs: 1,
        program: 1,
        organizationsConnectionWorkbook: 1,
        deleteProject: 1,
        deleteProgram: 1,
        permissions: 1,
        programZohoResyncPreview: 1,
        programZohoResyncApply: 1,
      });
    } finally {
      await app.close();
    }
  });

  it("exports organization connection fields with categories and payments", async () => {
    const prisma = {
      program: {
        findFirst: () =>
          Promise.resolve({
            name: "Feedback 2026",
            metadata: {
              categoryPricing: [
                { tier: "Small", employeeSize: "25-99", priceCents: 1 },
                { tier: "Medium", employeeSize: "100-199", priceCents: 1 },
              ],
            },
            organizations: [
              {
                stage: "Full Package",
                isWinner: true,
                isIncluded: true,
                currentZohoCategory: "Small/Medium",
                benchmarkCategory: "Small",
                categoryRank: "2",
                overallRank: "4",
                metrics: {
                  Source_Organization_ID: "49",
                  Surveys_Sent: 80,
                  Company_Size: 30,
                  Report_Category: "15-24",
                  Current_Year_Category: "Small",
                  SEV_Filter: "Department",
                },
                paymentDetails: {},
                organization: {
                  id: "organization-id",
                  legacyId: null,
                  externalId: null,
                  name: "Acme Health",
                },
                orders: [
                  {
                    paymentMethod: "Paid via ACH",
                    items: [
                      {
                        productId: "report-verbatims-sorted",
                        keys: {
                          productId: "report-verbatims-sorted",
                          EV_Sorting_Filter: "Department",
                        },
                      },
                      {
                        productId: "report-response-detail",
                        keys: { productId: "report-response-detail" },
                      },
                    ],
                  },
                ],
              },
              {
                stage: "Closed",
                isWinner: false,
                isIncluded: false,
                currentZohoCategory: "Medium",
                benchmarkCategory: "Medium",
                categoryRank: null,
                overallRank: null,
                metrics: {
                  Source_Organization_ID: "50",
                  Surveys_Sent: 120,
                  Current_Year_Category: "Medium",
                },
                paymentDetails: {},
                organization: {
                  id: "excluded-id",
                  legacyId: null,
                  externalId: null,
                  name: "Excluded Group",
                },
                orders: [],
              },
            ],
          }),
      },
    } as unknown as PrismaService;
    const service = new CompatibilityManagementService(prisma);
    const buffer = await service.organizationsConnectionWorkbook(
      {
        sub: "admin-id",
        organizationId: null,
        roles: ["admin"],
        permissions: [],
      },
      "program-id",
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const worksheet = workbook.getWorksheet("Organizations");
    assert.ok(worksheet);
    const headerValues = worksheet.getRow(1).values;
    assert.ok(Array.isArray(headerValues));
    assert.deepEqual(headerValues.slice(1), [
      "Alias Name",
      "Organization ID",
      "Stage",
      "Surveys Sent",
      "Report Category",
      "FDD Payment Type",
      "Sorted EV Payment Type",
      "EV Sorting Filter",
      "RD Payment Type",
      "KIA Payment Type",
      "CY Winner",
      "CY Category",
      "CY Category Rank",
      "CY Overall Rank",
    ]);
    const firstOrganizationValues = worksheet.getRow(2).values;
    assert.ok(Array.isArray(firstOrganizationValues));
    assert.deepEqual(firstOrganizationValues.slice(1), [
      "Acme Health",
      "49",
      "Full Package",
      80,
      "15-24",
      "Given by default",
      "Paid via ACH",
      "Department",
      "Paid via ACH",
      "",
      "Winner",
      "Small/Medium",
      "2",
      "4",
    ]);
    assert.equal(worksheet.getRow(3).getCell(11).value, "Non-selected");
    assert.equal(worksheet.getRow(3).getCell(5).value, "100-199");
  });

  it("maps normalized roles to the legacy administration projection", async () => {
    let roleQuery: Record<string, unknown> | undefined;
    const prisma = {
      role: {
        findMany: (args: Record<string, unknown>) => {
          roleQuery = args;
          return Promise.resolve([
            {
              id: "role-id",
              legacyId: "legacy-role",
              key: "project-manager",
              name: "Project Manager",
              _count: { users: 3 },
            },
            {
              id: "client-role-id",
              legacyId: null,
              key: "client",
              name: "Client",
              _count: { users: 9 },
            },
          ]);
        },
      },
    } as unknown as PrismaService;
    const service = new CompatibilityManagementService(prisma);
    const result = await service.roles({
      sub: "admin-id",
      organizationId: null,
      roles: ["admin"],
      permissions: [],
    });
    assert.deepEqual(result.roleData, [
      {
        _id: "legacy-role",
        role: "project-manager",
        name: "Project Manager",
        userCount: 3,
      },
      {
        _id: "client-role-id",
        role: "client",
        name: "Client",
        userCount: 9,
      },
    ]);
    assert.ok(roleQuery);
    assert.equal("where" in roleQuery, false);
  });

  it("deletes projects and programs idempotently through their database identities", async () => {
    const deleted: string[] = [];
    const prisma = {
      project: {
        findFirst: () =>
          Promise.resolve({
            id: "project-id",
            name: "Project",
            _count: { programs: 2 },
          }),
        deleteMany: ({ where }: { where: { id: string } }) => {
          deleted.push(`project:${where.id}`);
          return Promise.resolve({ count: 1 });
        },
      },
      program: {
        findFirst: () =>
          Promise.resolve({
            id: "program-id",
            name: "Program",
            _count: { organizations: 3 },
          }),
        deleteMany: ({ where }: { where: { id: string } }) => {
          deleted.push(`program:${where.id}`);
          return Promise.resolve({ count: 0 });
        },
      },
    } as unknown as PrismaService;
    const service = new CompatibilityManagementService(prisma);
    const principal = {
      sub: "admin-id",
      organizationId: null,
      roles: ["admin"],
      permissions: [],
    } satisfies Principal;

    await assert.doesNotReject(
      service.deleteProject(principal, "external-project"),
    );
    await assert.doesNotReject(
      service.deleteProgram(principal, "external-program"),
    );
    assert.deepEqual(deleted, ["project:project-id", "program:program-id"]);

    await assert.rejects(
      service.deleteProject(
        { ...principal, roles: ["project-manager"] },
        "external-project",
      ),
      /Administrator access required/u,
    );
  });
});
