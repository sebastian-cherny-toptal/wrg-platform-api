import {
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Module,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString } from "class-validator";
import { BodyDto } from "../../common/http/body-dto.js";
import { PrismaService } from "../../database/prisma.service.js";
import { JwtAuthGuard, type Principal } from "../auth/auth.module.js";
import { CrmSyncModule, SyncQueue } from "../crm-sync/crm-sync.module.js";

class StartSyncDto {
  @ApiProperty({ type: String, enum: ["zoho", "checkmarket"] })
  @IsIn(["zoho", "checkmarket"])
  provider!: "zoho" | "checkmarket";

  @ApiProperty({ type: String })
  @IsString()
  kind!: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  externalId?: string;

  @ApiProperty({ type: String })
  @IsString()
  idempotencyKey!: string;
}

@Injectable()
class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const principal = context
      .switchToHttp()
      .getRequest<{ user: Principal }>().user;
    if (
      !principal.roles.includes("admin") &&
      !principal.permissions.includes("ops.manage")
    ) {
      throw new ForbiddenException("Administrator access required");
    }
    return true;
  }
}

@ApiTags("ops")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller("admin")
class OpsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SyncQueue) private readonly syncQueue: SyncQueue,
  ) {}

  @Get("sync-jobs")
  jobs() {
    return this.prisma.syncJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  @Get("audit")
  audit() {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  @Post("sync-jobs")
  start(@BodyDto(StartSyncDto) body: StartSyncDto) {
    return this.syncQueue.enqueue(
      {
        provider: body.provider,
        kind: body.kind,
        ...(body.externalId ? { externalId: body.externalId } : {}),
      },
      body.idempotencyKey,
    );
  }
}

@Module({
  imports: [CrmSyncModule],
  providers: [AdminGuard],
  controllers: [OpsController],
})
export class OpsModule {}
