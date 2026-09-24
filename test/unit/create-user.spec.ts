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
import {
  JwtAuthGuard,
  type Principal,
} from "../../src/modules/auth/auth.module.js";
import {
  AdminRoleGuard,
  UserInvitationMailer,
  UsersController,
  UsersService,
} from "../../src/modules/users/users.module.js";

const testJwtSecret = "test-secret-that-is-at-least-32-characters";
let createCalls = 0;
let lastCreateBody:
  | { email: string; fullName: string; username: string; roleId: string }
  | undefined;
const capturedCreateBody = () => lastCreateBody;
const usersServiceStub = {
  create: (body: {
    email: string;
    fullName: string;
    username: string;
    roleId: string;
  }) => {
    createCalls += 1;
    lastCreateBody = body;
    return Promise.resolve({
      success: true,
      message: "User created successfully",
      data: {
        id: "20ba2a76-1e0a-42a6-8f50-c3464beecfec",
        email: body.email,
        username: body.username,
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
      lastCreateBody = undefined;
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
          username: "example.person",
          roleId: "project-manager",
        },
      });
      assert.equal(created.statusCode, 200, created.body);
      assert.equal(created.json<{ success: boolean }>().success, true);
      assert.equal(createCalls, 1);
      assert.equal(capturedCreateBody()?.username, "example.person");

      const forbidden = await app.inject({
        method: "POST",
        url: "/user/create",
        headers: { authorization: `Bearer ${managerToken}` },
        payload: {
          email: "second@example.com",
          fullName: "Second Person",
          username: "second.person",
          roleId: "project-manager",
        },
      });
      assert.equal(forbidden.statusCode, 403);
      assert.equal(createCalls, 1);

      const invalid = await app.inject({
        method: "POST",
        url: "/user/create",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          fullName: "Missing Email",
          username: "missing.email",
          roleId: "project-manager",
        },
      });
      assert.equal(invalid.statusCode, 400);
      assert.equal(createCalls, 1);

      const missingUsername = await app.inject({
        method: "POST",
        url: "/user/create",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          email: "missing-username@example.com",
          fullName: "Missing Username",
          roleId: "project-manager",
        },
      });
      assert.equal(missingUsername.statusCode, 400);
      assert.equal(createCalls, 1);

      const missingRole = await app.inject({
        method: "POST",
        url: "/user/create",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          email: "missing-role@example.com",
          fullName: "Missing Role",
          username: "missing.role",
        },
      });
      assert.equal(missingRole.statusCode, 400);
      assert.equal(createCalls, 1);
    } finally {
      await app.close();
    }
  });

  it("normalizes the email and never stores or returns the plaintext password", async () => {
    let createdData: Record<string, unknown> | undefined;
    let deliveredPassword: string | undefined;
    let uniquenessLookup: Record<string, unknown> | undefined;
    const prisma = {
      user: {
        findUnique: (args: { where: Record<string, unknown> }) => {
          uniquenessLookup = args.where;
          return Promise.resolve(
            "email" in args.where ? { id: "existing-email-user-id" } : null,
          );
        },
        updateMany: () => Promise.resolve({ count: 0 }),
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
            username: "example.person",
            fullName: "Example Person",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
          });
        },
      },
      role: {
        findFirst: () =>
          Promise.resolve({
            id: "project-manager-role-id",
            key: "project-manager",
            name: "Project Manager",
          }),
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
      username: " example.person ",
      roleId: "project-manager",
      password: plaintextPassword,
    });

    assert.equal(response.data.email, "person@example.com");
    assert.equal(response.data.fullName, "Example Person");
    assert.equal(response.data.username, "example.person");
    assert.equal(deliveredPassword, undefined);
    assert.ok(createdData);
    assert.equal(createdData.status, "INVITED");
    assert.equal(createdData.username, "example.person");
    assert.deepEqual(uniquenessLookup, { username: "example.person" });
    assert.equal(typeof createdData.passwordHash, "string");
    assert.notEqual(createdData.passwordHash, plaintextPassword);
    assert.equal("password" in response.data, false);
  });

  it("creates promotional users without organization or program access", async () => {
    let createdData: Record<string, unknown> | undefined;
    const prisma = {
      user: {
        findUnique: () => Promise.resolve(null),
        create: ({ data }: { data: Record<string, unknown> }) => {
          createdData = data;
          return Promise.resolve({ id: "promotional-user-id" });
        },
        update: () =>
          Promise.resolve({
            id: "promotional-user-id",
            email: "promo@example.com",
            username: "promo.user",
            fullName: "Promo User",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
          }),
      },
      role: {
        findFirst: () =>
          Promise.resolve({
            id: "promotional-role-id",
            key: "promotional",
            name: "Promotional",
          }),
      },
    } as unknown as PrismaService;

    await new UsersService(prisma, {} as UserInvitationMailer).create({
      email: "promo@example.com",
      fullName: "Promo User",
      username: "promo.user",
      roleId: "promotional",
    });

    assert.ok(createdData);
    assert.equal("organizationId" in createdData, false);
    assert.equal("organizationProgramId" in createdData, false);
    assert.equal("programs" in createdData, false);
  });

  it("creates client users with organization and enrolled program access", async () => {
    let createdData: Record<string, unknown> | undefined;
    let updatedReportAccess: unknown;
    const prisma = {
      $transaction: (operation: (transaction: unknown) => unknown) =>
        operation(prisma),
      user: {
        findUnique: () => Promise.resolve(null),
        create: (args: { data: Record<string, unknown> }) => {
          createdData = args.data;
          return Promise.resolve({ id: "client-user-id" });
        },
        update: () =>
          Promise.resolve({
            id: "client-user-id",
            email: "client@example.com",
            username: "client.user",
            fullName: "Client User",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
          }),
      },
      role: {
        findFirst: () =>
          Promise.resolve({
            id: "client-role-id",
            key: "client",
            name: "Client",
          }),
      },
      organization: {
        findFirst: () => Promise.resolve(null),
        findMany: () =>
          Promise.resolve([
            {
              id: "organization-id",
              name: "Example Company",
              metadata: {},
              programs: [],
            },
          ]),
      },
      program: {
        findMany: () =>
          Promise.resolve([
            {
              id: "program-id",
              legacyId: "program-reference",
              externalId: null,
              name: "2026 Program",
              projectId: "project-id",
            },
          ]),
      },
      organizationProgram: {
        findFirst: () =>
          Promise.resolve({
            organization: {
              id: "organization-id",
              name: "Example Company",
              metadata: {},
              programs: [],
            },
          }),
        update: (args: { data: { reportAccess: unknown } }) => {
          updatedReportAccess = args.data.reportAccess;
          return Promise.resolve({ id: "organization-program-id" });
        },
        findMany: () =>
          Promise.resolve([
            {
              id: "organization-program-id",
              organizationId: "organization-id",
              programId: "program-id",
              projectId: "project-id",
              reportAccess: {
                WFR_Access: "no",
                RD_Access: "yes",
              },
              project: { id: "project-id", name: "Feedback Project" },
            },
          ]),
      },
    } as unknown as PrismaService;
    const mailer = {
      assertConfigured: () => undefined,
      sendWelcome: () => Promise.resolve(),
    } as unknown as UserInvitationMailer;

    const response = await new UsersService(prisma, mailer).create({
      email: "client@example.com",
      fullName: "Client User",
      username: "client.user",
      roleId: "client",
      organizationId: "organization-reference",
      programs: ["program-reference"],
    });

    assert.ok(createdData);
    assert.equal(createdData.organizationId, "organization-id");
    assert.equal(createdData.organizationProgramId, "organization-program-id");
    assert.deepEqual(createdData.roles, {
      create: [{ roleId: "client-role-id" }],
    });
    assert.deepEqual(createdData.projects, {
      create: [{ projectId: "project-id" }],
    });
    assert.deepEqual(createdData.programs, {
      create: [{ programId: "program-id" }],
    });
    assert.deepEqual(updatedReportAccess, {
      WFR_Access: "yes",
      EV_Access: "yes",
      WBC_Access: "yes",
      BBP_Access: "yes",
      RD_Access: "yes",
    });
    assert.deepEqual(response.data.projects, [
      { id: "project-id", name: "Feedback Project" },
    ]);
  });

  it("derives the organization and every program from enrollment references", async () => {
    let createdData: Record<string, unknown> | undefined;
    const entitlementUpdates: string[] = [];
    const enrollments = [2025, 2026].map((year) => ({
      id: `enrollment-${year}`,
      legacyId: null,
      externalId: null,
      organizationId: "artemis-id",
      programId: `program-${year}`,
      projectId: "project-id",
      purchasedEvSortingFilter: null,
      reportAccess: {},
      metrics: {},
      paymentDetails: {},
      project: { id: "project-id", name: "Workforce" },
      program: {
        id: `program-${year}`,
        name: `Awards ${year}`,
        projectId: "project-id",
      },
      organization: {
        id: "artemis-id",
        name: "Artemis",
        metadata: {},
        programs: [],
      },
    }));
    const artemisOrganization = enrollments[0]?.organization;
    assert.ok(artemisOrganization);
    const prisma = {
      $transaction: (operation: (transaction: unknown) => unknown) =>
        operation(prisma),
      user: {
        findUnique: () => Promise.resolve(null),
        create: ({ data }: { data: Record<string, unknown> }) => {
          createdData = data;
          return Promise.resolve({ id: "client-user-id" });
        },
        update: () =>
          Promise.resolve({
            id: "client-user-id",
            email: "client@example.com",
            username: "client.user",
            fullName: "Client User",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
          }),
        updateMany: () => Promise.resolve({ count: 0 }),
      },
      role: {
        findFirst: () =>
          Promise.resolve({ id: "client-role", key: "client", name: "Client" }),
      },
      program: { findMany: () => Promise.resolve([]) },
      organization: {
        findMany: () => Promise.resolve([artemisOrganization]),
      },
      organizationProgram: {
        findMany: (args: { where: Record<string, unknown> }) =>
          Promise.resolve("OR" in args.where ? enrollments : enrollments),
        update: ({ where }: { where: { id: string } }) => {
          entitlementUpdates.push(where.id);
          return Promise.resolve({ id: where.id });
        },
      },
    } as unknown as PrismaService;

    await new UsersService(prisma, {} as UserInvitationMailer).create({
      email: "client@example.com",
      fullName: "Client User",
      username: "client.user",
      roleId: "client",
      programs: ["enrollment-2025", "enrollment-2026"],
    });

    assert.ok(createdData);
    assert.equal(createdData.organizationId, "artemis-id");
    assert.equal(createdData.organizationProgramId, "enrollment-2025");
    assert.deepEqual(createdData.programs, {
      create: [{ programId: "program-2025" }, { programId: "program-2026" }],
    });
    assert.deepEqual(entitlementUpdates, [
      "enrollment-2025",
      "enrollment-2026",
    ]);
  });
});
