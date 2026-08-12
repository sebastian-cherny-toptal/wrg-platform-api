import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { hash, verify } from "argon2";
import type { Env } from "./config/env.js";
import { PrismaService } from "./database/prisma.service.js";

const adminPermissions = [
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
] as const;

@Injectable()
export class BootstrapAdminService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapAdminService.name);

  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<Env, true>,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const username = this.config.get("ADMIN_USERNAME", { infer: true });
    const password = this.config.get("ADMIN_PASSWORD", { infer: true });
    if (!username || !password) return;

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: username }, { username }] },
      select: { id: true, passwordHash: true },
    });
    if (existing) {
      await this.reconcilePassword(existing, password);
      return;
    }

    const passwordHash = await hash(password);
    try {
      await this.prisma.$transaction(async (transaction) => {
        const role = await transaction.role.upsert({
          where: { key: "admin" },
          update: {},
          create: { key: "admin", name: "Administrator" },
        });
        const permissions = await Promise.all(
          adminPermissions.map((key) =>
            transaction.permission.upsert({
              where: { key },
              update: {},
              create: { key, description: key },
            }),
          ),
        );
        await Promise.all(
          permissions.map((permission) =>
            transaction.rolePermission.upsert({
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
        );
        const user = await transaction.user.create({
          data: {
            email: username,
            username,
            fullName: "Administrator",
            passwordHash,
            status: "ACTIVE",
          },
        });
        await transaction.userRole.create({
          data: { userId: user.id, roleId: role.id },
        });
      });
      this.logger.log("Bootstrap administrator created");
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const concurrent = await this.prisma.user.findFirst({
          where: { OR: [{ email: username }, { username }] },
          select: { id: true, passwordHash: true },
        });
        if (concurrent) {
          await this.reconcilePassword(concurrent, password);
          return;
        }
      }
      throw error;
    }
  }

  private async reconcilePassword(
    user: { id: string; passwordHash: string },
    password: string,
  ): Promise<void> {
    let matches = false;
    try {
      matches = await verify(user.passwordHash, password);
    } catch {
      matches = false;
    }
    if (matches) {
      this.logger.log("Bootstrap administrator password already matches");
      return;
    }
    const passwordHash = await hash(password);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });
      await transaction.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    this.logger.log("new admin password");
  }
}
