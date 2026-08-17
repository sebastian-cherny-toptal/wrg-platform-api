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
let deleteCalls = 0;
const usersServiceStub = {
  delete: () => {
    deleteCalls += 1;
    return Promise.resolve({
      success: true,
      message: "User deleted successfully",
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
class DeleteUserTestModule {}

describe("delete user endpoint", () => {
  it("serves admin-only DELETE /user/delete/:userId", async () => {
    const app = await NestFactory.create<NestFastifyApplication>(
      DeleteUserTestModule,
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
      deleteCalls = 0;
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

      const deleted = await app.inject({
        method: "DELETE",
        url: "/user/delete/9df11436-1475-4a6d-b95f-f62476340547",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.equal(deleted.statusCode, 200, deleted.body);
      assert.equal(deleted.json<{ success: boolean }>().success, true);
      assert.equal(deleteCalls, 1);

      const forbidden = await app.inject({
        method: "DELETE",
        url: "/user/delete/9df11436-1475-4a6d-b95f-f62476340547",
        headers: { authorization: `Bearer ${managerToken}` },
      });
      assert.equal(forbidden.statusCode, 403);
      assert.equal(deleteCalls, 1);
    } finally {
      await app.close();
    }
  });

  it("disables users, revokes sessions, and protects the Super Admin", async () => {
    let targetRole = "manager";
    let disabledUserId: string | undefined;
    let revokedUserId: string | undefined;
    const targetId = "9df11436-1475-4a6d-b95f-f62476340547";
    const transaction = {
      session: {
        updateMany: (args: { where: { userId: string } }) => {
          revokedUserId = args.where.userId;
          return Promise.resolve({ count: 1 });
        },
      },
      user: {
        update: (args: { where: { id: string }; data: { status: string } }) => {
          disabledUserId =
            args.data.status === "DISABLED" ? args.where.id : undefined;
          return Promise.resolve({ id: args.where.id });
        },
      },
    };
    const prisma = {
      user: {
        findFirst: () =>
          Promise.resolve({
            id: targetId,
            roles: [{ role: { key: targetRole } }],
          }),
      },
      $transaction: (
        operation: (client: typeof transaction) => Promise<void>,
      ) => operation(transaction),
    } as unknown as PrismaService;
    const service = new UsersService(prisma, {} as UserInvitationMailer);

    const response = await service.delete(targetId);
    assert.equal(response.success, true);
    assert.equal(disabledUserId, targetId);
    assert.equal(revokedUserId, targetId);

    targetRole = "super_admin";
    await assert.rejects(
      service.delete(targetId),
      /Super Admin user cannot be deleted/u,
    );
  });
});
