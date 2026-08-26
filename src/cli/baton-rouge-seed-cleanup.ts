import type { PrismaClient } from "@prisma/client";

const seedPrefix = "seed-br";
const testUsername = "test.baton";
const testUserEmail = "test.baton@example.test";
// Replacing a populated seed cascades through respondents and responses. The
// Prisma default for an interactive transaction is only five seconds, which is
// too short for the production dataset.
const cleanupTransactionTimeoutMs = 5 * 60 * 1_000;

export async function clearPreviousBatonRougeSeed(
  prisma: PrismaClient,
  log: (message: string) => void = console.log,
): Promise<void> {
  const organizationWhere = {
    externalId: { startsWith: `${seedPrefix}-org-` },
  } as const;

  const startedAt = Date.now();
  log(
    `Cleanup transaction starting (timeout=${cleanupTransactionTimeoutMs}ms).`,
  );
  await prisma.$transaction(
    async (transaction) => {
      // Order.organizationId is required and uses RESTRICT, so seeded test
      // orders must be removed before their seeded organizations can be replaced.
      log("Cleanup: deleting orders for seeded organizations...");
      const deletedOrders = await transaction.order.deleteMany({
        where: { organization: organizationWhere },
      });
      log(`Cleanup: deleted ${deletedOrders.count} order(s).`);

      log("Cleanup: deleting the seeded report user...");
      const deletedUsers = await transaction.user.deleteMany({
        where: {
          OR: [
            { externalId: `${seedPrefix}-user-${testUsername}` },
            { username: testUsername },
            { email: testUserEmail },
          ],
        },
      });
      log(`Cleanup: deleted ${deletedUsers.count} user(s).`);

      log("Cleanup: deleting the seeded project (database cascades begin)...");
      const deletedProjects = await transaction.project.deleteMany({
        where: { externalId: `${seedPrefix}-project` },
      });
      log(`Cleanup: deleted ${deletedProjects.count} project(s) and cascades.`);

      log("Cleanup: deleting seeded organizations...");
      const deletedOrganizations = await transaction.organization.deleteMany({
        where: organizationWhere,
      });
      log(
        `Cleanup: deleted ${deletedOrganizations.count} organization(s); committing transaction...`,
      );
    },
    { timeout: cleanupTransactionTimeoutMs },
  );
  log(`Cleanup transaction committed in ${Date.now() - startedAt}ms.`);
}
