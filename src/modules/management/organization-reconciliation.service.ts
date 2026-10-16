import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../../database/prisma.service.js";
import type { Principal } from "../auth/auth.module.js";
import type {
  OrganizationAccountConflict,
  OrganizationConflictSource,
} from "./organization-reconciliation.types.js";

const organizationInclude = {
  _count: {
    select: {
      users: true,
      respondents: true,
      orders: true,
      assets: true,
      auditLogs: true,
      impersonationGrants: true,
    },
  },
  programs: {
    orderBy: { id: "asc" },
    include: {
      program: { select: { id: true, name: true, year: true } },
      project: { select: { id: true, name: true } },
      _count: {
        select: {
          keyImpactAnalysisRows: true,
          keyImpactAnalysisUploads: true,
          customReportUploads: true,
        },
      },
    },
  },
} satisfies Prisma.OrganizationInclude;

type OrganizationSnapshot = Prisma.OrganizationGetPayload<{
  include: typeof organizationInclude;
}>;
type Client = Prisma.TransactionClient;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function summary(organization: OrganizationSnapshot, responses: number) {
  return {
    id: organization.id,
    name: organization.name,
    zohoAccountId: organization.zohoAccountId,
    legacyId: organization.legacyId,
    externalId: organization.externalId,
    stripeCustomerId: organization.stripeCustomerId,
    counts: {
      ...organization._count,
      responses,
      programs: organization.programs.length,
      keyImpactAnalysisRows: organization.programs.reduce(
        (count, item) => count + item._count.keyImpactAnalysisRows,
        0,
      ),
      keyImpactAnalysisUploads: organization.programs.reduce(
        (count, item) => count + item._count.keyImpactAnalysisUploads,
        0,
      ),
      customReportUploads: organization.programs.reduce(
        (count, item) => count + item._count.customReportUploads,
        0,
      ),
    },
    programs: organization.programs.map((enrollment) => ({
      enrollmentId: enrollment.id,
      programId: enrollment.programId,
      programName: enrollment.program.name,
      year: enrollment.program.year,
      projectName: enrollment.project.name,
      sourceId: String(object(enrollment.metrics).Source_Organization_ID ?? ""),
      sourceName: String(
        object(enrollment.metrics).Source_Organization_Name ??
          organization.name,
      ),
    })),
  };
}

type OrganizationSummary = ReturnType<typeof summary>;
export interface ReconciliationRow extends OrganizationAccountConflict {
  source: OrganizationSummary | null;
  target: OrganizationSummary | null;
  blockers: string[];
  eligible: boolean;
}
export interface ReconciliationReport {
  programId: string;
  revision: string;
  conflicts: ReconciliationRow[];
}

@Injectable()
export class OrganizationReconciliationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject("OrganizationConflictSource")
    private readonly conflictSource: OrganizationConflictSource,
  ) {}

  private assertAdmin(principal: Principal) {
    if (
      principal.impersonation ||
      !(
        principal.roles.includes("admin") ||
        principal.roles.includes("super_admin") ||
        principal.permissions.includes("ops.manage")
      )
    )
      throw new ForbiddenException("Administrator access required");
  }

  private selection(body: unknown, requireRevision = false) {
    const input = object(body);
    if (
      !Array.isArray(input.conflictIds) ||
      input.conflictIds.length === 0 ||
      input.conflictIds.length > 5000 ||
      input.conflictIds.some((id) => typeof id !== "string" || !id.trim()) ||
      new Set(input.conflictIds).size !== input.conflictIds.length
    ) {
      throw new BadRequestException("Select one or more distinct conflict IDs");
    }
    if (
      requireRevision &&
      (typeof input.revision !== "string" ||
        !/^[a-f0-9]{64}$/u.test(input.revision))
    ) {
      throw new BadRequestException(
        "A valid reconciliation preview revision is required",
      );
    }
    return {
      conflictIds: (input.conflictIds as string[]).toSorted(),
      revision: input.revision,
    };
  }

  private async buildReport(
    client: Client,
    data: { programId: string; conflicts: OrganizationAccountConflict[] },
  ) {
    data = {
      ...data,
      conflicts: data.conflicts.toSorted((a, b) => a.id.localeCompare(b.id)),
    };
    const ids = [
      ...new Set(
        data.conflicts.flatMap((row) => [
          row.sourceOrganizationId,
          ...(row.targetOrganizationId ? [row.targetOrganizationId] : []),
        ]),
      ),
    ].sort();
    const organizations = ids.length
      ? await client.organization.findMany({
          where: { id: { in: ids } },
          include: organizationInclude,
          orderBy: { id: "asc" },
        })
      : [];
    const responseCounts = ids.length
      ? await client.$queryRaw<
          Array<{ organizationId: string; count: number }>
        >(Prisma.sql`
      SELECT respondent."organizationId", COUNT(response.id)::int AS count
      FROM "Respondent" respondent
      JOIN "Response" response ON response."respondentId" = respondent.id
      WHERE respondent."organizationId" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      GROUP BY respondent."organizationId"
    `)
      : [];
    const responsesById = new Map(
      responseCounts.map((row) => [row.organizationId, row.count]),
    );
    const byId = new Map(
      organizations.map((organization) => [organization.id, organization]),
    );
    const conflicts = data.conflicts
      .toSorted((a, b) => a.id.localeCompare(b.id))
      .map((row): ReconciliationRow => {
        const source = byId.get(row.sourceOrganizationId);
        const target = row.targetOrganizationId
          ? byId.get(row.targetOrganizationId)
          : undefined;
        const blockers: string[] = row.blockingReason
          ? [row.blockingReason]
          : [];
        if (!source)
          blockers.push(
            "The enrolled organization no longer exists. Refresh the report.",
          );
        if (!target || source?.id === target.id)
          blockers.push(
            "There is no separate organization with a verified link to this Zoho account. Correct the account mapping before reconciliation.",
          );
        if (source?.zohoAccountId)
          blockers.push(
            "The enrolled organization already has a Zoho account link. Correct that mapping before reconciliation.",
          );
        if (target && target.zohoAccountId !== row.zohoAccountId)
          blockers.push(
            "The destination account link has changed. Refresh the report.",
          );
        if (
          source &&
          !source.programs.some(
            (item) =>
              item.id === row.organizationProgramId &&
              item.programId === data.programId,
          )
        )
          blockers.push(
            "The program enrollment has changed. Refresh the report.",
          );
        if (source && target) {
          for (const enrollment of source.programs) {
            if (
              target.programs.some(
                (item) => item.programId === enrollment.programId,
              )
            )
              blockers.push(
                `Both organizations are enrolled in ${enrollment.program.name}. Resolve the duplicate enrollments before merging.`,
              );
          }
          if (
            source.stripeCustomerId &&
            target.stripeCustomerId &&
            source.stripeCustomerId !== target.stripeCustomerId
          )
            blockers.push(
              "The organizations have different Stripe customers. Resolve the billing identity before merging.",
            );
        }
        const otherTargets = new Set(
          data.conflicts
            .filter(
              (item) => item.sourceOrganizationId === row.sourceOrganizationId,
            )
            .map((item) => item.zohoAccountId),
        );
        if (otherTargets.size > 1)
          blockers.push(
            "This organization matches multiple Zoho accounts. Resolve those mappings before merging.",
          );
        return {
          ...row,
          source: source
            ? summary(source, responsesById.get(source.id) ?? 0)
            : null,
          target: target
            ? summary(target, responsesById.get(target.id) ?? 0)
            : null,
          blockers,
          eligible: blockers.length === 0,
        };
      });
    return {
      report: {
        programId: data.programId,
        revision: digest({
          data,
          organizations,
          responseCounts: responseCounts.toSorted((a, b) =>
            a.organizationId.localeCompare(b.organizationId),
          ),
        }),
        conflicts,
      } satisfies ReconciliationReport,
      byId,
    };
  }

  async report(principal: Principal, programReference: string) {
    this.assertAdmin(principal);
    const data = await this.conflictSource.mappingConflicts(
      principal,
      programReference,
    );
    return this.prisma.$transaction(
      async (client) => (await this.buildReport(client, data)).report,
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 30000,
      },
    );
  }

  private plan(report: ReconciliationReport, conflictIds: string[]) {
    const rows = conflictIds.map((id) => {
      const row = report.conflicts.find((item) => item.id === id);
      if (!row)
        throw new ConflictException(
          "A selected conflict no longer exists; refresh the report",
        );
      if (!row.eligible) throw new ConflictException(row.blockers.join(" "));
      return row;
    });
    const merges = [
      ...new Map(rows.map((row) => [row.sourceOrganizationId, row])).values(),
    ];
    const destinations = new Map<string, Set<string>>();
    const billing = new Map<string, Set<string>>();
    for (const row of merges) {
      // These are guaranteed by buildReport; never accept destination IDs from the browser.
      const source = row.source;
      const target = row.target;
      if (!source || !target)
        throw new ConflictException(
          "Organization data changed; refresh the report",
        );
      if (merges.some((item) => item.sourceOrganizationId === target.id))
        throw new ConflictException(
          "A destination is also selected as a duplicate; reconcile those separately",
        );
      const programs =
        destinations.get(target.id) ??
        new Set(target.programs.map((item) => item.programId));
      for (const enrollment of source.programs) {
        if (programs.has(enrollment.programId))
          throw new ConflictException(
            `Selected duplicates overlap in ${enrollment.programName}; reconcile those enrollments separately`,
          );
        programs.add(enrollment.programId);
      }
      destinations.set(target.id, programs);
      const customers =
        billing.get(target.id) ??
        new Set(target.stripeCustomerId ? [target.stripeCustomerId] : []);
      if (source.stripeCustomerId) customers.add(source.stripeCustomerId);
      if (customers.size > 1)
        throw new ConflictException(
          "Selected duplicates have different Stripe customers; resolve billing identity first",
        );
      billing.set(target.id, customers);
    }
    return {
      programId: report.programId,
      conflictIds,
      revision: digest({ reportRevision: report.revision, conflictIds }),
      merges,
    };
  }

  async preview(principal: Principal, programReference: string, body: unknown) {
    this.assertAdmin(principal);
    const { conflictIds } = this.selection(body);
    return this.plan(
      await this.report(principal, programReference),
      conflictIds,
    );
  }

  async apply(principal: Principal, programReference: string, body: unknown) {
    this.assertAdmin(principal);
    const input = this.selection(body, true);
    const data = await this.conflictSource.mappingConflicts(
      principal,
      programReference,
    );
    try {
      return await this.prisma.$transaction(
        async (client) => {
          const { report, byId } = await this.buildReport(client, data);
          const plan = this.plan(report, input.conflictIds);
          if (plan.revision !== input.revision)
            throw new ConflictException(
              "Reconciliation data changed; refresh the report and preview again",
            );
          const movedAt = new Date();
          for (const row of plan.merges) {
            const source = byId.get(row.sourceOrganizationId);
            const target = row.targetOrganizationId
              ? byId.get(row.targetOrganizationId)
              : undefined;
            if (!source || !target)
              throw new ConflictException(
                "Organization data changed; refresh the report",
              );
            const where = { organizationId: source.id };
            const reassignment = { organizationId: target.id };
            // Enrollment IDs and their data remain intact; uploads and response rows retain their parents.
            await client.organizationProgram.updateMany({
              where,
              data: reassignment,
            });
            await client.user.updateMany({ where, data: reassignment });
            await client.respondent.updateMany({ where, data: reassignment });
            await client.order.updateMany({ where, data: reassignment });
            await client.asset.updateMany({ where, data: reassignment });
            await client.auditLog.updateMany({ where, data: reassignment });
            await client.impersonationGrant.updateMany({
              where,
              data: { ...reassignment, revokedAt: movedAt },
            });
            // Keep the complete original organization and enrollment snapshots in the audit trail.
            // Remove only the now-empty duplicate, releasing its unique billing/external identifiers.
            await client.organization.delete({ where: { id: source.id } });
            const targetMetadata = object(target.metadata);
            const aliases: unknown[] = Array.isArray(
              targetMetadata.reconciledOrganizations,
            )
              ? targetMetadata.reconciledOrganizations
              : [];
            const targetData = {
              legacyId: target.legacyId ?? source.legacyId,
              externalId: target.externalId ?? source.externalId,
              stripeCustomerId:
                target.stripeCustomerId ?? source.stripeCustomerId,
              metadata: {
                ...targetMetadata,
                reconciledOrganizations: [
                  ...aliases,
                  {
                    id: source.id,
                    legacyId: source.legacyId,
                    externalId: source.externalId,
                    name: source.name,
                    reconciledAt: movedAt.toISOString(),
                  },
                ],
              } as Prisma.InputJsonObject,
            };
            await client.organization.update({
              where: { id: target.id },
              data: targetData,
            });
            // Carry destination state forward when several selected sources share one destination.
            Object.assign(target, targetData);
            await client.auditLog.create({
              data: {
                actorUserId:
                  principal.localAuthBypass &&
                  principal.sub === "bypass-login-auth"
                    ? null
                    : principal.sub,
                organizationId: target.id,
                action: "organization.reconcile",
                resourceType: "Organization",
                resourceId: source.id,
                before: JSON.parse(
                  JSON.stringify({ source, target: row.target }),
                ) as Prisma.InputJsonValue,
                after: {
                  organizationId: target.id,
                  actorSubject: principal.sub,
                  localAuthBypass: principal.localAuthBypass ?? false,
                  zohoAccountId: row.zohoAccountId,
                  programId: data.programId,
                  revision: plan.revision,
                  sourceEnrollmentIds: source.programs.map((item) => item.id),
                },
              },
            });
          }
          return {
            programId: data.programId,
            appliedCount: plan.merges.length,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 60000,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2003", "P2025", "P2034"].includes(error.code)
      ) {
        throw new ConflictException(
          "Organization data changed during reconciliation; refresh the report and preview again",
        );
      }
      throw error;
    }
  }
}
