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
};

const zohoStub = {
  sync: (_principal: Principal, kind: string) => mark(`sync:${kind}`),
  listPrograms: () => {
    mark("listPrograms");
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
  it("projects Zoho program records for the admin selector", async () => {
    const service = new CompatibilityZohoService(
      {} as SyncQueue,
      {
        listAllRecords: () =>
          Promise.resolve([
            {
              id: "zoho-program-1",
              Name: "Baton Rouge 2026",
              Program_Year: "2026",
              EFS_Launch_Date: "2026-01-15",
              EFS_end_Date: "2026-04-30",
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

    assert.deepEqual(programs, [
      {
        id: "zoho-program-1",
        name: "Baton Rouge 2026",
        year: 2026,
        efsLaunchDate: "2026-01-15",
        efsDeadline: "2026-04-30",
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
        app.inject({ method: "GET", url: "/zoho/syncProjects", headers }),
        app.inject({ method: "GET", url: "/zoho/syncPrograms", headers }),
        app.inject({
          method: "GET",
          url: "/zoho/syncOrganizations",
          headers,
        }),
        app.inject({ method: "GET", url: "/zoho/syncClients", headers }),
        app.inject({ method: "GET", url: "/zoho/programs", headers }),
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
        "sync:Projects": 1,
        "sync:Programs": 1,
        "sync:Accounts": 1,
        "sync:Contacts": 1,
        listPrograms: 1,
      });
    } finally {
      await app.close();
    }
  });
});
