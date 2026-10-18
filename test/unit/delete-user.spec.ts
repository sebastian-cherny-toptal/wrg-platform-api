import { Injectable, Module, VersioningType } from "@nestjs/common";
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
import { nativeCompatibilityRoutes } from "../../src/config/native-routes.js";
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
const restoredReferences: string[] = [];
const hardRemovedReferences: string[][] = [];
const usersServiceStub = {
  hardRemoveDisabledUsers: (references: string[]) => {
    hardRemovedReferences.push(references);
    return Promise.resolve({ success: true, removedCount: references.length });
  },
  restore: (reference: string) => {
    restoredReferences.push(reference);
    return Promise.resolve({
      success: true,
      message: "User restored successfully",
    });
  },
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
      exclude: nativeCompatibilityRoutes,
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

      hardRemovedReferences.length = 0;
      for (const roles of [["admin"], ["super_admin"], ["manager"]]) {
        const token = jwt.sign({
          sub: "admin-id",
          organizationId: null,
          roles,
          permissions: [],
        } satisfies Principal);
        const result = await app.inject({
          method: "POST",
          url: "/user/hard-remove-disabled",
          headers: { authorization: `Bearer ${token}` },
          payload: { userIds: ["legacy-user-id"] },
        });
        assert.equal(
          result.statusCode,
          roles[0] === "manager" ? 403 : 200,
          result.body,
        );
      }
      for (const userIds of [[], ["duplicate", "duplicate"], [42]]) {
        const result = await app.inject({
          method: "POST",
          url: "/user/hard-remove-disabled",
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { userIds },
        });
        assert.equal(result.statusCode, 400, result.body);
      }
      const unauthenticatedRemoval = await app.inject({
        method: "POST",
        url: "/user/hard-remove-disabled",
        payload: { userIds: ["legacy-user-id"] },
      });
      assert.equal(unauthenticatedRemoval.statusCode, 401);
      assert.deepEqual(hardRemovedReferences, [
        ["legacy-user-id"],
        ["legacy-user-id"],
      ]);

      restoredReferences.length = 0;
      for (const roles of [["admin"], ["super_admin"]]) {
        const token = jwt.sign({
          sub: "admin-id",
          organizationId: null,
          roles,
          permissions: [],
        } satisfies Principal);
        const restored = await app.inject({
          method: "PUT",
          url: "/user/restore/legacy-user-id",
          headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(restored.statusCode, 200, restored.body);
        assert.equal(
          restored.json<{ message: string }>().message,
          "User restored successfully",
        );
      }
      const forbiddenRestore = await app.inject({
        method: "PUT",
        url: "/user/restore/legacy-user-id",
        headers: { authorization: `Bearer ${managerToken}` },
      });
      assert.equal(forbiddenRestore.statusCode, 403);
      const unauthenticatedRestore = await app.inject({
        method: "PUT",
        url: "/user/restore/legacy-user-id",
      });
      assert.equal(unauthenticatedRestore.statusCode, 401);
      assert.deepEqual(restoredReferences, [
        "legacy-user-id",
        "legacy-user-id",
      ]);
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

it("permanently deletes only disabled, non-protected accounts and rolls back incomplete batches", async () => {
  const id = "9df11436-1475-4a6d-b95f-f62476340547";
  let count = 2;
  let rolledBack = false;
  let deleteArgs: unknown;
  const transaction = {
    user: {
      deleteMany: (args: unknown) => {
        deleteArgs = args;
        return Promise.resolve({ count });
      },
    },
  };
  const prisma = {
    $transaction: async (
      operation: (client: typeof transaction) => Promise<unknown>,
    ) => {
      try {
        return await operation(transaction);
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    },
  } as unknown as PrismaService;
  const service = new UsersService(prisma, {} as UserInvitationMailer);
  const principal: Principal = {
    sub: "admin-id",
    organizationId: null,
    roles: ["admin"],
    permissions: [],
  };
  assert.deepEqual(
    await service.hardRemoveDisabledUsers([id, "legacy-user"], principal),
    { success: true, removedCount: 2 },
  );
  assert.deepEqual(deleteArgs, {
    where: {
      OR: [{ id: { in: [id] } }, { legacyId: { in: [id, "legacy-user"] } }],
      status: "DISABLED",
      id: { not: "admin-id" },
      roles: { none: { role: { key: "super_admin" } } },
    },
  });
  count = 1;
  await assert.rejects(
    service.hardRemoveDisabledUsers([id, "legacy-user"], principal),
    /No users were removed/u,
  );
  assert.equal(rolledBack, true);
  await assert.rejects(
    service.hardRemoveDisabledUsers([], principal),
    /Select at least one/u,
  );
});
