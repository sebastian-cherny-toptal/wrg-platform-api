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
import { hash } from "argon2";
import { ExtractJwt, Strategy } from "passport-jwt";
import {
  JwtAuthGuard,
  type Principal,
} from "../../src/modules/auth/auth.module.js";
import {
  AdminImpersonationController,
  ImpersonationExchangeController,
  ImpersonationService,
} from "../../src/modules/auth/impersonation.module.js";

const jwtSecret = "test-secret-that-is-at-least-32-characters";
const serviceStub = {
  eligibleUsers: () => ({ users: [{ id: "target", fullName: "Demo Client" }] }),
  start: () => ({ url: "http://client.test/admin-preview?grant=opaque" }),
  startUser: () => ({ url: "http://client.test/admin-preview?grant=user" }),
  exchange: () => ({
    accessToken: "preview-token",
    session: { impersonation: {} },
  }),
  revoke: () => ({ ok: true }),
};

@Injectable()
class TestJwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: jwtSecret,
    });
  }

  validate(payload: Principal): Principal {
    return payload;
  }
}

@Module({
  imports: [PassportModule, JwtModule.register({ secret: jwtSecret })],
  controllers: [AdminImpersonationController, ImpersonationExchangeController],
  providers: [
    { provide: ImpersonationService, useValue: serviceStub },
    TestJwtStrategy,
    JwtAuthGuard,
  ],
})
class ImpersonationRoutesTestModule {}

async function createTestApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    ImpersonationRoutesTestModule,
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
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  await app.init();
  return app;
}

describe("secure admin dashboard previews", () => {
  it("keeps grant creation and revocation authenticated while allowing one-time exchange", async () => {
    const app = await createTestApp();
    const token = app.get(JwtService).sign({
      sub: "6c79998f-10bd-45af-bdd1-61e11b50297a",
      organizationId: null,
      roles: ["admin"],
      permissions: ["previewClientsDashboardAccess"],
    } satisfies Principal);
    const headers = { authorization: `Bearer ${token}` };
    try {
      const unauthenticatedStart = await app.inject({
        method: "POST",
        url: "/admin/impersonations",
        payload: { organizationId: "org", programId: "program" },
      });
      assert.equal(unauthenticatedStart.statusCode, 401);

      const started = await app.inject({
        method: "POST",
        url: "/admin/impersonations",
        headers,
        payload: {
          organizationId: "org",
          programId: "program",
          targetUserId: "target",
        },
      });
      assert.equal(started.statusCode, 201, started.body);

      const userStarted = await app.inject({
        method: "POST",
        url: "/admin/impersonations/users/target",
        headers,
      });
      assert.equal(userStarted.statusCode, 201, userStarted.body);

      const missingTarget = await app.inject({
        method: "POST",
        url: "/admin/impersonations",
        headers,
        payload: { organizationId: "org", programId: "program" },
      });
      assert.equal(missingTarget.statusCode, 400, missingTarget.body);

      const unauthenticatedEligibleUsers = await app.inject({
        method: "GET",
        url: "/admin/impersonations/eligible-users?organizationId=org&programId=program",
      });
      assert.equal(unauthenticatedEligibleUsers.statusCode, 401);

      const eligibleUsers = await app.inject({
        method: "GET",
        url: "/admin/impersonations/eligible-users?organizationId=org&programId=program",
        headers,
      });
      assert.equal(eligibleUsers.statusCode, 200, eligibleUsers.body);
      assert.deepEqual(eligibleUsers.json(), {
        users: [{ id: "target", fullName: "Demo Client" }],
      });

      const exchanged = await app.inject({
        method: "POST",
        url: "/api/auth/impersonations/exchange",
        payload: { grant: "opaque" },
      });
      assert.equal(exchanged.statusCode, 200, exchanged.body);

      const unauthenticatedRevoke = await app.inject({
        method: "DELETE",
        url: "/api/auth/impersonations/current",
      });
      assert.equal(unauthenticatedRevoke.statusCode, 401);

      const revoked = await app.inject({
        method: "DELETE",
        url: "/api/auth/impersonations/current",
        headers,
      });
      assert.equal(revoked.statusCode, 200, revoked.body);
    } finally {
      await app.close();
    }
  });

  it("uses a real local administrator as the actor for bypassed requests", async () => {
    const actorId = "6c79998f-10bd-45af-bdd1-61e11b50297a";
    const targetId = "26547eb0-eb68-49a3-884c-3050a9f9c198";
    let lookedUpSyntheticId = false;
    let createdActorId = "";
    const prisma = {
      user: {
        findFirst: (input: { where: { id?: string; status?: string } }) => {
          lookedUpSyntheticId ||= input.where.id === "bypass-login-auth";
          return Promise.resolve(
            input.where.id === targetId
              ? { id: targetId, fullName: "Demo Client" }
              : input.where.status === "ACTIVE"
                ? { id: actorId, fullName: "Local Admin" }
                : null,
          );
        },
      },
      organization: {
        findFirst: () =>
          Promise.resolve({
            id: "05c31b96-357f-4617-b0b6-560602c82248",
            name: "Demo Organization",
          }),
      },
      program: {
        findFirst: () =>
          Promise.resolve({
            id: "c34c7df6-0755-448b-bcc0-7c7832ae4f98",
            name: "Demo Program",
          }),
      },
      organizationProgram: {
        findUnique: () =>
          Promise.resolve({
            id: "1541a2be-4503-4c75-9f9f-e8c77d08c2a4",
            isIncluded: true,
          }),
      },
      impersonationGrant: {
        create: (input: { data: { actorUserId: string } }) => {
          createdActorId = input.data.actorUserId;
          return Promise.resolve(input.data);
        },
      },
      auditLog: { create: (input: unknown) => Promise.resolve(input) },
      $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
    };
    const config = {
      get: () => "http://localhost:5173",
    };
    const service = new ImpersonationService(
      prisma as never,
      {} as never,
      config as never,
    );

    const result = await service.start(
      {
        sub: "bypass-login-auth",
        organizationId: null,
        roles: ["admin"],
        permissions: ["ops.manage"],
      },
      {
        organizationId: "05c31b96-357f-4617-b0b6-560602c82248",
        programId: "c34c7df6-0755-448b-bcc0-7c7832ae4f98",
        targetUserId: targetId,
      },
    );

    assert.equal(lookedUpSyntheticId, false);
    assert.equal(createdActorId, actorId);
    assert.match(
      result.url,
      /^http:\/\/localhost:5173\/admin-preview\?grant=/u,
    );
  });

  it("creates a user-scoped grant only for included assigned programs", async () => {
    let grantData: Record<string, unknown> | undefined;
    const prisma = {
      user: {
        findFirst: (input: { where: { id?: string } }) =>
          Promise.resolve(
            input.where.id === "target-id"
              ? {
                  id: "target-id",
                  fullName: "Portal User",
                  username: "portal-user",
                  email: "portal@example.test",
                  organization: { id: "org-id", name: "Organization" },
                  programs: [
                    { programId: "program-1" },
                    { programId: "program-2" },
                  ],
                }
              : {
                  id: "admin-id",
                  fullName: "Administrator",
                  username: "admin",
                  email: "admin@example.test",
                },
          ),
      },
      organizationProgram: {
        findMany: () =>
          Promise.resolve([
            { programId: "program-1" },
            { programId: "program-2" },
          ]),
      },
      impersonationGrant: {
        create: ({ data }: { data: Record<string, unknown> }) => {
          grantData = data;
          return Promise.resolve(data);
        },
      },
      auditLog: { create: (input: unknown) => Promise.resolve(input) },
      $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
    };
    const service = new ImpersonationService(
      prisma as never,
      {} as never,
      { get: () => "http://localhost:5173" } as never,
    );

    const result = await service.startUser(
      {
        sub: "admin-id",
        organizationId: null,
        roles: ["admin"],
        permissions: ["previewClientsDashboardAccess"],
      },
      "target-id",
    );

    assert.ok(grantData);
    assert.equal(grantData.scope, "USER");
    assert.equal(grantData.programId, null);
    assert.equal(grantData.targetUserId, "target-id");
    assert.match(result.url, /\/admin-preview\?grant=/u);
  });

  it("issues a program-scoped client identity with the target user's exact access", async () => {
    const secret = "single-use-preview-secret";
    const tokenHash = await hash(secret);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    let issuedPrincipal: Principal | undefined;
    let issuedLifetime = "";
    const prisma = {
      impersonationGrant: {
        findUnique: () =>
          Promise.resolve({
            id: "6c79998f-10bd-45af-bdd1-61e11b50297a",
            actorUserId: "7d89998f-10bd-45af-bdd1-61e11b50297b",
            targetUserId: "8e99998f-10bd-45af-bdd1-61e11b50297c",
            organizationId: "9fa9998f-10bd-45af-bdd1-61e11b50297d",
            programId: "afb9998f-10bd-45af-bdd1-61e11b50297e",
            scope: "PROGRAM",
            tokenHash,
            expiresAt,
            consumedAt: null,
            revokedAt: null,
            actor: {
              id: "7d89998f-10bd-45af-bdd1-61e11b50297b",
              fullName: "Administrator",
              status: "ACTIVE",
              roles: [
                {
                  role: {
                    key: "admin",
                    permissions: [
                      { permission: { key: "previewClientsDashboardAccess" } },
                    ],
                  },
                },
              ],
            },
            organization: {
              id: "9fa9998f-10bd-45af-bdd1-61e11b50297d",
              name: "Canonical Organization",
            },
            target: {
              id: "8e99998f-10bd-45af-bdd1-61e11b50297c",
              fullName: "Specific Client",
              email: "client@example.test",
              status: "ACTIVE",
              organizationId: "9fa9998f-10bd-45af-bdd1-61e11b50297d",
              organizationProgramId: "b0c9998f-10bd-45af-bdd1-61e11b50297f",
              roles: [
                { role: { key: "client", permissions: [] } },
                {
                  role: {
                    key: "admin",
                    permissions: [{ permission: { key: "ops.manage" } }],
                  },
                },
              ],
              programs: [
                {
                  program: {
                    id: "afb9998f-10bd-45af-bdd1-61e11b50297e",
                  },
                },
              ],
            },
          }),
        updateMany: () => Promise.resolve({ count: 1 }),
      },
      organizationProgram: {
        findMany: () =>
          Promise.resolve([
            {
              id: "b0c9998f-10bd-45af-bdd1-61e11b50297f",
              isWinner: null,
              reportAccess: {
                WFR_Access: "yes",
                benefitsBestPractices: "yes",
                RD_Access: "no",
              },
              metrics: {
                Source_Organization_Name: "Client-Facing Organization",
                KIA_Order_Status: "Purchased",
                SEV_Filter: "Leadership",
              },
              metadata: {},
              program: {
                id: "afb9998f-10bd-45af-bdd1-61e11b50297e",
                name: "2026 Program",
                year: 2026,
                currency: "USD",
              },
            },
          ]),
      },
    };
    const auth = {
      principalForUserId: () =>
        Promise.resolve({
          sub: "8e99998f-10bd-45af-bdd1-61e11b50297c",
          organizationId: "9fa9998f-10bd-45af-bdd1-61e11b50297d",
          roles: ["client", "admin"],
          permissions: ["ops.manage"],
        } satisfies Principal),
      issueAccessToken: (principal: Principal, lifetime: string) => {
        issuedPrincipal = principal;
        issuedLifetime = lifetime;
        return Promise.resolve("scoped-preview-token");
      },
    };
    const service = new ImpersonationService(
      prisma as never,
      auth as never,
      { get: () => false } as never,
    );

    const result = await service.exchange(
      `6c79998f-10bd-45af-bdd1-61e11b50297a.${secret}`,
    );

    assert.ok(issuedPrincipal);
    assert.ok(issuedPrincipal.impersonation);
    assert.deepEqual(issuedPrincipal.roles, ["client"]);
    assert.deepEqual(issuedPrincipal.permissions, []);
    assert.equal(issuedPrincipal.impersonation.scope, "program");
    assert.deepEqual(issuedPrincipal.impersonation.programIds, [
      "afb9998f-10bd-45af-bdd1-61e11b50297e",
    ]);
    assert.match(issuedLifetime, /^\d+s$/u);
    assert.equal(result.session.expiresAt, expiresAt.toISOString());
    const [program] = result.session.user.programs;
    assert.ok(program);
    assert.equal(program.accessMode, "client");
    assert.deepEqual(program.entitlements, {
      WFR_Access: "yes",
      EV_Access: "no",
      WBC_Access: "no",
      BBP_Access: "yes",
      RD_Access: "no",
      KIA_Access: "yes",
      SEV_Access: "no",
      CR_Access: "no",
    });
    assert.equal(program.organizationName, "Client-Facing Organization");
    assert.deepEqual(program.reportSelections, {
      SEV_Filter: "Leadership",
      KIA_Order_Status: "Purchased",
    });
  });

  it("impersonates a user with every assigned program and its own access", async () => {
    const secret = "user-impersonation-secret";
    const tokenHash = await hash(secret);
    let issuedPrincipal: Principal | undefined;
    const program = (id: string, year: number) => ({
      id,
      name: `Program ${year}`,
      year,
      currency: "USD",
    });
    const prisma = {
      impersonationGrant: {
        findUnique: () =>
          Promise.resolve({
            id: "grant-id",
            actorUserId: "admin-id",
            targetUserId: "target-id",
            organizationId: "organization-id",
            programId: null,
            scope: "USER",
            tokenHash,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
            consumedAt: null,
            revokedAt: null,
            actor: {
              id: "admin-id",
              fullName: "Administrator",
              status: "ACTIVE",
              roles: [
                {
                  role: {
                    key: "admin",
                    permissions: [
                      { permission: { key: "previewClientsDashboardAccess" } },
                    ],
                  },
                },
              ],
            },
            organization: { id: "organization-id", name: "Organization" },
            target: {
              id: "target-id",
              fullName: "Multi Program User",
              email: "multi@example.test",
              status: "ACTIVE",
              organizationId: "organization-id",
              organizationProgramId: "enrollment-2025",
              roles: [{ role: { key: "client", permissions: [] } }],
              programs: [
                { program: program("program-2025", 2025) },
                { program: program("program-2026", 2026) },
              ],
            },
          }),
        updateMany: () => Promise.resolve({ count: 1 }),
      },
      organizationProgram: {
        findMany: () =>
          Promise.resolve([
            {
              id: "enrollment-2025",
              isWinner: true,
              reportAccess: { WFR_Access: "yes", RD_Access: "no" },
              metrics: {},
              metadata: {},
              program: program("program-2025", 2025),
            },
            {
              id: "enrollment-2026",
              isWinner: false,
              reportAccess: { WFR_Access: "no", RD_Access: "yes" },
              metrics: {},
              metadata: {},
              program: program("program-2026", 2026),
            },
          ]),
      },
    };
    const auth = {
      principalForUserId: () =>
        Promise.resolve({
          sub: "target-id",
          organizationId: "organization-id",
          roles: ["client"],
          permissions: [],
        } satisfies Principal),
      issueAccessToken: (principal: Principal) => {
        issuedPrincipal = principal;
        return Promise.resolve("user-preview-token");
      },
    };
    const service = new ImpersonationService(
      prisma as never,
      auth as never,
      { get: () => false } as never,
    );

    const result = await service.exchange(`grant-id.${secret}`);

    assert.ok(issuedPrincipal?.impersonation);
    assert.equal(issuedPrincipal.impersonation.scope, "user");
    assert.deepEqual(issuedPrincipal.impersonation.programIds, [
      "program-2025",
      "program-2026",
    ]);
    assert.deepEqual(
      result.session.user.programs.map(({ id }) => id),
      ["program-2025", "program-2026"],
    );
    const [firstProgram, secondProgram] = result.session.user.programs;
    assert.ok(firstProgram);
    assert.ok(secondProgram);
    assert.equal(firstProgram.entitlements.WFR_Access, "yes");
    assert.equal(firstProgram.entitlements.RD_Access, "no");
    assert.equal(secondProgram.entitlements.WFR_Access, "no");
    assert.equal(secondProgram.entitlements.RD_Access, "yes");
  });
});
