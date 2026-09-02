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
import { ExtractJwt, Strategy } from "passport-jwt";
import {
  JwtAuthGuard,
  type Principal,
} from "../../src/modules/auth/auth.module.js";
import {
  CompatibilityPaymentController,
  CompatibilityPaymentService,
} from "../../src/modules/commerce/compatibility-payment.module.js";
import {
  CompatibilityZohoController,
  CompatibilityZohoService,
} from "../../src/modules/crm-sync/compatibility-zoho.module.js";
import { SyncQueue } from "../../src/modules/crm-sync/crm-sync.module.js";
import { ZohoAdapter } from "../../src/modules/integrations/integrations.module.js";
import {
  CompatibilityAdminController,
  CompatibilityAdminService,
  CompatibilityDashboardController,
} from "../../src/modules/management/compatibility-admin.module.js";

const testJwtSecret = "test-secret-that-is-at-least-32-characters";
const calls = new Map<string, number>();
const mark = (name: string) => {
  calls.set(name, (calls.get(name) ?? 0) + 1);
  return { success: true };
};

const adminStub = {
  createRole: () => mark("createRole"),
  updateRole: () => mark("updateRole"),
  manageRole: (_principal: Principal, _body: unknown, mode: string) =>
    mark(`manageRole:${mode}`),
  deleteRole: () => mark("deleteRole"),
  uploadCustomReport: () => mark("uploadCustomReport"),
  uploadKeyImpactAnalysis: () => mark("uploadKeyImpactAnalysis"),
  uploadBenefitsBestPractices: () => mark("uploadBenefitsBestPractices"),
  deleteAsset: (
    _principal: Principal,
    _id: string,
    kind: "customReport" | "keyImpactAnalysis",
  ) => mark(`deleteAsset:${kind}`),
  organizations: (_principal: Principal, reference: string | undefined) =>
    mark(reference ? "organization" : "organizations"),
  orderLogs: () => mark("orderLogs"),
  systemLogs: () => mark("systemLogs"),
  loginSessions: () => mark("loginSessions"),
  resortOrganization: () => mark("resortOrganization"),
  surveyInformation: () => mark("surveyInformation"),
};

const paymentStub = {
  paymentIntent: () => mark("paymentIntent"),
  checkout: () => mark("checkout"),
  confirmPaidOrder: () => mark("confirmPaidOrder"),
  reconcilePaidOrders: () => mark("reconcilePaidOrders"),
};

const zohoStub = {
  sync: (_principal: Principal, kind: string) => mark(`sync:${kind}`),
  listPrograms: () => {
    mark("listPrograms");
    return [];
  },
  listProgramsForProject: () => {
    mark("listProgramsForProject");
    return [];
  },
  listOrganizationsForProgram: () => {
    mark("listOrganizationsForProgram");
    return [];
  },
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
  controllers: [
    CompatibilityAdminController,
    CompatibilityDashboardController,
    CompatibilityPaymentController,
    CompatibilityZohoController,
  ],
  providers: [
    { provide: CompatibilityAdminService, useValue: adminStub },
    { provide: CompatibilityPaymentService, useValue: paymentStub },
    { provide: CompatibilityZohoService, useValue: zohoStub },
    TestJwtStrategy,
    JwtAuthGuard,
  ],
})
class CompatibilityEndpointsTestModule {}

async function createTestApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    CompatibilityEndpointsTestModule,
    new FastifyAdapter(),
    { logger: false },
  );
  app.setGlobalPrefix("api", {
    exclude: [
      { path: "admin/:one", method: RequestMethod.ALL },
      { path: "admin/:one/:two", method: RequestMethod.ALL },
      { path: "admin/:one/:two/:three", method: RequestMethod.ALL },
      { path: "dashboard/:one", method: RequestMethod.ALL },
      { path: "payment/:one", method: RequestMethod.ALL },
      { path: "zoho/:one", method: RequestMethod.ALL },
      { path: "zoho/:one/:two/:three", method: RequestMethod.ALL },
    ],
  });
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: "1",
  });
  await app.init();
  return app;
}

describe("native admin, payment and Zoho compatibility endpoints", () => {
  it("returns purchaser, payment, product and sorting details in order logs", async () => {
    const service = new CompatibilityAdminService(
      {
        order: {
          findMany: () =>
            Promise.resolve([
              {
                id: "order-id",
                legacyId: null,
                amountMinor: 42_500,
                currency: "USD",
                items: [
                  {
                    title: "Sorted Employee Verbatims Department",
                    keys: {
                      productId: "report-verbatims-sorted",
                      EV_Sorting_Filter: "Department",
                    },
                  },
                ],
                status: "PAID",
                paymentIntentId: "pi_test",
                createdAt: new Date("2026-08-31T12:00:00Z"),
                purchaser: {
                  username: "acme-buyer",
                  email: "buyer@acme.test",
                },
                organization: {
                  id: "organization-id",
                  legacyId: null,
                  name: "Acme Health",
                  metadata: {},
                },
                organizationProgram: {
                  id: "enrollment-id",
                  legacyId: null,
                  dealExternalId: null,
                  metrics: {},
                  program: {
                    id: "program-id",
                    legacyId: null,
                    name: "Feedback 2026",
                    metadata: {},
                  },
                },
                program: null,
                project: null,
              },
            ]),
          count: () => Promise.resolve(1),
        },
        $transaction: (operations: Array<Promise<unknown>>) =>
          Promise.all(operations),
      } as never,
      {} as never,
      {} as never,
    );

    const result = await service.orderLogs(
      {
        sub: "admin-id",
        organizationId: null,
        roles: ["admin"],
        permissions: ["orderLogAccess"],
      },
      1,
      10,
      "createdAt",
    );

    assert.deepEqual(
      result.data.map(
        ({
          productName,
          purchaserUsername,
          client,
          amount,
          currency,
          sortingFilter,
          programName,
        }) => ({
          productName,
          purchaserUsername,
          client,
          amount,
          currency,
          sortingFilter,
          programName,
        }),
      ),
      [
        {
          productName: "Sorted Employee Verbatims Department",
          purchaserUsername: "acme-buyer",
          client: "Acme Health",
          amount: 42_500,
          currency: "USD",
          sortingFilter: "Department",
          programName: "Feedback 2026",
        },
      ],
    );
  });

  it("confirms a successful card payment and grants Response Detail access", async () => {
    let updatedReportAccess: unknown;
    let updatedOrderStatus: unknown;
    const order = {
      id: "order-id",
      organizationId: "organization-id",
      status: "REQUIRES_PAYMENT",
      items: [
        {
          productId: "report-response-detail",
          title: "Response Detail Report",
          amount: 425,
          amountMinor: 42_500,
          keys: { productId: "report-response-detail" },
        },
      ],
      organizationProgram: {
        id: "enrollment-id",
        stage: "Closed",
        reportAccess: { RD_Access: "no" },
        metrics: {},
        paymentDetails: {},
        dealExternalId: null,
      },
    };
    const prisma = {
      order: {
        findUnique: (args: { include?: unknown }) =>
          Promise.resolve(
            args.include
              ? order
              : {
                  organizationId: order.organizationId,
                  status: order.status,
                },
          ),
        update: (args: { data: { status: unknown } }) => {
          updatedOrderStatus = args.data.status;
          return Promise.resolve({ id: order.id });
        },
      },
      organizationProgram: {
        update: (args: { data: { reportAccess: unknown } }) => {
          updatedReportAccess = args.data.reportAccess;
          return Promise.resolve({ id: "enrollment-id" });
        },
      },
      $transaction: (operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
    };
    const service = new CompatibilityPaymentService(
      prisma as never,
      {
        get: (key: string) =>
          key === "INTEGRATIONS_MOCK" ? false : "sk_test_example",
      } as never,
      {} as never,
    );
    Object.defineProperty(service, "stripe", {
      value: {
        paymentIntents: {
          retrieve: () => Promise.resolve({ status: "succeeded" }),
        },
      },
    });

    const result = await service.confirmPaidOrder(
      {
        sub: "client-id",
        organizationId: "organization-id",
        roles: ["client"],
        permissions: [],
      },
      { paymentIntentId: "pi_response_detail" },
    );

    assert.deepEqual(result, { success: true, status: "paid" });
    assert.deepEqual(updatedReportAccess, { RD_Access: "yes" });
    assert.equal(updatedOrderStatus, "PAID");
  });

  it("lists distinct program-local organization identities for client assignment", async () => {
    const enrollment = (id: string, name: string, year: number) => ({
      id,
      legacyId: null,
      externalId: `external-${id}`,
      dealExternalId: null,
      stage: "Closed",
      isWinner: false,
      reportAccess: {},
      paymentDetails: {},
      metadata: {},
      metrics: {
        Source_Organization_ID: "3",
        Source_Organization_Name: name,
      },
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      project: {
        id: `project-${year}`,
        legacyId: null,
        externalId: null,
        name: "Baton Rouge",
      },
      program: {
        id: `program-${year}`,
        legacyId: null,
        externalId: null,
        metadata: {},
        name: `Baton Rouge ${year}`,
        year,
        currency: "USD",
      },
    });
    const service = new CompatibilityAdminService(
      {
        organization: {
          findMany: () =>
            Promise.resolve([
              {
                id: "organization-id",
                legacyId: null,
                externalId: null,
                name: "AccuTemp Services",
                stripeCustomerId: null,
                metadata: {},
                createdAt: new Date("2026-01-01T00:00:00.000Z"),
                programs: [
                  enrollment("enrollment-2024", "AccuTemp Services", 2024),
                  enrollment("enrollment-2025", "Adams and Reese", 2025),
                  enrollment(
                    "enrollment-2026",
                    "Advanced Office Systems",
                    2026,
                  ),
                ],
                users: [],
              },
            ]),
        },
      } as never,
      {} as never,
      {} as never,
    );

    const response = await service.organizations({
      sub: "admin-id",
      organizationId: null,
      roles: ["admin"],
      permissions: [],
    });

    assert.deepEqual(
      response.data.map((organization) => ({
        selectionId: organization.selectionId,
        name: organization.sourceOrganizationName,
        programs: organization.orgPrograms.map(
          (entry) => entry.orgs.programId[0]?.Name,
        ),
      })),
      [
        {
          selectionId: "enrollment-2024",
          name: "AccuTemp Services",
          programs: ["Baton Rouge 2024"],
        },
        {
          selectionId: "enrollment-2025",
          name: "Adams and Reese",
          programs: ["Baton Rouge 2025"],
        },
        {
          selectionId: "enrollment-2026",
          name: "Advanced Office Systems",
          programs: ["Baton Rouge 2026"],
        },
      ],
    );
  });

  it("projects Zoho program records for the admin selector", async () => {
    const requestedFields = new Map<string, string[]>();
    const service = new CompatibilityZohoService(
      {} as SyncQueue,
      {
        listAllRecords: (module: string, fields: string[]) => {
          requestedFields.set(module, fields);
          return Promise.resolve(
            module === "Programs"
              ? [
                  {
                    id: "zoho-program-1",
                    Name: "Baton Rouge 2026",
                    Project: { id: "zoho-project-1", name: "Baton Rouge" },
                    Program_Year: "2026",
                    EFS_Launch_Date: "2026-01-15",
                    EFS_end_Date: "2026-04-30",
                    Boutique_EE_Size: "15-24",
                    Category_15_24_Fee: "$450",
                    Small_EE_Size: "25-99",
                    Category_25_99_Fee: "550",
                    Medium_EE_Size: "100-199",
                    Category_100_199_Fee: "650",
                    Large_EE_Size: "200-499",
                    Category_200_499_Fee: "750",
                    Mega_EE_Size: "500-999",
                    Category_500_999_Fee: "850",
                    Major_EE_Size: "1000+",
                    Category_1000_Fee: "950",
                  },
                ]
              : module === "Main_Projects"
                ? [
                    {
                      id: "zoho-project-1",
                      Name: "Baton Rouge",
                      Project_Abbreviation: "BR",
                    },
                  ]
                : [
                    {
                      id: "zoho-deal-1",
                      Program: {
                        id: "zoho-program-1",
                        name: "Baton Rouge 2026",
                      },
                      Account_Name: { id: "zoho-account-1", name: "Acme" },
                      Deal_Organization_ID: "49",
                      Deal_Name: "Acme - Baton Rouge",
                      Current_Year_Winner: "Yes",
                      Current_Year_Category: "Large",
                      Surveys_Sent: 125,
                    },
                    {
                      id: "zoho-deal-2",
                      Program: {
                        id: "zoho-program-1",
                        name: "Baton Rouge 2026",
                      },
                      Account_Name: { id: "zoho-account-2", name: "Beta" },
                      Deal_Organization_ID: "50",
                      Deal_Name: "Beta - Baton Rouge",
                      Current_Year_Winner: "No",
                      Current_Year_Category: "Small",
                      Surveys_Sent: 80,
                    },
                  ],
          );
        },
      } as unknown as ZohoAdapter,
    );

    const programs = await service.listPrograms({
      sub: "admin-id",
      organizationId: null,
      roles: ["admin"],
      permissions: [],
    });

    assert.deepEqual(programs, [
      {
        id: "zoho-program-1",
        name: "Baton Rouge 2026",
        year: 2026,
        projectId: "zoho-project-1",
        projectName: "Baton Rouge",
        projectAbbreviation: null,
        efsLaunchDate: "2026-01-15",
        efsDeadline: "2026-04-30",
        organizations: [],
        winnerOrganizations: [],
        categoryPricing: [
          { tier: "Boutique", employeeSize: "15-24", priceCents: 45_000 },
          { tier: "Small", employeeSize: "25-99", priceCents: 55_000 },
          { tier: "Medium", employeeSize: "100-199", priceCents: 65_000 },
          { tier: "Large", employeeSize: "200-499", priceCents: 75_000 },
          { tier: "Mega", employeeSize: "500-999", priceCents: 85_000 },
          { tier: "Major", employeeSize: "1000+", priceCents: 95_000 },
        ],
      },
    ]);
    assert.ok(requestedFields.get("Programs")?.includes("Program_Year"));
    assert.equal(requestedFields.has("Main_Projects"), false);
    assert.equal(requestedFields.has("Deals"), false);
  });

  it("loads only the programs for the selected Zoho project", async () => {
    const requestedCriteria: Array<{ module: string; criteria: string }> = [];
    const service = new CompatibilityZohoService(
      {} as SyncQueue,
      {
        searchAllRecords: (module: string, criteria: string) => {
          requestedCriteria.push({ module, criteria });
          return Promise.resolve(
            module === "Programs"
              ? [
                  {
                    id: "zoho-program-1",
                    Name: "Baton Rouge 2026",
                    Project: { id: "zoho-project-1", name: "Baton Rouge" },
                    Program_Year: "2026",
                  },
                ]
              : [],
          );
        },
      } as unknown as ZohoAdapter,
    );

    const programs = await service.listProgramsForProject(
      {
        sub: "admin-id",
        organizationId: null,
        roles: ["admin"],
        permissions: [],
      },
      "zoho-project-1",
    );

    assert.equal(programs.length, 1);
    assert.deepEqual(requestedCriteria, [
      {
        module: "Programs",
        criteria: "(Project:equals:zoho-project-1)",
      },
    ]);
  });

  it("loads deals for one program with the program-scoped equals criteria", async () => {
    const requested: Array<{
      module: string;
      criteria: string;
      fields: string[] | undefined;
    }> = [];
    const service = new CompatibilityZohoService(
      {} as SyncQueue,
      {
        searchAllRecords: (
          module: string,
          criteria: string,
          fields?: string[],
        ) => {
          requested.push({ module, criteria, fields });
          return Promise.resolve([
            {
              id: "zoho-deal-1",
              Program: { id: "zoho-program-1", name: "Baton Rouge 2026" },
              Deal_Organization_ID: 460737994,
              Deal_Name:
                "Acme-460737994-Best Places to Work in Baton Rouge 2026",
              Current_Year_Winner: "Yes",
              Current_Year_Category: "Large",
              Total_Number_of_Program_EEs: 200,
              Current_Year_Overall_Rank: "4",
              Current_Year_Category_Rank: "2",
              Surveys_Sent: 125,
              Unmapped_Custom_Field: "preserved",
            },
          ]);
        },
      } as unknown as ZohoAdapter,
    );

    const organizations = await service.listOrganizationsForProgram(
      {
        sub: "admin-id",
        organizationId: null,
        roles: ["admin"],
        permissions: [],
      },
      "zoho-program-1",
    );

    assert.equal(requested.length, 1);
    const request = requested[0];
    assert.ok(request);
    // searchAllRecords appends /search to the module path.
    assert.equal(request.module, "Deals");
    assert.equal(request.criteria, "(Program:equals:zoho-program-1)");
    assert.equal(request.fields, undefined);
    assert.deepEqual(organizations, [
      {
        id: "zoho-deal-1",
        Program: { id: "zoho-program-1", name: "Baton Rouge 2026" },
        Deal_Organization_ID: 460737994,
        Deal_Name: "Acme-460737994-Best Places to Work in Baton Rouge 2026",
        Current_Year_Winner: "Yes",
        Current_Year_Category: "Large",
        Total_Number_of_Program_EEs: 200,
        Current_Year_Overall_Rank: "4",
        Current_Year_Category_Rank: "2",
        Surveys_Sent: 125,
        Unmapped_Custom_Field: "preserved",
        organizationId: "460737994",
        organizationName: "Acme",
        isWinner: true,
        surveysSent: 125,
        stage: null,
        companySize: null,
        employeesCount: 200,
        currentYearCategory: "Large",
        overallRank: "4",
        categoryRank: "2",
      },
    ]);
  });

  it("serves the compatibility routes", async () => {
    const app = await createTestApp();
    calls.clear();
    const token = app.get(JwtService).sign({
      sub: "6c79998f-10bd-45af-bdd1-61e11b50297a",
      organizationId: "655a3b31-4141-4be4-a8eb-85120e18fb6f",
      roles: ["admin"],
      permissions: ["ops.manage"],
    } satisfies Principal);
    const headers = { authorization: `Bearer ${token}` };
    const json = { "content-type": "application/json", ...headers };
    try {
      const requests = [
        app.inject({
          method: "POST",
          url: "/admin/addrole",
          headers: json,
          payload: {},
        }),
        app.inject({
          method: "PUT",
          url: "/admin/updaterole",
          headers: json,
          payload: {},
        }),
        app.inject({
          method: "POST",
          url: "/admin/managerole",
          headers: json,
          payload: {},
        }),
        app.inject({
          method: "PUT",
          url: "/admin/managerole",
          headers: json,
          payload: {},
        }),
        app.inject({
          method: "DELETE",
          url: "/admin/deleterole",
          headers: json,
          payload: {},
        }),
        app.inject({
          method: "POST",
          url: "/admin/uploadCustomReport",
          headers,
        }),
        app.inject({
          method: "POST",
          url: "/admin/uploadKeyImpactAnalysis",
          headers,
        }),
        app.inject({
          method: "POST",
          url: "/admin/organization-programs/enrollment-1/benefits-best-practices",
          headers,
        }),
        app.inject({
          method: "DELETE",
          url: "/admin/keyImpactAnalysis/asset-1",
          headers,
        }),
        app.inject({
          method: "DELETE",
          url: "/admin/customReport/asset-1",
          headers,
        }),
        app.inject({
          method: "GET",
          url: "/admin/getOrganizations",
          headers,
        }),
        app.inject({
          method: "GET",
          url: "/admin/getOrganizations/org-1",
          headers,
        }),
        app.inject({ method: "GET", url: "/admin/order/log", headers }),
        app.inject({ method: "GET", url: "/admin/system/log", headers }),
        app.inject({ method: "GET", url: "/admin/loginSession/log", headers }),
        app.inject({
          method: "POST",
          url: "/admin/resortOrg",
          headers: json,
          payload: {},
        }),
        app.inject({
          method: "GET",
          url: "/dashboard/surveyinformation",
          headers,
        }),
        app.inject({
          method: "POST",
          url: "/payment/stripePaymentIntent",
          headers: json,
          payload: {},
        }),
        app.inject({
          method: "POST",
          url: "/payment/checkout",
          headers: json,
          payload: {},
        }),
        app.inject({
          method: "POST",
          url: "/payment/confirm",
          headers: json,
          payload: {},
        }),
        app.inject({
          method: "POST",
          url: "/payment/reconcile?selectedProgramId=program-1",
          headers: json,
          payload: {},
        }),
        app.inject({ method: "GET", url: "/zoho/syncProjects", headers }),
        app.inject({ method: "GET", url: "/zoho/syncPrograms", headers }),
        app.inject({
          method: "GET",
          url: "/zoho/syncOrganizations",
          headers,
        }),
        app.inject({ method: "GET", url: "/zoho/syncClients", headers }),
        app.inject({ method: "GET", url: "/zoho/programs", headers }),
        app.inject({
          method: "GET",
          url: "/zoho/projects/zoho-project-1/programs",
          headers,
        }),
      ];
      const responses = await Promise.all(requests);
      for (const response of responses) {
        assert.equal(response.statusCode, 200, response.body);
      }
      assert.deepEqual(Object.fromEntries(calls), {
        createRole: 1,
        updateRole: 1,
        "manageRole:add": 1,
        "manageRole:remove": 1,
        deleteRole: 1,
        uploadCustomReport: 1,
        uploadKeyImpactAnalysis: 1,
        uploadBenefitsBestPractices: 1,
        "deleteAsset:keyImpactAnalysis": 1,
        "deleteAsset:customReport": 1,
        organizations: 1,
        organization: 1,
        orderLogs: 1,
        systemLogs: 1,
        loginSessions: 1,
        resortOrganization: 1,
        surveyInformation: 1,
        paymentIntent: 1,
        checkout: 1,
        confirmPaidOrder: 1,
        reconcilePaidOrders: 1,
        "sync:Projects": 1,
        "sync:Programs": 1,
        "sync:Accounts": 1,
        "sync:Contacts": 1,
        listPrograms: 1,
        listProgramsForProject: 1,
      });
    } finally {
      await app.close();
    }
  });
});
