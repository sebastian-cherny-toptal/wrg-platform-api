import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CompatibilityAdminService } from "../../src/modules/management/compatibility-admin.module.js";

const principal = {
  sub: "admin-id",
  organizationId: null,
  roles: ["admin"],
  permissions: [],
};

describe("bulk user catalog", () => {
  it("returns only matching data with canonical database identifiers", async () => {
    const service = new CompatibilityAdminService(
      {
        role: {
          findMany: () =>
            Promise.resolve([
              {
                id: "role-id",
                key: "client",
                name: "Client",
                _count: { users: 2 },
              },
            ]),
        },
        project: {
          findMany: () =>
            Promise.resolve([
              {
                id: "project-id",
                name: "Workforce",
                programs: [{ id: "program-id", name: "Awards", year: 2026 }],
              },
            ]),
        },
        organization: {
          findMany: () =>
            Promise.resolve([
              {
                id: "organization-id",
                name: "Stored account name",
                metadata: { sourceOrganizationName: "Metadata name" },
                programs: [
                  {
                    programId: "program-id",
                    metrics: {
                      Source_Organization_Name: "Acme",
                      CR_Access: "must not leak",
                    },
                  },
                ],
              },
            ]),
        },
        user: {
          findMany: () =>
            Promise.resolve([
              {
                id: "user-id",
                fullName: "Alex Example",
                email: "alex@example.com",
                username: "alex",
                status: "ACTIVE",
                metadata: {
                  mobile: "123",
                  stripeCustomerId: "must not leak",
                },
                organization: { id: "organization-id", name: "Acme" },
                roles: [{ role: { id: "role-id", key: "client" } }],
                projects: [
                  { project: { id: "project-id", name: "Workforce" } },
                ],
                programs: [
                  {
                    program: {
                      id: "program-id",
                      name: "Awards",
                      year: 2026,
                    },
                  },
                ],
              },
            ]),
        },
      } as never,
      {} as never,
      {} as never,
    );

    const response = await service.bulkUserCatalog(principal);

    assert.deepEqual(response, {
      success: true,
      data: {
        roles: [
          {
            id: "role-id",
            key: "client",
            name: "Client",
            userCount: 2,
          },
        ],
        projects: [
          {
            id: "project-id",
            name: "Workforce",
            programs: [{ id: "program-id", name: "Awards", year: 2026 }],
          },
        ],
        organizations: [
          {
            id: "organization-id",
            name: "Acme",
            programIds: ["program-id"],
          },
        ],
        users: [
          {
            id: "user-id",
            fullName: "Alex Example",
            email: "alex@example.com",
            username: "alex",
            mobile: "123",
            role: "client",
            roleId: "role-id",
            organization: { id: "organization-id", name: "Acme" },
            projects: [{ id: "project-id", name: "Workforce" }],
            programDetails: [{ id: "program-id", name: "Awards", year: 2026 }],
          },
        ],
      },
    });
    assert.equal(JSON.stringify(response).includes("CR_Access"), false);
    assert.equal(JSON.stringify(response).includes("stripeCustomerId"), false);
  });

  it("returns the same minimal organization projection scoped to Add User's project", async () => {
    let organizationQuery: Record<string, unknown> | undefined;
    const service = new CompatibilityAdminService(
      {
        project: {
          findFirst: () => Promise.resolve({ id: "project-id" }),
        },
        organization: {
          findMany: (query: Record<string, unknown>) => {
            organizationQuery = query;
            return Promise.resolve([
              {
                id: "organization-id",
                name: "Acme",
                metadata: {},
                programs: [
                  {
                    programId: "program-id",
                    metrics: { CR_Access: "must not leak" },
                  },
                ],
              },
            ]);
          },
        },
      } as never,
      {} as never,
      {} as never,
    );

    const response = await service.organizationOptions(
      principal,
      "external-project-id",
    );

    assert.deepEqual(response.data, [
      {
        id: "organization-id",
        name: "Acme",
        programIds: ["program-id"],
      },
    ]);
    assert.deepEqual(organizationQuery?.where, {
      programs: { some: { isIncluded: true, projectId: "project-id" } },
    });
    assert.equal(JSON.stringify(response).includes("CR_Access"), false);
  });
});
