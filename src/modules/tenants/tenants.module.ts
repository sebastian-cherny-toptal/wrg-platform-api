import {
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Module,
  Param,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../../database/prisma.service.js";
import {
  CurrentUser,
  JwtAuthGuard,
  type Principal,
} from "../auth/auth.module.js";

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user: Principal; params: { organizationId?: string } }>();
    const requested = request.params.organizationId;
    if (
      requested &&
      request.user.organizationId !== requested &&
      !request.user.roles.includes("admin") &&
      !request.user.roles.includes("super_admin")
    ) {
      throw new ForbiddenException("Tenant access denied");
    }
    return true;
  }
}

@ApiTags("tenants")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller("organizations")
class TenantsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get("me")
  me(@CurrentUser() principal: Principal) {
    if (!principal.organizationId)
      throw new ForbiddenException("No organization assigned");
    return this.prisma.organization.findUniqueOrThrow({
      where: { id: principal.organizationId },
    });
  }

  @Get(":organizationId/programs")
  programs(@Param("organizationId") organizationId: string) {
    return this.prisma.organizationProgram.findMany({
      where: { organizationId, isIncluded: true },
      include: { program: { include: { project: true } } },
    });
  }
}

@Module({
  providers: [TenantGuard],
  controllers: [TenantsController],
  exports: [TenantGuard],
})
export class TenantsModule {}
