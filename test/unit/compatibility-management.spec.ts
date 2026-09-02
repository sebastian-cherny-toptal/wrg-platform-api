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
      "Small/Medium",
      "Given by default",
      "Paid via ACH",
      "Department",
      "Paid via ACH",
      "",
      "Winner",
      "Small",
      "2",
      "4",
    ]);
    assert.equal(worksheet.getRow(3).getCell(11).value, "Non-selected");
    assert.equal(worksheet.getRow(3).getCell(5).value, "Medium");
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
