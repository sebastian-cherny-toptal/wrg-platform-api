import type { PrismaClient } from "@prisma/client";

const seedPrefix = "seed-br";
export const batonRougeTestUsername = "test.baton";

export interface BatonRougeSeedMetrics {
  organizationPrograms: number;
  projectsLinked: number;
  programsLinked: number;
  usernameExists: boolean;
}

export function expectedBatonRougeSeedMetrics(
  programCount: number,
  organizationPrograms: number,
): BatonRougeSeedMetrics {
  return {
    usernameExists: true,
    projectsLinked: 1,
    programsLinked: programCount,
    organizationPrograms,
  };
}

export async function inspectBatonRougeSeed(
  prisma: PrismaClient,
): Promise<BatonRougeSeedMetrics> {
  const [user, organizationPrograms] = await Promise.all([
    prisma.user.findUnique({
      where: { username: batonRougeTestUsername },
      select: {
        _count: { select: { programs: true, projects: true } },
      },
    }),
    prisma.organizationProgram.count({
      where: {
        project: { externalId: `${seedPrefix}-project` },
      },
    }),
  ]);

  return {
    usernameExists: user !== null,
    projectsLinked: user?._count.projects ?? 0,
    programsLinked: user?._count.programs ?? 0,
    organizationPrograms,
  };
}

export function batonRougeSeedMetricsMatch(
  actual: BatonRougeSeedMetrics,
  expected: BatonRougeSeedMetrics,
): boolean {
  return (
    actual.usernameExists === expected.usernameExists &&
    actual.projectsLinked === expected.projectsLinked &&
    actual.programsLinked === expected.programsLinked &&
    actual.organizationPrograms === expected.organizationPrograms
  );
}

export function shouldSkipBatonRougeSeed(
  actual: BatonRougeSeedMetrics,
  expected: BatonRougeSeedMetrics,
  forceUpdate: string | undefined,
): boolean {
  return batonRougeSeedMetricsMatch(actual, expected) && forceUpdate !== "true";
}
