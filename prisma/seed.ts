import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

async function main(): Promise<void> {
  const permissions = await Promise.all(
    [
      "ops.manage",
      "reports.read",
      "commerce.manage",
      "clientsProjectsProgramsAccess",
      "syncCheckmartketAndZohoAccess",
      "previewClientsDashboardAccess",
      "exportReportsAccess",
      "uploadDownloadCustomReportAccess",
      "uploadKeyImpactAnalysisAccess",
      "orderLogAccess",
    ].map((key) =>
      prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, description: key },
      }),
    ),
  );
  const administratorRoles = await Promise.all([
    prisma.role.upsert({
      where: { key: "super_admin" },
      update: { name: "Super Admin" },
      create: { key: "super_admin", name: "Super Admin" },
    }),
    prisma.role.upsert({
      where: { key: "admin" },
      update: { name: "Admin" },
      create: { key: "admin", name: "Admin" },
    }),
  ]);
  await prisma.role.upsert({
    where: { key: "client" },
    update: {},
    create: { key: "client", name: "Client" },
  });
  await Promise.all(
    administratorRoles.flatMap((role) =>
      permissions.map((permission) =>
        prisma.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: role.id,
              permissionId: permission.id,
            },
          },
          update: {},
          create: { roleId: role.id, permissionId: permission.id },
        }),
      ),
    ),
  );
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
