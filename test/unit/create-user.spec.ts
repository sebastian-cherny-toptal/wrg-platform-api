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
import { PrismaService } from "../../src/database/prisma.service.js";
import { ExtractJwt, Strategy } from "passport-jwt";
import { JwtAuthGuard, type Principal } from "../../src/modules/auth/auth.module.js";
import {
  AdminRoleGuard,
  UserInvitationMailer,
  UsersController,
  UsersService,
} from "../../src/modules/users/users.module.js";

const testJwtSecret = "test-secret-that-is-at-least-32-characters";
let createCalls = 0;
const usersServiceStub = {
  create: (body: { email: string; fullName: string }) => {
    createCalls += 1;
    return Promise.resolve({
      success: true,
      message: "User created successfully",
      data: {
        id: "20ba2a76-1e0a-42a6-8f50-c3464beecfec",
        email: body.email,
        username: null,
        fullName: body.fullName,
        mobile: null,
        mfa: "email",
        status: "ACTIVE",
        role: null,
        projects: [],
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
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
class CreateUserTestModule {}

describe("create user endpoint", () => {
  it("serves admin-only POST /user/create with validated input", async () => {
    const app = await NestFactory.create<NestFastifyApplication>(
      CreateUserTestModule,
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
      createCalls = 0;
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

      const created = await app.inject({
        method: "POST",
        url: "/user/create",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          email: "person@example.com",
          fullName: "Example Person",
        },
      });
      assert.equal(created.statusCode, 200, created.body);
      assert.equal(created.json<{ success: boolean }>().success, true);
      assert.equal(createCalls, 1);

      const forbidden = await app.inject({
        method: "POST",
        url: "/user/create",
        headers: { authorization: `Bearer ${managerToken}` },
        payload: {
          email: "second@example.com",
          fullName: "Second Person",
        },
      });
      assert.equal(forbidden.statusCode, 403);
      assert.equal(createCalls, 1);

      const invalid = await app.inject({
        method: "POST",
        url: "/user/create",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { fullName: "Missing Email" },
      });
      assert.equal(invalid.statusCode, 400);
      assert.equal(createCalls, 1);
    } finally {
      await app.close();
    }
  });

  it("normalizes the email and never stores or returns the plaintext password", async () => {
    let createdData: Record<string, unknown> | undefined;
    let deliveredPassword: string | undefined;
    const prisma = {
      user: {
        findUnique: () => Promise.resolve(null),
        create: (args: { data: Record<string, unknown> }) => {
          createdData = args.data;
          return Promise.resolve({
            id: "20ba2a76-1e0a-42a6-8f50-c3464beecfec",
          });
        },
        update: () => {
          return Promise.resolve({
            id: "20ba2a76-1e0a-42a6-8f50-c3464beecfec",
            email: "person@example.com",
            username: null,
            fullName: "Example Person",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
          });
        },
      },
    } as unknown as PrismaService;
    const mailer = {
      assertConfigured: () => undefined,
      sendWelcome: (_email: string, password: string) => {
        deliveredPassword = password;
        return Promise.resolve();
      },
    } as unknown as UserInvitationMailer;
    const service = new UsersService(prisma, mailer);
    const plaintextPassword = "ProvidedSecret123!";

    const response = await service.create({
      email: " Person@Example.COM ",
      fullName: " Example Person ",
      password: plaintextPassword,
    });

    assert.equal(response.data.email, "person@example.com");
    assert.equal(response.data.fullName, "Example Person");
    assert.equal(deliveredPassword, plaintextPassword);
    assert.ok(createdData);
    assert.equal(createdData.status, "INVITED");
    assert.equal(typeof createdData.passwordHash, "string");
    assert.notEqual(createdData.passwordHash, plaintextPassword);
    assert.equal("password" in response.data, false);
  });
});
