import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

async function main(): Promise<void> {
  const permissions = await Promise.all(
    ["ops.manage", "reports.read", "commerce.manage"].map((key) =>
      prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, description: key },
      }),
    ),
  );
  const adminRole = await prisma.role.upsert({
    where: { key: "admin" },
    update: {},
    create: { key: "admin", name: "Administrator" },
  });
  await Promise.all(
    permissions.map((permission) =>
      prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: adminRole.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: { roleId: adminRole.id, permissionId: permission.id },
      }),
    ),
  );
  const organization = await prisma.organization.upsert({
    where: { slug: "demo" },
    update: {},
    create: {
      name: "Demo Organization",
      slug: "demo",
      externalId: "zoho-demo-org",
    },
  });
  const project = await prisma.project.upsert({
    where: { slug: "demo-project" },
    update: {},
    create: {
      name: "Demo Project",
      slug: "demo-project",
      externalId: "zoho-demo-project",
    },
  });
  const existingProgram = await prisma.program.findUnique({
    where: { externalId: "zoho-demo-program" },
  });
  const program =
    existingProgram ??
    (await prisma.program.create({
      data: {
        projectId: project.id,
        name: "Demo Program",
        year: new Date().getUTCFullYear(),
        externalId: "zoho-demo-program",
      },
    }));
  await prisma.organizationProgram.upsert({
    where: {
      organizationId_programId: {
        organizationId: organization.id,
        programId: program.id,
      },
    },
    update: {},
    create: {
      organizationId: organization.id,
      projectId: project.id,
      programId: program.id,
      externalId: "zoho-demo-deal",
    },
  });
  const user = await prisma.user.upsert({
    where: { email: "admin@example.test" },
    update: {},
    create: {
      email: "admin@example.test",
      fullName: "Local Admin",
      passwordHash: await hash("ChangeMe123!"),
      status: "ACTIVE",
      organizationId: organization.id,
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
    update: {},
    create: { userId: user.id, roleId: adminRole.id },
  });
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
