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
import { hash, verify } from "argon2";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExtractJwt, Strategy } from "passport-jwt";
import type { ConfigService } from "@nestjs/config";
import type { Env } from "../../src/config/env.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import {
  AuthService,
  JwtAuthGuard,
  type Principal,
} from "../../src/modules/auth/auth.module.js";
import {
  AccountAccessController,
  AccountAccessService,
  AccountRecoveryStore,
} from "../../src/modules/users/account-access.module.js";
import {
  AdminRoleGuard,
  UserInvitationMailer,
} from "../../src/modules/users/users.module.js";

const testJwtSecret = "test-secret-that-is-at-least-32-characters";
const calls = new Map<string, number>();
const count = (name: string) => {
  calls.set(name, (calls.get(name) ?? 0) + 1);
};

const accountAccessStub = {
  startManagementLogin: () => {
    count("start");
    return {
      success: true,
      message: "Login Successfully",
      data: { userId: "legacy-user", "2faVerified": false },
    };
  },
  completeManagementLogin: () => {
    count("complete");
    return {
      success: true,
      message: "Login Successful",
      data: {
        user: { id: "native-user" },
        accessToken: "access",
        refreshToken: "refresh",
      },
    };
  },
  registerTwoFactor: () => {
    count("register2fa");
    return { base32: "secret" };
  },
  validateTwoFactor: () => {
    count("validate2fa");
    return { verified: true };
  },
  requestAdminReset: () => {
    count("adminReset");
    return { success: true, message: "sent successfully" };
  },
  completeAdminReset: () => {
    count("adminResetVerify");
    return { success: true, message: "password changed successfully" };
  },
  requestForgotPassword: () => {
    count("forgotPasswordStart");
    return { success: true, message: "true", data: { key: "recovery-key" } };
  },
  completeForgotPassword: () => {
    count("forgotPasswordComplete");
    return { success: true, message: "password changed successfully" };
  },
  forgotUsername: () => {
    count("forgotUsername");
    return { success: true, message: "sent successfully" };
  },
  refresh: () => {
    count("refresh");
    return {
      message: "true",
      userId: "native-user",
      role: "admin",
      token: "new-access",
      refreshToken: "new-refresh",
    };
  },
  generateTemporaryPassword: () => {
    count("generateTemporaryPassword");
    return {
      success: true,
      message: "Temporary password generated",
      data: {
        username: "manager",
        email: "manager@example.com",
        temporaryPassword: "Temporary123!",
      },
    };
  },
  getTemporaryPassword: () => {
    count("getTemporaryPassword");
    return {
      success: true,
      data: {
        username: "manager",
        email: "manager@example.com",
        temporaryPassword: "Temporary123!",
      },
    };
  },
  changeTemporaryPassword: () => {
    count("changeTemporaryPassword");
    return { success: true, message: "Password changed successfully" };
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
  controllers: [AccountAccessController],
  providers: [
    { provide: AccountAccessService, useValue: accountAccessStub },
    TestJwtStrategy,
    JwtAuthGuard,
    AdminRoleGuard,
  ],
})
class AccountAccessTestModule {}

async function createTestApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AccountAccessTestModule,
    new FastifyAdapter(),
    { logger: false },
  );
  app.setGlobalPrefix("api", {
    exclude: [
      { path: "user/:one", method: RequestMethod.ALL },
      { path: "user/:one/:two", method: RequestMethod.ALL },
    ],
  });
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: "1",
  });
  await app.init();
  return app;
}

describe("native account access endpoints", () => {
  it("serves all ten former legacy routes with their compatibility methods", async () => {
    const app = await createTestApp();
    calls.clear();
    const jwt = app.get(JwtService);
    const adminToken = jwt.sign({
      sub: "6c79998f-10bd-45af-bdd1-61e11b50297a",
      organizationId: null,
      roles: ["admin"],
      permissions: [],
    } satisfies Principal);
    const authorization = { authorization: `Bearer ${adminToken}` };

    try {
      const requests = [
        app.inject({
          method: "POST",
          url: "/user/management/login",
          payload: {
            email: "admin@example.com",
            password: "Password123!",
          },
        }),
        app.inject({
          method: "PUT",
          url: "/user/management/login",
          payload: { userId: "legacy-user" },
        }),
        app.inject({
          method: "POST",
          url: "/user/management/register2fa",
          headers: authorization,
        }),
        app.inject({
          method: "POST",
          url: "/user/management/validate2fa",
          headers: authorization,
          payload: { token: "123456" },
        }),
        app.inject({
          method: "POST",
          url: "/user/admin-reset-password",
          headers: authorization,
          payload: { userId: "legacy-user" },
        }),
        app.inject({
          method: "PUT",
          url: "/user/admin-reset-password-verify",
          payload: { key: "reset-key", password: "NewPassword123!" },
        }),
        app.inject({
          method: "POST",
          url: "/user/forgot-password",
          payload: { email: "admin@example.com" },
        }),
        app.inject({
          method: "PUT",
          url: "/user/forgot-password",
          payload: {
            key: "recovery-key",
            otp: "123456",
            password: "NewPassword123!",
          },
        }),
        app.inject({
          method: "POST",
          url: "/user/forgot-username",
          payload: { email: "admin@example.com" },
        }),
        app.inject({
          method: "POST",
          url: "/user/refreshtoken",
          payload: { refreshToken: "refresh-token" },
        }),
      ];
      const responses = await Promise.all(requests);
      for (const response of responses) {
        assert.equal(response.statusCode, 200, response.body);
      }
      assert.deepEqual(Object.fromEntries(calls), {
        start: 1,
        complete: 1,
        register2fa: 1,
        validate2fa: 1,
        adminReset: 1,
        adminResetVerify: 1,
        forgotPasswordStart: 1,
        forgotPasswordComplete: 1,
        forgotUsername: 1,
        refresh: 1,
      });
    } finally {
      await app.close();
    }
  });

  it("keeps two-factor and administrator reset routes protected", async () => {
    const app = await createTestApp();
    try {
      const register = await app.inject({
        method: "POST",
        url: "/user/management/register2fa",
      });
      const validate = await app.inject({
        method: "POST",
        url: "/user/management/validate2fa",
        payload: { token: "123456" },
      });
      const reset = await app.inject({
        method: "POST",
        url: "/user/admin-reset-password",
        payload: { userId: "legacy-user" },
      });
      assert.equal(register.statusCode, 401);
      assert.equal(validate.statusCode, 401);
      assert.equal(reset.statusCode, 401);
    } finally {
      await app.close();
    }
  });

  it("serves the three native temporary-password routes with scoped access", async () => {
    const app = await createTestApp();
    calls.clear();
    const jwt = app.get(JwtService);
    const adminToken = jwt.sign({
      sub: "6c79998f-10bd-45af-bdd1-61e11b50297a",
      organizationId: null,
      roles: ["admin"],
      permissions: [],
    } satisfies Principal);
    const userToken = jwt.sign({
      sub: "9df11436-1475-4a6d-b95f-f62476340547",
      organizationId: null,
      roles: ["manager"],
      permissions: [],
    } satisfies Principal);

    try {
      const generated = await app.inject({
        method: "POST",
        url: "/user/admin-generate-temp-password",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { userId: "legacy-user" },
      });
      const fetched = await app.inject({
        method: "GET",
        url: "/user/get-temporary-password/legacy-user",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const changed = await app.inject({
        method: "POST",
        url: "/user/change-password-after-reset",
        headers: { authorization: `Bearer ${userToken}` },
        payload: { newPassword: "PermanentPassword123!" },
      });
      const forbidden = await app.inject({
        method: "GET",
        url: "/user/get-temporary-password/legacy-user",
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.equal(generated.statusCode, 200, generated.body);
      assert.equal(fetched.statusCode, 200, fetched.body);
      assert.equal(changed.statusCode, 200, changed.body);
      assert.equal(forbidden.statusCode, 403);
      assert.equal(calls.get("generateTemporaryPassword"), 1);
      assert.equal(calls.get("getTemporaryPassword"), 1);
      assert.equal(calls.get("changeTemporaryPassword"), 1);
    } finally {
      await app.close();
    }
  });

  it("validates recovery and login payloads before calling services", async () => {
    const app = await createTestApp();
    calls.clear();
    try {
      const login = await app.inject({
        method: "POST",
        url: "/user/management/login",
        payload: { email: "not-an-email", password: "short" },
      });
      const recovery = await app.inject({
        method: "PUT",
        url: "/user/forgot-password",
        payload: { key: "key", otp: "123", password: "short" },
      });
      const refresh = await app.inject({
        method: "POST",
        url: "/user/refreshtoken",
        payload: {},
      });
      assert.equal(login.statusCode, 400);
      assert.equal(recovery.statusCode, 400);
      assert.equal(refresh.statusCode, 400);
      assert.equal(calls.size, 0);
    } finally {
      await app.close();
    }
  });
});

describe("account recovery service", () => {
  it("emails the OTP but returns only the opaque recovery key", async () => {
    let stored:
      | {
          namespace: string;
          key: string;
          value: Record<string, string>;
          ttl: number;
        }
      | undefined;
    let emailText: string | undefined;
    const prisma = {
      user: {
        findFirst: () =>
          Promise.resolve({
            id: "6c79998f-10bd-45af-bdd1-61e11b50297a",
            email: "admin@example.com",
          }),
      },
    } as unknown as PrismaService;
    const auth = {} as AuthService;
    const recovery = {
      set: (
        namespace: string,
        key: string,
        value: Record<string, string>,
        ttl: number,
      ) => {
        stored = { namespace, key, value, ttl };
        return Promise.resolve();
      },
    } as unknown as AccountRecoveryStore;
    const mailer = {
      assertConfigured: () => undefined,
      send: (_email: string, _subject: string, text: string) => {
        emailText = text;
        return Promise.resolve();
      },
    } as unknown as UserInvitationMailer;
    const config = {} as ConfigService<Env, true>;
    const service = new AccountAccessService(
      prisma,
      auth,
      recovery,
      mailer,
      config,
    );

    const response = await service.requestForgotPassword({
      email: " Admin@Example.com ",
    });

    assert.equal(response.success, true);
    assert.equal(typeof response.data.key, "string");
    assert.ok(response.data.key.length >= 32);
    assert.equal("otp" in response.data, false);
    assert.ok(stored);
    assert.equal(stored.namespace, "forgot-password");
    assert.equal(stored.key, response.data.key);
    assert.equal(stored.ttl, 900);
    assert.match(stored.value.otp ?? "", /^\d{6}$/u);
    assert.equal(emailText, `Your OTP is: ${stored.value.otp}`);
  });

  it("hashes a verified replacement password, revokes sessions, and consumes the key", async () => {
    let passwordHash: string | undefined;
    let revokedUserId: string | undefined;
    let deletedKey: string | undefined;
    const userId = "6c79998f-10bd-45af-bdd1-61e11b50297a";
    const prisma = {
      user: {
        findUnique: () => Promise.resolve({ id: userId }),
      },
      $transaction: async (
        callback: (transaction: {
          user: {
            update: (args: {
              data: { passwordHash: string };
            }) => Promise<object>;
          };
          session: {
            updateMany: (args: {
              where: { userId: string };
            }) => Promise<object>;
          };
        }) => Promise<void>,
      ) =>
        callback({
          user: {
            update: (args) => {
              passwordHash = args.data.passwordHash;
              return Promise.resolve({});
            },
          },
          session: {
            updateMany: (args) => {
              revokedUserId = args.where.userId;
              return Promise.resolve({});
            },
          },
        }),
    } as unknown as PrismaService;
    const recovery = {
      get: () => Promise.resolve({ userId, otp: "123456" }),
      delete: (_namespace: string, key: string) => {
        deletedKey = key;
        return Promise.resolve();
      },
    } as unknown as AccountRecoveryStore;
    const service = new AccountAccessService(
      prisma,
      {} as AuthService,
      recovery,
      {} as UserInvitationMailer,
      {} as ConfigService<Env, true>,
    );

    await service.completeForgotPassword({
      key: "recovery-key",
      otp: "123456",
      password: "NewPassword123!",
    });

    assert.ok(passwordHash);
    assert.notEqual(passwordHash, "NewPassword123!");
    assert.equal(await verify(passwordHash, "NewPassword123!"), true);
    assert.equal(revokedUserId, userId);
    assert.equal(deletedKey, "recovery-key");
  });

  it("authenticates management users and issues tokens with native role claims", async () => {
    const passwordHash = await hash("Password123!");
    let issuedPrincipal: Principal | undefined;
    const user = {
      id: "6c79998f-10bd-45af-bdd1-61e11b50297a",
      legacyId: "legacy-user",
      organizationId: null,
      email: "admin@example.com",
      username: "admin",
      fullName: "Admin User",
      passwordHash,
      status: "ACTIVE" as const,
      mfaEnabled: false,
      metadata: {},
      roles: [
        {
          role: {
            id: "041c8098-7b6a-4492-b079-6e32dfcb5e63",
            legacyId: "legacy-role",
            key: "admin",
            permissions: [{ permission: { key: "users.manage" } }],
          },
        },
      ],
      projects: [],
    };
    const prisma = {
      user: {
        findUnique: () => Promise.resolve(user),
        findFirst: () => Promise.resolve(user),
      },
    } as unknown as PrismaService;
    const auth = {
      issueTokens: (principal: Principal) => {
        issuedPrincipal = principal;
        return Promise.resolve({
          accessToken: "native-access",
          refreshToken: "native-refresh",
        });
      },
    } as unknown as AuthService;
    const service = new AccountAccessService(
      prisma,
      auth,
      {} as AccountRecoveryStore,
      {} as UserInvitationMailer,
      {} as ConfigService<Env, true>,
    );

    const start = await service.startManagementLogin({
      email: " Admin@Example.com ",
      password: "Password123!",
    });
    const complete = await service.completeManagementLogin({
      userId: "legacy-user",
    });

    assert.equal(start.data.userId, "legacy-user");
    assert.equal(start.data["2faVerified"], false);
    assert.deepEqual(issuedPrincipal, {
      sub: user.id,
      organizationId: null,
      roles: ["admin"],
      permissions: ["users.manage"],
    });
    assert.equal(complete.data.accessToken, "native-access");
    assert.equal(complete.data.user.passwordHash, undefined);
    assert.deepEqual(complete.data.user.roleId, {
      _id: "legacy-role",
      id: "041c8098-7b6a-4492-b079-6e32dfcb5e63",
      role: "admin",
      permissions: ["users.manage"],
    });
  });

  it("keeps temporary credentials encrypted outside PostgreSQL and clears them after use", async () => {
    const userId = "6c79998f-10bd-45af-bdd1-61e11b50297a";
    let storedCredential: Record<string, string> | undefined;
    let persistedHash: string | undefined;
    let metadata: Record<string, unknown> = {};
    let deleted = false;
    const prisma = {
      user: {
        findFirst: () =>
          Promise.resolve({
            id: userId,
            email: "manager@example.com",
            username: "manager",
            metadata,
          }),
        findUnique: () => Promise.resolve({ id: userId, metadata }),
      },
      $transaction: async (
        callback: (transaction: {
          user: {
            update: (args: {
              data: {
                passwordHash: string;
                metadata: Record<string, unknown>;
              };
            }) => Promise<object>;
          };
          session: { updateMany: () => Promise<object> };
        }) => Promise<void>,
      ) =>
        callback({
          user: {
            update: (args) => {
              persistedHash = args.data.passwordHash;
              metadata = args.data.metadata;
              return Promise.resolve({});
            },
          },
          session: { updateMany: () => Promise.resolve({}) },
        }),
    } as unknown as PrismaService;
    const recovery = {
      set: (
        _namespace: string,
        _key: string,
        value: Record<string, string>,
      ) => {
        storedCredential = value;
        return Promise.resolve();
      },
      get: () => Promise.resolve(storedCredential ?? null),
      delete: () => {
        deleted = true;
        storedCredential = undefined;
        return Promise.resolve();
      },
    } as unknown as AccountRecoveryStore;
    const config = {
      get: () => "refresh-secret-that-is-at-least-32-characters",
    } as unknown as ConfigService<Env, true>;
    const service = new AccountAccessService(
      prisma,
      {} as AuthService,
      recovery,
      {} as UserInvitationMailer,
      config,
    );

    const generated = await service.generateTemporaryPassword("legacy-user");
    assert.ok(persistedHash);
    assert.equal(
      await verify(persistedHash, generated.data.temporaryPassword),
      true,
    );
    assert.equal(metadata.passwordChangeRequired, true);
    assert.ok(storedCredential);
    assert.equal(
      JSON.stringify(storedCredential).includes(
        generated.data.temporaryPassword,
      ),
      false,
    );

    const fetched = await service.getTemporaryPassword("legacy-user");
    assert.equal(
      fetched.data.temporaryPassword,
      generated.data.temporaryPassword,
    );

    await service.changeTemporaryPassword(
      {
        sub: userId,
        organizationId: null,
        roles: ["manager"],
        permissions: [],
      },
      "PermanentPassword123!",
    );
    assert.equal(metadata.passwordChangeRequired, false);
    assert.equal(deleted, true);
  });
});

describe("native refresh token rotation", () => {
  it("reissues full claims and revokes the consumed refresh session", async () => {
    const accessSecret = "access-secret-that-is-at-least-32-characters";
    const refreshSecret = "refresh-secret-that-is-at-least-32-characters";
    const userId = "6c79998f-10bd-45af-bdd1-61e11b50297a";
    const sessionId = "9df11436-1475-4a6d-b95f-f62476340547";
    const jwt = new JwtService();
    const oldRefreshToken = await jwt.signAsync(
      { sub: userId, sid: sessionId },
      {
        secret: refreshSecret,
        expiresIn: "1d",
        jwtid: sessionId,
      },
    );
    const oldRefreshTokenHash = await hash(oldRefreshToken);
    let revokedSessionId: string | undefined;
    let createdSessionUserId: string | undefined;
    const prisma = {
      session: {
        findUnique: () =>
          Promise.resolve({
            id: sessionId,
            userId,
            refreshTokenHash: oldRefreshTokenHash,
            expiresAt: new Date(Date.now() + 60_000),
            revokedAt: null,
            user: {
              id: userId,
              organizationId: null,
              status: "ACTIVE",
              roles: [
                {
                  role: {
                    key: "admin",
                    permissions: [{ permission: { key: "users.manage" } }],
                  },
                },
              ],
            },
          }),
        create: (args: { data: { userId: string } }) => {
          createdSessionUserId = args.data.userId;
          return Promise.resolve({});
        },
        update: (args: { where: { id: string } }) => {
          revokedSessionId = args.where.id;
          return Promise.resolve({});
        },
      },
    } as unknown as PrismaService;
    const config = {
      get: (key: keyof Env) => {
        const values: Partial<Env> = {
          JWT_ACCESS_SECRET: accessSecret,
          JWT_REFRESH_SECRET: refreshSecret,
          JWT_ACCESS_TTL: "15m",
          JWT_REFRESH_TTL_DAYS: 30,
        };
        return values[key];
      },
    } as ConfigService<Env, true>;
    const auth = new AuthService(prisma, jwt, config);

    const rotated = await auth.rotateRefreshToken(oldRefreshToken);
    const accessPayload = await jwt.verifyAsync<Principal>(
      rotated.accessToken,
      { secret: accessSecret },
    );

    assert.notEqual(rotated.refreshToken, oldRefreshToken);
    assert.equal(rotated.principal.sub, userId);
    assert.deepEqual(rotated.principal.roles, ["admin"]);
    assert.deepEqual(rotated.principal.permissions, ["users.manage"]);
    assert.deepEqual(accessPayload.roles, ["admin"]);
    assert.equal(createdSessionUserId, userId);
    assert.equal(revokedSessionId, sessionId);
  });
});
