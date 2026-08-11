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
  AdminImpersonationController,
  ImpersonationExchangeController,
  ImpersonationService,
} from "../../src/modules/auth/impersonation.module.js";

const jwtSecret = "test-secret-that-is-at-least-32-characters";
const serviceStub = {
  start: () => ({ url: "http://client.test/admin-preview?grant=opaque" }),
  exchange: () => ({ accessToken: "preview-token", session: { impersonation: {} } }),
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
        payload: { organizationId: "org", programId: "program" },
      });
      assert.equal(started.statusCode, 201, started.body);

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
        findUnique: async (input: { where: { id: string } }) => {
          lookedUpSyntheticId ||= input.where.id === "bypass-login-auth";
          return null;
        },
        findFirst: async (input: {
          where: { roles?: { some: { role: { key: string } } } };
        }) =>
          input.where.roles?.some.role.key === "admin"
            ? { id: actorId, fullName: "Local Admin" }
            : { id: targetId, fullName: "Demo Client" },
      },
      organization: {
        findFirst: async () => ({ id: "05c31b96-357f-4617-b0b6-560602c82248", name: "Demo Organization" }),
      },
      program: {
        findFirst: async () => ({ id: "c34c7df6-0755-448b-bcc0-7c7832ae4f98", name: "Demo Program" }),
      },
      organizationProgram: {
        findUnique: async () => ({ id: "1541a2be-4503-4c75-9f9f-e8c77d08c2a4" }),
      },
      impersonationGrant: {
        create: async (input: { data: { actorUserId: string } }) => {
          createdActorId = input.data.actorUserId;
          return input.data;
        },
      },
      auditLog: { create: async (input: unknown) => input },
      $transaction: async (operations: Promise<unknown>[]) =>
        Promise.all(operations),
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
      },
    );

    assert.equal(lookedUpSyntheticId, false);
    assert.equal(createdActorId, actorId);
    assert.match(result.url, /^http:\/\/localhost:5173\/admin-preview\?grant=/u);
  });
});
