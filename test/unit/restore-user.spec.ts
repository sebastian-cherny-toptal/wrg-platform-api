import assert from "node:assert/strict";
import { it } from "node:test";
import type { PrismaService } from "../../src/database/prisma.service.js";
import type { UserInvitationMailer } from "../../src/modules/users/users.module.js";
import { UsersService } from "../../src/modules/users/users.module.js";

it("lists a deleted user, explains the username conflict, and restores the same account", async () => {
  const account = {
    id: "account-id",
    legacyId: "legacy-account",
    email: "old@example.com",
    username: "reserved",
    fullName: "Example User",
    status: "ACTIVE",
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    organization: null,
    sessions: [],
    roles: [],
    programs: [],
    projects: [],
  };
  let sessionsRevoked = false;
  const prisma = {
    user: {
      findFirst: () => Promise.resolve(account),
      findUnique: () => Promise.resolve(account),
      findMany: ({ where }: { where?: { status?: { not: string } } }) =>
        Promise.resolve(where?.status?.not === account.status ? [] : [account]),
      update: ({ data }: { data: { status: string } }) => {
        account.status = data.status;
        return Promise.resolve(account);
      },
      updateMany: ({
        where,
        data,
      }: {
        where: { id: string; status: string };
        data: { status: string };
      }) => {
        if (where.id !== account.id || where.status !== account.status)
          return Promise.resolve({ count: 0 });
        account.status = data.status;
        return Promise.resolve({ count: 1 });
      },
    },
    session: {
      updateMany: () => {
        sessionsRevoked = true;
        return Promise.resolve({ count: 1 });
      },
    },
    $transaction: (operation: (database: unknown) => unknown) =>
      operation(prisma),
  } as unknown as PrismaService;
  const service = new UsersService(prisma, {} as UserInvitationMailer);
  await service.delete("legacy-account");
  assert.equal(account.status, "DISABLED");
  assert.equal(sessionsRevoked, true);
  const disabled = (await service.list()).data[0];
  assert.ok(disabled, "Deleted accounts must remain visible in the admin list");
  assert.equal(disabled.status, "DISABLED");
  assert.equal(disabled.isActive, false);
  await assert.rejects(
    service.create({
      email: "new@example.com",
      fullName: "New User",
      username: " reserved ",
      roleId: "admin",
    }),
    /username belongs to a disabled account.*restore/i,
  );
  await service.restore("legacy-account");
  assert.equal(account.status, "ACTIVE");
  assert.equal(account.email, "old@example.com");
  assert.equal(sessionsRevoked, true);
  assert.equal((await service.list()).data[0]?.isActive, true);
  await assert.rejects(
    service.create({
      email: "new@example.com",
      fullName: "New User",
      username: "reserved",
      roleId: "admin",
    }),
    /^ConflictException: User already exists$/,
  );
});

it("restoration rejects missing accounts and leaves non-disabled accounts unchanged", async () => {
  let target: { id: string; status: string } | null = null;
  const updates: unknown[] = [];
  const prisma = {
    user: {
      findFirst: () => Promise.resolve(target),
      updateMany: (args: unknown) => {
        updates.push(args);
        return Promise.resolve({ count: 0 });
      },
    },
  } as unknown as PrismaService;
  const service = new UsersService(prisma, {} as UserInvitationMailer);
  await assert.rejects(service.restore("missing"), /User not found/);
  target = { id: "invited-account", status: "INVITED" };
  await service.restore("invited-account");
  assert.deepEqual(updates, [
    {
      where: { id: "invited-account", status: "DISABLED" },
      data: { status: "ACTIVE" },
    },
  ]);
});
