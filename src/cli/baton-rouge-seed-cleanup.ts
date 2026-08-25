import type { PrismaClient } from "@prisma/client";

const seedPrefix = "seed-br";
const testUsername = "test.baton";
const testUserEmail = "test.baton@example.test";

export async function clearPreviousBatonRougeSeed(
  prisma: PrismaClient,
): Promise<void> {
  const organizationWhere = {
    externalId: { startsWith: `${seedPrefix}-org-` },
  } as const;

  await prisma.$transaction(async (transaction) => {
    // Order.organizationId is required and uses RESTRICT, so seeded test
    // orders must be removed before their seeded organizations can be replaced.
    await transaction.order.deleteMany({
      where: { organization: organizationWhere },
    });
    await transaction.user.deleteMany({
      where: {
        OR: [
          { externalId: `${seedPrefix}-user-${testUsername}` },
          { username: testUsername },
          { email: testUserEmail },
        ],
      },
    });
    await transaction.project.deleteMany({
      where: { externalId: `${seedPrefix}-project` },
    });
    await transaction.organization.deleteMany({
      where: organizationWhere,
    });
  });
}
