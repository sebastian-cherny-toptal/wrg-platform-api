import { Controller, Get, Inject, Module, Param, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../../database/prisma.service.js";
import { JwtAuthGuard } from "../auth/auth.module.js";
import { TenantGuard } from "../tenants/tenants.module.js";

@ApiTags("content")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller("organizations/:organizationId/assets")
class ContentController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get()
  list(@Param("organizationId") organizationId: string) {
    return this.prisma.asset.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
  }
}

@Module({ controllers: [ContentController] })
export class ContentModule {}
