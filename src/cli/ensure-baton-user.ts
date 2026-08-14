import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

const projectSlug = "baton-rouge-best-places-to-work";
const username = "test.baton";
const email = "test.baton@example.test";
const defaultPassword = "BatonRouge123!";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const password = process.env.BATON_TEST_PASSWORD ?? defaultPassword;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const project = await prisma.project.findUnique({
      where: { slug: projectSlug },
      include: {
        programs: {
          orderBy: { year: "desc" },
          select: { id: true, year: true },
        },
      },
    });
    if (!project || project.programs.length === 0) {
      throw new Error(
        `Cannot create ${username}: project ${projectSlug} has not been imported`,
      );
    }

    const programIds = project.programs.map(({ id }) => id);
    const enrollments = await prisma.organizationProgram.findMany({
      where: { projectId: project.id, programId: { in: programIds } },
      orderBy: { organization: { name: "asc" } },
      select: {
        id: true,
        organizationId: true,
        programId: true,
      },
    });
    const enrollmentsByOrganization = new Map<
      string,
      (typeof enrollments)[number][]
    >();
    for (const enrollment of enrollments) {
      const grouped = enrollmentsByOrganization.get(enrollment.organizationId);
      if (grouped) grouped.push(enrollment);
      else enrollmentsByOrganization.set(enrollment.organizationId, [enrollment]);
    }
    const organizationEnrollments = [...enrollmentsByOrganization.values()].find(
      (items) =>
        new Set(items.map(({ programId }) => programId)).size ===
        programIds.length,
    );
    if (!organizationEnrollments) {
      throw new Error(
        `Cannot create ${username}: no organization is enrolled in every Baton Rouge program`,
      );
    }

    const latestEnrollment = project.programs
      .map(({ id }) =>
        organizationEnrollments.find(({ programId }) => programId === id),
      )
      .find((enrollment) => enrollment !== undefined);
    if (!latestEnrollment) throw new Error("Could not select a Baton Rouge enrollment");

    const passwordHash = await hash(password);
    await prisma.$transaction(async (transaction) => {
      const role = await transaction.role.upsert({
        where: { key: "client" },
        update: {},
        create: { key: "client", name: "Client" },
      });
      const existing = await transaction.user.findFirst({
        where: { OR: [{ username }, { email }] },
        select: { id: true },
      });
      const data = {
        externalId: `seed-br-user-${username}`,
        email,
        username,
        fullName: "Baton Rouge Report Tester",
        passwordHash,
        status: "ACTIVE" as const,
        organizationId: latestEnrollment.organizationId,
        organizationProgramId: latestEnrollment.id,
        metadata: { anonymized: true, seed: "seed-br" },
      };
      const user = existing
        ? await transaction.user.update({ where: { id: existing.id }, data })
        : await transaction.user.create({ data });

      await transaction.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: role.id } },
        update: {},
        create: { userId: user.id, roleId: role.id },
      });
      await transaction.userProject.upsert({
        where: {
          userId_projectId: { userId: user.id, projectId: project.id },
        },
        update: {},
        create: { userId: user.id, projectId: project.id },
      });
      await Promise.all(
        programIds.map((programId) =>
          transaction.userProgram.upsert({
            where: { userId_programId: { userId: user.id, programId } },
            update: {},
            create: { userId: user.id, programId },
          }),
        ),
      );
    });

    console.log(
      `Ensured ${username} exists with access to Baton Rouge ${project.programs
        .map(({ year }) => year ?? "unversioned")
        .join(", ")}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
