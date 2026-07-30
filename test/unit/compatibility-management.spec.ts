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
  it("serves the six migrated administration routes", async () => {
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
        permissions: 1,
      });
    } finally {
      await app.close();
    }
  });

  it("maps normalized roles to the legacy administration projection", async () => {
    const prisma = {
      role: {
        findMany: () =>
          Promise.resolve([
            {
              id: "role-id",
              legacyId: "legacy-role",
              key: "project-manager",
              name: "Project Manager",
              _count: { users: 3 },
            },
          ]),
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
    ]);
  });
});
