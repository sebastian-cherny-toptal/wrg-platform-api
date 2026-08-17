import { Module, RequestMethod, VersioningType } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PrismaService } from "../../src/database/prisma.service.js";
import {
  AuthService,
  type Principal,
} from "../../src/modules/auth/auth.module.js";
import {
  ClientLoginController,
  ClientLoginService,
} from "../../src/modules/users/users.module.js";

let loginCalls = 0;
const clientLoginStub = {
  login: () => {
    loginCalls += 1;
    return Promise.resolve({
      success: true,
      message: "true",
      data: {
        userData: { username: "client-user" },
        accessToken: "access-token",
        refreshToken: "refresh-token",
        salesUser: [],
      },
    });
  },
};

@Module({
  controllers: [ClientLoginController],
  providers: [{ provide: ClientLoginService, useValue: clientLoginStub }],
})
class ClientLoginTestModule {}

describe("client login endpoint", () => {
  it("serves validated POST /user/login", async () => {
    const app = await NestFactory.create<NestFastifyApplication>(
      ClientLoginTestModule,
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
      loginCalls = 0;

      const loggedIn = await app.inject({
        method: "POST",
        url: "/user/login",
        payload: { username: "client-user" },
      });
      assert.equal(loggedIn.statusCode, 200, loggedIn.body);
      assert.equal(loggedIn.json<{ success: boolean }>().success, true);
      assert.equal(loginCalls, 1);

      const invalid = await app.inject({
        method: "POST",
        url: "/user/login",
        payload: {},
      });
      assert.equal(invalid.statusCode, 400);
      assert.equal(loginCalls, 1);
    } finally {
      await app.close();
    }
  });

  it("issues native tokens and returns the client compatibility payload", async () => {
    let clientLookup: unknown;
    let issuedPrincipal: Principal | undefined;
    let organizationUpdates = 0;
    let auditEntries = 0;
    const project = {
      id: "ff606887-ae1f-4bca-afb2-de4b9dbce9fb",
      legacyId: "legacy-project-id",
      name: "Project One",
    };
    const program = {
      id: "445a93e8-8b79-4213-b32d-b328ae739216",
      legacyId: "legacy-program-id",
      externalId: "external-program-id",
      name: "Program One",
      year: 2026,
      currency: "USD",
      fees: {},
      metadata: {},
    };
    const prisma = {
      user: {
        findFirst: (args: { where: Record<string, unknown> }) => {
          if ("username" in args.where) {
            clientLookup = args.where;
            return Promise.resolve({
              id: "6c79998f-10bd-45af-bdd1-61e11b50297a",
              legacyId: "legacy-user-id",
              email: "client@example.com",
              username: "client-user",
              fullName: "Client User",
              metadata: { mobile: "123" },
              organizationProgramId: "4b680987-e44e-4c9f-932d-29d340146973",
              organization: {
                id: "206ab572-1825-4327-81d7-a4c3524a938a",
                legacyId: "legacy-organization-id",
                externalId: "external-organization-id",
                name: "Organization One",
                metadata: {},
              },
              organizationProgram: {
                id: "4b680987-e44e-4c9f-932d-29d340146973",
                legacyId: "legacy-organization-program-id",
                dealExternalId: "deal-id",
                project,
              },
              roles: [
                {
                  role: {
                    id: "041c8098-7b6a-4492-b079-6e32dfcb5e63",
                    legacyId: "legacy-client-role-id",
                    key: "client",
                    permissions: [{ permission: { key: "reports.read" } }],
                  },
                },
              ],
              projects: [{ project }],
              programs: [{ program }],
            });
          }
          return Promise.resolve({
            id: "9df11436-1475-4a6d-b95f-f62476340547",
            legacyId: "legacy-sales-id",
            email: "sales@example.com",
            fullName: "Sales User",
          });
        },
      },
      organizationProgram: {
        findMany: () =>
          Promise.resolve([
            {
              id: "4b680987-e44e-4c9f-932d-29d340146973",
              legacyId: "legacy-organization-program-id",
              dealExternalId: "deal-id",
              stage: "active",
              reportAccess: { BBP_Access: "yes" },
              paymentDetails: {},
              project,
              program,
            },
          ]),
      },
      organization: {
        update: () => {
          organizationUpdates += 1;
          return Promise.resolve({ id: "organization-id" });
        },
      },
      auditLog: {
        create: () => {
          auditEntries += 1;
          return Promise.resolve({ id: "audit-id" });
        },
      },
    } as unknown as PrismaService;
    const auth = {
      issueTokens: (principal: Principal) => {
        issuedPrincipal = principal;
        return Promise.resolve({
          accessToken: "native-access-token",
          refreshToken: "native-refresh-token",
        });
      },
    } as unknown as AuthService;
    const service = new ClientLoginService(prisma, auth);

    const response = await service.login({
      username: " client-user ",
      userEmail: "viewer@example.com",
    });

    assert.match(JSON.stringify(clientLookup), /"key":"client"/u);
    assert.ok(issuedPrincipal);
    assert.deepEqual(issuedPrincipal.roles, ["client"]);
    assert.deepEqual(issuedPrincipal.permissions, ["reports.read"]);
    assert.equal(response.data.accessToken, "native-access-token");
    assert.equal(response.data.userData.username, "client-user");
    assert.equal(response.data.userData.role, "client");
    assert.equal("passwordHash" in response.data.userData, false);
    const organizationPrograms = response.data.userData
      .organizationProgram as Array<{
      programId: { _id: string };
      reportAccess: { BBP_Access: string };
    }>;
    const enrollment = organizationPrograms[0];
    assert.ok(enrollment);
    assert.equal(enrollment.programId._id, "legacy-program-id");
    assert.equal(enrollment.reportAccess.BBP_Access, "no");
    assert.equal(organizationUpdates, 1);
    assert.equal(auditEntries, 1);
  });
});
