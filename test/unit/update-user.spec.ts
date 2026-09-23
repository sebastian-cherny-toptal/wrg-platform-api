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
let updateCalls = 0;
const usersServiceStub = {
  update: (
    userId: string,
    body: { fullName?: string },
    principal: Principal,
  ) => {
    updateCalls += 1;
    return Promise.resolve({
      success: true,
      message: "User updated successfully",
      data: {
        id: userId,
        email: "person@example.com",
        username: null,
        fullName: body.fullName ?? "Example Person",
        mobile: null,
        mfa: "email",
        status: "ACTIVE",
        role: null,
        projects: [],
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        actorId: principal.sub,
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
class UpdateUserTestModule {}

describe("update user endpoint", () => {
  it("serves authenticated PUT /user/update/:userId with validated input", async () => {
    const app = await NestFactory.create<NestFastifyApplication>(
      UpdateUserTestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    app.setGlobalPrefix("api", {
      exclude: [{ path: "user/:one/:two", method: RequestMethod.ALL }],
    });
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: "1",
    });

    try {
      await app.init();
      updateCalls = 0;
      const jwt = app.get(JwtService);
      const token = jwt.sign({
        sub: "6c79998f-10bd-45af-bdd1-61e11b50297a",
        organizationId: null,
        roles: ["manager"],
        permissions: [],
      } satisfies Principal);

      const updated = await app.inject({
        method: "PUT",
        url: "/user/update/6c79998f-10bd-45af-bdd1-61e11b50297a",
        headers: { authorization: `Bearer ${token}` },
        payload: { fullName: "Updated Person", programs: ["program-2026"] },
      });
      assert.equal(updated.statusCode, 200, updated.body);
      assert.equal(updated.json<{ success: boolean }>().success, true);
      assert.equal(updateCalls, 1);

      const unauthenticated = await app.inject({
        method: "PUT",
        url: "/user/update/6c79998f-10bd-45af-bdd1-61e11b50297a",
        payload: { fullName: "Updated Again" },
      });
      assert.equal(unauthenticated.statusCode, 401);
      assert.equal(updateCalls, 1);

      const invalid = await app.inject({
        method: "PUT",
        url: "/user/update/6c79998f-10bd-45af-bdd1-61e11b50297a",
        headers: { authorization: `Bearer ${token}` },
        payload: { password: "not-allowed" },
      });
      assert.equal(invalid.statusCode, 400);
      assert.equal(updateCalls, 1);
    } finally {
      await app.close();
    }
  });

  it("allows self updates and rejects updates to another user", async () => {
    let updateData: Record<string, unknown> | undefined;
    const targetId = "6c79998f-10bd-45af-bdd1-61e11b50297a";
    const prisma = {
      user: {
        findFirst: () =>
          Promise.resolve({
            id: targetId,
            metadata: { mobile: "123", mfa: "email" },
            roles: [],
          }),
        update: (args: { data: Record<string, unknown> }) => {
          updateData = args.data;
          return Promise.resolve({
            id: targetId,
            email: "person@example.com",
            username: null,
            fullName: "Updated Person",
            status: "ACTIVE",
            metadata: { mobile: "123", mfa: "email" },
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            roles: [],
            projects: [],
          });
        },
      },
    } as unknown as PrismaService;
    const mailer = {} as UserInvitationMailer;
    const service = new UsersService(prisma, mailer);
    const self: Principal = {
      sub: targetId,
      organizationId: null,
      roles: ["manager"],
      permissions: [],
    };

    const response = await service.update(
      targetId,
      { fullName: " Updated Person " },
      self,
    );
    assert.equal(response.data.fullName, "Updated Person");
    assert.ok(updateData);
    assert.equal(updateData.fullName, "Updated Person");

    await assert.rejects(
      service.update(
        targetId,
        { fullName: "Forbidden Change" },
        { ...self, sub: "9df11436-1475-4a6d-b95f-f62476340547" },
      ),
      /only update your own user/u,
    );
  });
});

describe("admin program assignments", () => {
  const targetId = "6c79998f-10bd-45af-bdd1-61e11b50297a";
  const admin: Principal = {
    sub: "admin",
    organizationId: null,
    roles: ["admin"],
    permissions: [],
  };
  function setup() {
    let saved: Record<string, unknown> | undefined;
    const prisma = {
      user: {
        findFirst: () =>
          Promise.resolve({
            id: targetId,
            metadata: {},
            roles: [],
            projects: [{ projectId: "project-1" }],
          }),
        update: (args: { data: Record<string, unknown> }) => {
          saved = args.data;
          return Promise.resolve({
            id: targetId,
            email: "person@example.com",
            username: null,
            fullName: "Person",
            status: "ACTIVE",
            metadata: {},
            createdAt: new Date(),
            roles: [],
            projects: [],
          });
        },
      },
      program: {
        findMany: (args: { where: { OR: Array<{ legacyId: string }> } }) =>
          Promise.resolve(
            args.where.OR.filter(({ legacyId }) => legacyId !== "missing").map(
              ({ legacyId }) => ({
                id: legacyId,
                projectId: legacyId === "outside" ? "project-2" : "project-1",
              }),
            ),
          ),
      },
    } as unknown as PrismaService;
    return {
      service: new UsersService(prisma, {} as UserInvitationMailer),
      saved: () => saved,
    };
  }
  it("saves different years together and allows removing assignments", async () => {
    const { service, saved } = setup();
    await service.update(targetId, { programs: ["2025", "2026"] }, admin);
    assert.deepEqual(saved()?.programs, {
      deleteMany: {},
      create: [{ programId: "2025" }, { programId: "2026" }],
    });
    await service.update(targetId, { programs: [] }, admin);
    assert.deepEqual(saved()?.programs, { deleteMany: {}, create: [] });
  });
  it("rejects programs outside assigned projects and unknown programs before saving", async () => {
    const { service, saved } = setup();
    await assert.rejects(
      service.update(targetId, { programs: ["outside"] }, admin),
      /assigned projects/u,
    );
    await assert.rejects(
      service.update(targetId, { programs: ["missing"] }, admin),
      /not found/u,
    );
    assert.equal(saved(), undefined);
  });
  it("prevents users assigning their own program access", async () => {
    const { service, saved } = setup();
    await assert.rejects(
      service.update(
        targetId,
        { programs: ["2026"] },
        { ...admin, sub: targetId, roles: ["client"] },
      ),
      /Only administrators/u,
    );
    assert.equal(saved(), undefined);
  });
});

describe("bulk-compatible client updates", () => {
  it("updates organization, Programs, Projects, role, and mobile together", async () => {
    let saved: Record<string, unknown> | undefined;
    const prisma = {
      user: {
        findFirst: (args: { where: Record<string, unknown> }) =>
          "email" in args.where
            ? Promise.resolve(null)
            : Promise.resolve({
                id: "user-1",
                organizationId: "org-1",
                organizationProgramId: "enrollment-old",
                metadata: { mobile: "111" },
                projects: [{ projectId: "project-1" }],
                programs: [{ programId: "program-1" }],
                roles: [{ role: { id: "client-role", key: "client" } }],
              }),
        update: ({ data }: { data: Record<string, unknown> }) => {
          saved = data;
          return Promise.resolve({
            id: "user-1",
            email: "alex@example.com",
            username: "alex",
            fullName: "Alex Updated",
            status: "ACTIVE",
            metadata: { mobile: "222", mfa: "email" },
            createdAt: new Date(),
            roles: [
              { role: { id: "client-role", key: "client", name: "Client" } },
            ],
            projects: [{ project: { id: "project-1", name: "Workforce" } }],
          });
        },
      },
      role: {
        findFirst: () =>
          Promise.resolve({ id: "client-role", key: "client", name: "Client" }),
      },
      program: {
        findMany: (args: {
          where: { OR: Array<{ id?: string; legacyId?: string }> };
        }) =>
          Promise.resolve(
            args.where.OR.flatMap((reference) => {
              const id = reference.id ?? reference.legacyId ?? "";
              return id === "missing-program"
                ? []
                : [{ id, projectId: "project-1" }];
            }),
          ),
      },
      organization: {
        findFirst: () => Promise.resolve({ id: "org-2" }),
      },
      organizationProgram: {
        findMany: () =>
          Promise.resolve([
            {
              id: "enrollment-1",
              programId: "program-1",
              projectId: "project-1",
            },
            {
              id: "enrollment-2",
              programId: "program-2",
              projectId: "project-1",
            },
          ]),
      },
    } as unknown as PrismaService;
    const service = new UsersService(prisma, {} as UserInvitationMailer);

    await service.update(
      "user-1",
      {
        fullName: "Alex Updated",
        email: "alex@example.com",
        username: "alex",
        mobile: "222",
        roleId: "client-role",
        organizationId: "org-2",
        programs: ["program-1", "program-2"],
      },
      {
        sub: "admin-1",
        organizationId: null,
        roles: ["admin"],
        permissions: [],
      },
    );

    assert.ok(saved);
    assert.deepEqual(saved.organization, { connect: { id: "org-2" } });
    assert.deepEqual(saved.organizationProgram, {
      connect: { id: "enrollment-1" },
    });
    assert.deepEqual(saved.programs, {
      deleteMany: {},
      create: [{ programId: "program-1" }, { programId: "program-2" }],
    });
    assert.deepEqual(saved.projects, {
      deleteMany: {},
      create: [{ projectId: "project-1" }],
    });
    assert.deepEqual(saved.metadata, { mobile: "222" });

    await assert.rejects(
      service.update(
        "user-1",
        {
          roleId: "client-role",
          organizationId: "org-2",
          programs: ["missing-program"],
        },
        {
          sub: "admin-1",
          organizationId: null,
          roles: ["admin"],
          permissions: [],
        },
      ),
      /programs were not found/u,
    );
  });
});
