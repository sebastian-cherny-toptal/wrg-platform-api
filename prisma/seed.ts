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
  const adminRole = await prisma.role.upsert({
    where: { key: "admin" },
    update: {},
    create: { key: "admin", name: "Administrator" },
  });
  const clientRole = await prisma.role.upsert({
    where: { key: "client" },
    update: {},
    create: { key: "client", name: "Client" },
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
  const enrollment = await prisma.organizationProgram.upsert({
    where: {
      organizationId_programId: {
        organizationId: organization.id,
        programId: program.id,
      },
    },
    update: {
      stage: "Active",
      reportAccess: {
        WFR_Access: "yes",
        EV_Access: "yes",
        WBC_Access: "yes",
        BBP_Access: "yes",
        RD_Access: "yes",
        KIA_Access: "yes",
        CR_Access: "yes",
      },
    },
    create: {
      organizationId: organization.id,
      projectId: project.id,
      programId: program.id,
      externalId: "zoho-demo-deal",
      stage: "Active",
      reportAccess: {
        WFR_Access: "yes",
        EV_Access: "yes",
        WBC_Access: "yes",
        BBP_Access: "yes",
        RD_Access: "yes",
        KIA_Access: "yes",
        CR_Access: "yes",
      },
      metrics: {
        Surveys_Sent: 48,
        Current_Year_Winner: "Yes",
        Current_Year_Category: "Small",
        Last_time_deal_synced: new Date().toISOString(),
      },
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
  const clientUser = await prisma.user.upsert({
    where: { email: "client@example.invalid" },
    update: {
      organizationId: organization.id,
      organizationProgramId: enrollment.id,
      status: "ACTIVE",
    },
    create: {
      email: "client@example.invalid",
      username: "demo-client",
      fullName: "Demo Client",
      passwordHash: await hash("ClientDemo123!"),
      status: "ACTIVE",
      organizationId: organization.id,
      organizationProgramId: enrollment.id,
    },
  });
  await Promise.all([
    prisma.userRole.upsert({
      where: { userId_roleId: { userId: clientUser.id, roleId: clientRole.id } },
      update: {},
      create: { userId: clientUser.id, roleId: clientRole.id },
    }),
    prisma.userProject.upsert({
      where: { userId_projectId: { userId: clientUser.id, projectId: project.id } },
      update: {},
      create: { userId: clientUser.id, projectId: project.id },
    }),
    prisma.userProgram.upsert({
      where: { userId_programId: { userId: clientUser.id, programId: program.id } },
      update: {},
      create: { userId: clientUser.id, programId: program.id },
    }),
  ]);
  await prisma.order.upsert({
    where: { externalId: "demo-order" },
    update: {},
    create: {
      externalId: "demo-order",
      organizationId: organization.id,
      projectId: project.id,
      programId: program.id,
      organizationProgramId: enrollment.id,
      status: "PAID",
      currency: "USD",
      amountMinor: 14900,
      items: [{ name: "Employee Feedback Data Dashboard", quantity: 1 }],
      paymentMethod: "Paid via Credit Card",
    },
  });
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
