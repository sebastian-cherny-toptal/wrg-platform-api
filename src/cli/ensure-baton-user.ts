import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

const projectSlug = "baton-rouge-best-places-to-work";
const organizationSlug = "baton-rouge-test-organization";
const programYears = [2026, 2025, 2024] as const;
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
    const foundation = await prisma.$transaction(async (transaction) => {
      const project = await transaction.project.upsert({
        where: { slug: projectSlug },
        update: {},
        create: {
          externalId: "seed-br-project",
          name: "Baton Rouge Best Places to Work",
          slug: projectSlug,
          metadata: { anonymized: true, seed: "seed-br" },
        },
      });
      const organization = await transaction.organization.upsert({
        where: { slug: organizationSlug },
        update: {},
        create: {
          externalId: "seed-br-test-organization",
          name: "Baton Rouge Test Organization",
          slug: organizationSlug,
          metadata: { anonymized: true, seed: "seed-br" },
        },
      });
      const programs = [];
      for (const year of programYears) {
        const existing = await transaction.program.findFirst({
          where: { projectId: project.id, year },
        });
        const program =
          existing ??
          (await transaction.program.create({
            data: {
              externalId: `seed-br-program-${year}`,
              projectId: project.id,
              name: `Best Places to Work in Baton Rouge ${year}`,
              year,
              metadata: { anonymized: true, seed: "seed-br" },
            },
          }));
        programs.push(program);
        await transaction.organizationProgram.upsert({
          where: {
            organizationId_programId: {
              organizationId: organization.id,
              programId: program.id,
            },
          },
          update: { projectId: project.id },
          create: {
            externalId: `seed-br-test-enrollment-${year}`,
            organizationId: organization.id,
            projectId: project.id,
            programId: program.id,
            reportAccess: { enabled: true },
          },
        });
      }
      return { organization, programs, project };
    });

    const project = await prisma.project.findUniqueOrThrow({
      where: { slug: projectSlug },
      include: {
        programs: {
          orderBy: { year: "desc" },
          select: { id: true, year: true },
        },
      },
    });
    const programIds = project.programs.map(({ id }) => id);
    const enrollments = await prisma.organizationProgram.findMany({
      where: {
        projectId: project.id,
        organizationId: foundation.organization.id,
        programId: { in: programIds },
      },
      orderBy: { organization: { name: "asc" } },
      select: {
        id: true,
        organizationId: true,
        programId: true,
      },
    });
    if (new Set(enrollments.map(({ programId }) => programId)).size !== programIds.length) {
      throw new Error(
        `Cannot create ${username}: test organization enrollment is incomplete`,
      );
    }

    const latestEnrollment = project.programs
      .map(({ id }) =>
        enrollments.find(({ programId }) => programId === id),
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
