import {
  Injectable,
  Module,
  RequestMethod,
  VersioningType,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule, PassportStrategy } from "@nestjs/passport";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../../src/database/prisma.service.js";
import { JwtAuthGuard, type Principal } from "../../src/modules/auth/auth.module.js";
import {
  AdminRoleGuard,
  UserInvitationMailer,
  UsersController,
  UsersService,
} from "../../src/modules/users/users.module.js";

const testJwtSecret = "test-secret-that-is-at-least-32-characters";
let listCalls = 0;
const usersServiceStub = {
  list: () => {
    listCalls += 1;
    return Promise.resolve({
      success: true,
      message: "success",
      data: [],
    });
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
  controllers: [UsersController],
  providers: [
    { provide: UsersService, useValue: usersServiceStub },
    TestJwtStrategy,
    JwtAuthGuard,
    AdminRoleGuard,
  ],
})
class ListUsersTestModule {}

describe("list users endpoint", () => {
  it("serves admin-only GET /user/list", async () => {
    const app = await NestFactory.create<NestFastifyApplication>(
      ListUsersTestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    app.setGlobalPrefix("api", {
      exclude: [{ path: "user/:one", method: RequestMethod.ALL }],
    });
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: "1",
    });

    try {
      await app.init();
      listCalls = 0;
      const jwt = app.get(JwtService);
      const adminToken = jwt.sign({
        sub: "6c79998f-10bd-45af-bdd1-61e11b50297a",
        organizationId: null,
        roles: ["admin"],
        permissions: [],
      } satisfies Principal);
      const managerToken = jwt.sign({
        sub: "9df11436-1475-4a6d-b95f-f62476340547",
        organizationId: null,
        roles: ["manager"],
        permissions: [],
      } satisfies Principal);

      const listed = await app.inject({
        method: "GET",
        url: "/user/list?expand=projects",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.equal(listed.statusCode, 200, listed.body);
      assert.equal(listed.json<{ success: boolean }>().success, true);
      assert.equal(listCalls, 1);

      const forbidden = await app.inject({
        method: "GET",
        url: "/user/list",
        headers: { authorization: `Bearer ${managerToken}` },
      });
      assert.equal(forbidden.statusCode, 403);
      assert.equal(listCalls, 1);
    } finally {
      await app.close();
    }
  });

  it("returns the safe compatibility projection from PostgreSQL", async () => {
    const prisma = {
      user: {
        findMany: () =>
          Promise.resolve([
            {
              id: "6c79998f-10bd-45af-bdd1-61e11b50297a",
              legacyId: "legacy-user-id",
              email: "person@example.com",
              username: "person",
              fullName: "Example Person",
              status: "ACTIVE",
              metadata: { mobile: "123", mfa: "email" },
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              updatedAt: new Date("2026-01-02T00:00:00.000Z"),
              roles: [
                {
                  role: {
                    id: "041c8098-7b6a-4492-b079-6e32dfcb5e63",
                    legacyId: "legacy-role-id",
                    key: "manager",
                  },
                },
              ],
              projects: [
                {
                  project: {
                    id: "ff606887-ae1f-4bca-afb2-de4b9dbce9fb",
                    legacyId: "legacy-project-id",
                    name: "Project One",
                  },
                },
              ],
            },
          ]),
      },
    } as unknown as PrismaService;
    const service = new UsersService(prisma, {} as UserInvitationMailer);

    const response = await service.list(
      "projects",
      "fullName,role,projects",
    );
    const user = response.data[0];
    assert.ok(user);
    assert.equal(user._id, "legacy-user-id");
    assert.equal(user.fullName, "Example Person");
    assert.equal(user.role, "manager");
    assert.equal("email" in user, false);
    const projects = user.projects as Array<{ Name: string }>;
    assert.equal(projects[0]?.Name, "Project One");
    assert.equal("passwordHash" in user, false);

    await assert.rejects(
      service.list(undefined, "passwordHash"),
      /unsupported user field/u,
    );
    await assert.rejects(
      service.list("roles"),
      /must be projects/u,
    );
  });
});
