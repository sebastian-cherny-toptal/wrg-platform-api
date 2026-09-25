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
  zohoOrganizationName,
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

describe("Zoho organization name parsing", () => {
  it("removes a numeric composite suffix even when the matched account ID differs", () => {
    assert.equal(
      zohoOrganizationName(
        "AAA Hoosier Motor Club-350392900-Best Places to Work in Indiana 2026",
        "zoho-account-id",
        "AAA Hoosier Motor Club",
      ),
      "AAA Hoosier Motor Club",
    );
  });
});

const adminStub = {
  createRole: () => mark("createRole"),
  updateRole: () => mark("updateRole"),
  manageRole: (_principal: Principal, _body: unknown, mode: string) =>
    mark(`manageRole:${mode}`),
  deleteRole: () => mark("deleteRole"),
  uploadKeyImpactAnalysis: () => mark("uploadKeyImpactAnalysis"),
  deleteKeyImpactAnalysis: () => mark("deleteKeyImpactAnalysis"),
  deleteCustomReport: () => mark("deleteCustomReport"),
  customReports: () => mark("customReports"),
  uploadCustomReport: () => mark("uploadCustomReport"),
  downloadCustomReport: (
    _principal: Principal,
    _id: string,
    reply: { send: (value: unknown) => unknown },
  ) => reply.send(mark("downloadCustomReport")),
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
  validateAchOrder: () => mark("validateAchOrder"),
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
    const sortingQuestionReference = "seed-br-question-2026-efs-0dbcf364a57f";
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
                    title: `Sorted Employee Verbatims ${sortingQuestionReference}`,
                    keys: {
                      productId: "report-verbatims-sorted",
                      EV_Sorting_Filter: sortingQuestionReference,
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
        question: {
          findMany: () =>
            Promise.resolve([
              {
                id: "00000000-0000-4000-8000-000000000001",
                legacyId: null,
                externalId: sortingQuestionReference,
                dataLabel: "f_personaldemographics_agegeneration",
                metadata: { categoryLabel: "Age Generation" },
              },
            ]),
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
          sortingFilterLabel,
          programName,
        }) => ({
          productName,
          purchaserUsername,
          client,
          amount,
          currency,
          sortingFilter,
          sortingFilterLabel,
          programName,
        }),
      ),
      [
        {
          productName: `Sorted Employee Verbatims ${sortingQuestionReference}`,
          purchaserUsername: "acme-buyer",
          client: "Acme Health",
          amount: 42_500,
          currency: "USD",
          sortingFilter: sortingQuestionReference,
          sortingFilterLabel: "Age Generation",
          programName: "Feedback 2026",
        },
      ],
    );
  });

  it("creates method-specific intents with server-priced ACH totals and rejects non-USD ACH", async () => {
    const created: Record<string, unknown>[] = [];
    const orders: Record<string, unknown>[] = [];
    const service = new CompatibilityPaymentService(
      {
        order: {
          create: ({ data }: { data: Record<string, unknown> }) => {
            orders.push(data);
            return Promise.resolve(data);
          },
        },
      } as never,
      {
        get: (key: string) =>
          key === "INTEGRATIONS_MOCK" ? false : "sk_test_example",
      } as never,
      {} as never,
    );
    Object.defineProperty(service, "context", {
      value: () =>
        Promise.resolve({
          organization: { id: "org", stripeCustomerId: "cus_test" },
          program: {
            id: "program",
            currency: "USD",
            metadata: {},
            fees: { "report-response-detail": 42500 },
          },
          enrollment: {
            id: "enrollment",
            metadata: {},
            fees: {},
            reportAccess: {},
            metrics: {},
            stage: "Full Package",
          },
        }),
    });
    Object.defineProperty(service, "stripe", {
      value: {
        paymentIntents: {
          create: (params: Record<string, unknown>) => {
            created.push(params);
            return Promise.resolve({
              id: `pi_${created.length}`,
              client_secret: "secret",
            });
          },
        },
      },
    });
    const principal = {
      sub: "client",
      organizationId: "org",
      roles: ["client"],
      permissions: [],
    };
    const body = {
      amount: 1,
      currency: "USD",
      items: [{ amount: 1, keys: { productId: "report-response-detail" } }],
    };
    await service.paymentIntent(
      principal,
      { ...body, paymentMethod: "ach" },
      "program",
    );
    await service.paymentIntent(principal, body, "program");
    assert.equal(created[0]?.amount, 42500);
    assert.deepEqual(created[0].payment_method_types, ["us_bank_account"]);
    assert.equal(orders[0]?.paymentMethod, "Paid via ACH");
    assert.equal(created[1]?.amount, 43775);
    assert.deepEqual(created[1].payment_method_types, ["card"]);
    await assert.rejects(
      service.paymentIntent(
        principal,
        { ...body, paymentMethod: "ach", currency: "CAD" },
        "program",
      ),
      /Currency must match the selected program/,
    );
    await assert.rejects(
      service.paymentIntent(
        principal,
        { ...body, paymentMethod: "invalid" },
        "program",
      ),
      /paymentMethod must be/,
    );
    assert.equal(created.length, 2);
  });

  it("rejects client invoice keys that would grant report access", async () => {
    let orderCreated = false;
    let enrollmentUpdated = false;
    const service = new CompatibilityPaymentService(
      {
        order: {
          create: () => {
            orderCreated = true;
            return Promise.resolve({});
          },
        },
        organizationProgram: {
          update: () => {
            enrollmentUpdated = true;
            return Promise.resolve({});
          },
        },
      } as never,
      { get: () => "sk_test_example" } as never,
      {} as never,
    );
    Object.defineProperty(service, "context", {
      value: () =>
        Promise.resolve({
          organization: {
            id: "organization-id",
            name: "Acme Health",
            stripeCustomerId: null,
          },
          program: {
            id: "program-id",
            currency: "USD",
            metadata: {},
            fees: {},
            zohoCategories: [],
          },
          enrollment: {
            id: "enrollment-id",
            projectId: "project-id",
            programId: "program-id",
            stage: "Closed",
            metadata: {},
            fees: {},
            reportAccess: {},
            paymentDetails: {},
            metrics: {},
            dealExternalId: null,
          },
        }),
    });

    await assert.rejects(
      service.checkout(
        {
          sub: "client-id",
          organizationId: "organization-id",
          roles: ["client"],
          permissions: [],
        },
        {
          total: 0.01,
          items: [
            {
              title: "Response Detail Report",
              amount: 0.01,
              keys: { RD_Access: "yes" },
            },
          ],
        },
        false,
        "program-id",
      ),
      /valid report product/u,
    );
    assert.equal(orderCreated, false);
    assert.equal(enrollmentUpdated, false);
  });

  it("rejects client-priced payment intents for report products", async () => {
    let intentCreated = false;
    let orderCreated = false;
    const service = new CompatibilityPaymentService(
      {
        order: {
          create: () => {
            orderCreated = true;
            return Promise.resolve({});
          },
        },
      } as never,
      {
        get: (key: string) =>
          key === "INTEGRATIONS_MOCK" ? false : "sk_test_example",
      } as never,
      {} as never,
    );
    Object.defineProperty(service, "context", {
      value: () =>
        Promise.resolve({
          organization: {
            id: "organization-id",
            name: "Acme Health",
            stripeCustomerId: "cus_test",
          },
          program: {
            id: "program-id",
            metadata: {},
            fees: { "report-response-detail": 42_500 },
            zohoCategories: [],
          },
          enrollment: {
            id: "enrollment-id",
            projectId: "project-id",
            programId: "program-id",
            stage: "Full Package",
            metadata: {},
            fees: {},
            reportAccess: {},
            metrics: {},
          },
        }),
    });
    Object.defineProperty(service, "stripe", {
      value: {
        paymentIntents: {
          create: () => {
            intentCreated = true;
            return Promise.resolve({
              id: "pi_client_priced",
              client_secret: "secret",
            });
          },
        },
      },
    });

    await assert.rejects(
      service.paymentIntent(
        {
          sub: "client-id",
          organizationId: "organization-id",
          roles: ["client"],
          permissions: [],
        },
        {
          amount: 0.01,
          currency: "USD",
          items: [
            { title: "Compatibility item", amount: 0.01, keys: {} },
            {
              title: "Response Detail Report",
              amount: 0,
              keys: { productId: "report-response-detail" },
            },
          ],
        },
        "program-id",
      ),
      /valid report product/u,
    );
    assert.equal(intentCreated, false);
    assert.equal(orderCreated, false);
  });

  for (const paymentMethod of ["Paid via Credit Card", "Paid via ACH"]) {
    it(`confirms ${paymentMethod} only after success and grants Response Detail access`, async () => {
      let updatedReportAccess: unknown;
      let updatedOrderStatus: unknown;
      let updatedPaymentDetails: unknown;
      let updatedPaymentMethod: unknown;
      let stripeStatus = "processing";
      const order = {
        id: "order-id",
        organizationId: "organization-id",
        status: "REQUIRES_PAYMENT",
        paymentMethod,
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
          update: (args: {
            data: { status: unknown; paymentMethod: unknown };
          }) => {
            updatedPaymentMethod = args.data.paymentMethod;
            updatedOrderStatus = args.data.status;
            return Promise.resolve({ id: order.id });
          },
        },
        organizationProgram: {
          update: (args: {
            data: { reportAccess: unknown; paymentDetails: unknown };
          }) => {
            updatedReportAccess = args.data.reportAccess;
            updatedPaymentDetails = args.data.paymentDetails;
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
            retrieve: () => Promise.resolve({ status: stripeStatus }),
          },
        },
      });

      await assert.rejects(
        service.confirmPaidOrder(
          {
            sub: "client-id",
            organizationId: "organization-id",
            roles: ["client"],
            permissions: [],
          },
          { paymentIntentId: "pi_response_detail" },
        ),
        /still processing/,
      );
      assert.equal(updatedReportAccess, undefined);
      assert.equal(updatedOrderStatus, undefined);
      stripeStatus = "succeeded";
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
      assert.equal(updatedPaymentMethod, paymentMethod);
      assert.deepEqual(updatedPaymentDetails, {
        RDR_Fee: 425,
        RDR_Payment: paymentMethod,
      });
    });
  }

  it("manually validates an ACH order and records the administrator", async () => {
    let orderUpdate: Record<string, unknown> | undefined;
    let audit: Record<string, unknown> | undefined;
    const service = new CompatibilityPaymentService(
      {
        order: {
          findFirst: () =>
            Promise.resolve({
              id: "79f90f66-4501-4b12-ac13-19cf797d3c44",
              legacyId: null,
              status: "REQUIRES_PAYMENT",
              paymentMethod: "Paid via ACH",
              paymentIntentId: "pi_ach_manual",
            }),
          findUnique: () =>
            Promise.resolve({
              id: "79f90f66-4501-4b12-ac13-19cf797d3c44",
              organizationProgram: null,
            }),
          update: ({ data }: { data: Record<string, unknown> }) => {
            orderUpdate = data;
            return Promise.resolve({});
          },
          updateMany: () => Promise.resolve({ count: 1 }),
        },
        auditLog: {
          create: ({ data }: { data: Record<string, unknown> }) => {
            audit = data;
            return Promise.resolve({});
          },
        },
      } as never,
      {
        get: (key: string) =>
          key === "INTEGRATIONS_MOCK" ? false : "sk_test_example",
      } as never,
      {} as never,
    );

    const result = await service.validateAchOrder(
      {
        sub: "admin-1",
        organizationId: null,
        roles: [],
        permissions: ["orderLogAccess"],
      },
      "79f90f66-4501-4b12-ac13-19cf797d3c44",
    );

    assert.deepEqual(result, {
      success: true,
      status: "paid",
      alreadyPaid: false,
    });
    assert.deepEqual(orderUpdate, { status: "PAID" });
    assert.ok(audit);
    assert.equal(audit.actorUserId, "admin-1");
    assert.equal(audit.action, "order.ach_payment_validated");
  });

  it("persists KIA ownership while the purchased report is awaiting upload", async () => {
    let enrollmentUpdate: Record<string, unknown> | undefined;
    const prisma = {
      order: {
        findUnique: () =>
          Promise.resolve({
            id: "kia-order-id",
            items: [
              {
                productId: "report-kia",
                title: "Key Impact Analysis",
                amount: 820,
                amountMinor: 82_000,
                keys: { productId: "report-kia" },
              },
            ],
            organizationProgram: {
              id: "enrollment-id",
              stage: "Full Package",
              reportAccess: { KIA_Access: "no" },
              metrics: {},
              paymentDetails: {},
              dealExternalId: null,
            },
          }),
        update: () => Promise.resolve({ id: "kia-order-id" }),
      },
      organizationProgram: {
        update: (args: { data: Record<string, unknown> }) => {
          enrollmentUpdate = args.data;
          return Promise.resolve({ id: "enrollment-id" });
        },
      },
      $transaction: (operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
    };
    const service = new CompatibilityPaymentService(
      prisma as never,
      { get: () => "sk_test_example" } as never,
      {} as never,
    );

    await service.fulfillPaidOrder("pi_kia");

    assert.ok(enrollmentUpdate);
    assert.deepEqual(enrollmentUpdate.reportAccess, { KIA_Access: "yes" });
    assert.deepEqual(enrollmentUpdate.metrics, {
      KIA_Order_Status: "Processing",
    });
  });

  it("lists distinct program-local organization identities for client assignment", async () => {
    const enrollment = (id: string, name: string, year: number) => ({
      id,
      legacyId: null,
      externalId: `external-${id}`,
      dealExternalId: null,
      stage: "Closed",
      isWinner: "N",
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

  it("scopes organization options to a project without repeating program metadata", async () => {
    let organizationQuery: Record<string, unknown> | undefined;
    const service = new CompatibilityAdminService(
      {
        project: {
          findFirst: () => Promise.resolve({ id: "database-project-id" }),
        },
        organization: {
          findMany: (query: Record<string, unknown>) => {
            organizationQuery = query;
            return Promise.resolve([
              {
                id: "organization-id",
                legacyId: null,
                externalId: null,
                name: "Artemis",
                stripeCustomerId: null,
                metadata: {},
                createdAt: new Date("2026-01-01T00:00:00.000Z"),
                programs: [
                  {
                    id: "enrollment-id",
                    legacyId: null,
                    externalId: null,
                    dealExternalId: null,
                    stage: "Closed",
                    isWinner: "N",
                    isIncluded: true,
                    employeesCount: 10,
                    overallRank: null,
                    categoryRank: null,
                    currentZohoCategory: "Small",
                    benchmarkCategory: "Small",
                    purchasedEvSortingFilter: null,
                    reportAccess: {},
                    paymentDetails: {},
                    metadata: {},
                    metrics: {
                      Source_Organization_ID: "artemis",
                      Source_Organization_Name: "Artemis",
                    },
                    createdAt: new Date("2026-01-01T00:00:00.000Z"),
                    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
                    project: {
                      id: "database-project-id",
                      legacyId: null,
                      externalId: "external-project-id",
                      name: "Workforce",
                    },
                    program: {
                      id: "program-id",
                      legacyId: null,
                      externalId: null,
                      metadata: {
                        benchmarkCategories: ["Small", "Large"],
                        reportCatalog: [{ id: "must-not-be-repeated" }],
                        surveyDefinition: { pages: ["large payload"] },
                      },
                      name: "Awards",
                      year: 2026,
                      currency: "USD",
                    },
                  },
                ],
                users: [],
              },
            ]);
          },
        },
      } as never,
      {} as never,
      {} as never,
    );

    const response = await service.organizations(
      {
        sub: "admin-id",
        organizationId: null,
        roles: ["admin"],
        permissions: [],
      },
      undefined,
      undefined,
      "external-project-id",
    );

    assert.ok(organizationQuery);
    assert.deepEqual(organizationQuery.where, {
      programs: { some: { projectId: "database-project-id" } },
    });
    assert.deepEqual(
      (organizationQuery.include as { programs: { where: unknown } }).programs
        .where,
      { projectId: "database-project-id" },
    );
    assert.deepEqual(response.data[0]?.orgPrograms[0]?.orgs.programId, [
      {
        _id: "program-id",
        id: "program-id",
        Name: "Awards",
        Program_Year: 2026,
        Currency: "USD",
      },
    ]);
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
                    Currency: "GBP",
                    EFS_Launch_Date: "2026-01-15",
                    EFS_end_Date: "2026-04-30",
                    Boutique_EE_Name: "Boutique",
                    Boutique_EE_Size: "15-24",
                    Category_15_24_Fee: "$450",
                    Small_EE_Name: "Small/Medium",
                    Small_EE_Size: "25-49",
                    Category_25_99_Fee: "550",
                    Medium_EE_Name: "Medium",
                    Medium_EE_Size: "100-199",
                    Category_100_199_Fee: "650",
                    Large_EE_Name: "Large",
                    Large_EE_Size: "200-499",
                    Category_200_499_Fee: "750",
                    Mega_EE_Name: "Mega",
                    Mega_EE_Size: "500-999",
                    Category_500_999_Fee: "850",
                    Major_EE_Name: "Major",
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
                      Alias_Name: "Acme - Baton Rouge",
                      Current_Year_Winner: "Yes",
                      Current_Year_Category: "Large",
                      Report_Category: "25-99",
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
                      Alias_Name: "Beta - Baton Rouge",
                      Current_Year_Winner: "No",
                      Current_Year_Category: "Small",
                      Report_Category: "100-199",
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
        currency: "GBP",
        projectId: "zoho-project-1",
        projectName: "Baton Rouge",
        projectAbbreviation: null,
        efsLaunchDate: "2026-01-15",
        efsDeadline: "2026-04-30",
        organizations: [],
        winnerOrganizations: [],
        benchmarkCategories: [
          "Boutique",
          "Small/Medium",
          "Medium",
          "Large",
          "Mega",
          "Major",
        ],
        categoryPricing: [
          {
            tier: "Boutique",
            pricingCategoryName: "15-24",
            priceCents: 45_000,
          },
          {
            tier: "Small",
            pricingCategoryName: "25-99",
            priceCents: 55_000,
          },
          {
            tier: "Medium",
            pricingCategoryName: "100-199",
            priceCents: 65_000,
          },
          {
            tier: "Large",
            pricingCategoryName: "200-499",
            priceCents: 75_000,
          },
          {
            tier: "Mega",
            pricingCategoryName: "500-999",
            priceCents: 85_000,
          },
          {
            tier: "Major",
            pricingCategoryName: "1000+",
            priceCents: 95_000,
          },
        ],
      },
    ]);
    assert.ok(requestedFields.get("Programs")?.includes("Program_Year"));
    assert.ok(requestedFields.get("Programs")?.includes("Currency"));
    assert.ok(requestedFields.get("Programs")?.includes("Small_EE_Name"));
    assert.equal(requestedFields.has("Main_Projects"), false);
    assert.equal(requestedFields.has("Deals"), false);
  });

  it("keeps Category List names separate from all six Pricing Information bands", async () => {
    const service = new CompatibilityZohoService(
      {} as SyncQueue,
      {
        listAllRecords: () =>
          Promise.resolve([
            {
              id: "indiana-2026",
              Name: "Indiana 2026",
              Program_Year: "2026",
              Boutique_EE_Name: "Small",
              Boutique_EE_Size: "15-34 US",
              Category_15_24_Fee: null,
              Small_EE_Name: "Small-Medium",
              Small_EE_Size: "35-74 US",
              Category_25_99_Fee: null,
              Medium_EE_Name: "Medium",
              Medium_EE_Size: "75-249 US",
              Category_100_199_Fee: null,
            },
            {
              id: "baton-rouge-2026",
              Name: "Baton Rouge 2026",
              Program_Year: "2026",
              Boutique_EE_Name: null,
              Boutique_EE_Size: null,
              Category_15_24_Fee: 1080,
              Small_EE_Name: "Small",
              Small_EE_Size: "15-49 US",
              Category_25_99_Fee: 1110,
            },
          ]),
      } as unknown as ZohoAdapter,
    );

    const programs = await service.listPrograms({
      sub: "admin-id",
      organizationId: null,
      roles: ["admin"],
      permissions: [],
    });

    assert.deepEqual(programs[0]?.benchmarkCategories, ["Small"]);
    assert.deepEqual(programs[0].categoryPricing, [
      {
        tier: "Boutique",
        pricingCategoryName: "15-24",
        priceCents: 108_000,
      },
      { tier: "Small", pricingCategoryName: "25-99", priceCents: 111_000 },
      { tier: "Medium", pricingCategoryName: "100-199", priceCents: null },
      { tier: "Large", pricingCategoryName: "200-499", priceCents: null },
      { tier: "Mega", pricingCategoryName: "500-999", priceCents: null },
      { tier: "Major", pricingCategoryName: "1000+", priceCents: null },
    ]);
    assert.deepEqual(programs[1]?.benchmarkCategories, [
      "Small",
      "Small-Medium",
      "Medium",
    ]);
    assert.deepEqual(programs[1].categoryPricing, [
      {
        tier: "Boutique",
        pricingCategoryName: "15-24",
        priceCents: null,
      },
      {
        tier: "Small",
        pricingCategoryName: "25-99",
        priceCents: null,
      },
      {
        tier: "Medium",
        pricingCategoryName: "100-199",
        priceCents: null,
      },
      { tier: "Large", pricingCategoryName: "200-499", priceCents: null },
      { tier: "Mega", pricingCategoryName: "500-999", priceCents: null },
      { tier: "Major", pricingCategoryName: "1000+", priceCents: null },
    ]);
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
              Alias_Name:
                "Acme-460737994-Best Places to Work in Baton Rouge 2026",
              Current_Year_Winner: "Yes",
              Current_Year_Category: "Large",
              Category_Online: "Category 25 – 99",
              Report_Category: "wrong-source",
              Total_Number_of_Program_EEs: 200,
              Current_Year_Overall_Rank: "4",
              Current_Year_Category_Rank: "2",
              Surveys_Sent: 125,
              EV_Sorting_Filter: "Department",
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
    assert.ok(request.fields?.includes("EV_Sorting_Filter"));
    assert.deepEqual(organizations, [
      {
        id: "zoho-deal-1",
        Program: { id: "zoho-program-1", name: "Baton Rouge 2026" },
        Deal_Organization_ID: 460737994,
        Alias_Name: "Acme-460737994-Best Places to Work in Baton Rouge 2026",
        Current_Year_Winner: "Yes",
        Current_Year_Category: "Large",
        Category_Online: "Category 25 – 99",
        Report_Category: "wrong-source",
        Total_Number_of_Program_EEs: 200,
        Current_Year_Overall_Rank: "4",
        Current_Year_Category_Rank: "2",
        Surveys_Sent: 125,
        EV_Sorting_Filter: "Department",
        Unmapped_Custom_Field: "preserved",
        organizationId: "460737994",
        organizationName: "Acme",
        isWinner: "Y",
        surveysSent: 125,
        stage: null,
        companySize: null,
        employeesCount: 200,
        currentZohoCategory: "Large",
        reportCategory: "25-99",
        overallRank: "4",
        categoryRank: "2",
        purchasedEvSortingFilter: "Department",
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
          url: "/admin/uploadKeyImpactAnalysis",
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
        app.inject({ method: "GET", url: "/admin/custom-reports", headers }),
        app.inject({ method: "POST", url: "/admin/custom-reports", headers }),
        app.inject({
          method: "GET",
          url: "/admin/custom-reports/asset-1/download",
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
        app.inject({
          method: "POST",
          url: "/admin/orders/order-1/validate-ach",
          headers,
        }),
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
      const removedCustomReportUpload = await app.inject({
        method: "POST",
        url: "/admin/uploadCustomReport",
        headers,
      });
      assert.equal(removedCustomReportUpload.statusCode, 404);
      const removedBenefitsUpload = await app.inject({
        method: "POST",
        url: "/admin/organization-programs/enrollment-1/benefits-best-practices",
        headers,
      });
      assert.equal(removedBenefitsUpload.statusCode, 404);
      assert.deepEqual(Object.fromEntries(calls), {
        createRole: 1,
        updateRole: 1,
        "manageRole:add": 1,
        "manageRole:remove": 1,
        deleteRole: 1,
        uploadKeyImpactAnalysis: 1,
        deleteKeyImpactAnalysis: 1,
        deleteCustomReport: 1,
        customReports: 1,
        uploadCustomReport: 1,
        downloadCustomReport: 1,
        organizations: 1,
        organization: 1,
        orderLogs: 1,
        validateAchOrder: 1,
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

it("uses Default when Zoho provides pricing but no benchmark Category List names", async () => {
  const service = new CompatibilityZohoService(
    {} as never,
    {
      listAllRecords: () =>
        Promise.resolve([
          {
            id: "no-categories",
            Name: "No categories",
            Small_EE_Size: "25-99",
            Category_25_99_Fee: "550",
          },
        ]),
    } as never,
  );
  const programs = await service.listPrograms({
    sub: "admin",
    roles: ["admin"],
    permissions: [],
    organizationId: null,
  });
  assert.deepEqual(programs[0]?.benchmarkCategories, ["Default"]);
  assert.equal(programs[0].categoryPricing[1]?.pricingCategoryName, "25-99");
});
