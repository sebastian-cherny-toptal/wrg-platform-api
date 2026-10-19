import {
  type CanActivate,
  Controller,
  type ExecutionContext,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Module,
  Query,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import {
  AuthModule,
  JwtAuthGuard,
  type Principal,
} from "../auth/auth.module.js";
import { ServerStatsService } from "./server-stats.service.js";

@Injectable()
export class ServerStatsAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<{ user?: Principal }>();
    if (
      !user?.roles.some((role) => role === "admin" || role === "super_admin")
    ) {
      throw new ForbiddenException("Administrator access required");
    }
    return true;
  }
}

@ApiTags("ops")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ServerStatsAdminGuard)
@Controller({ path: "admin/serverStats", version: VERSION_NEUTRAL })
export class ServerStatsController {
  constructor(
    @Inject(ServerStatsService) private readonly stats: ServerStatsService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      "Process memory and GC history, grouped per process run and UTC time bucket",
  })
  @ApiQuery({
    name: "timeStart",
    required: false,
    description:
      "ISO 8601 timestamp with timezone; defaults to one hour before timeEnd",
  })
  @ApiQuery({
    name: "timeEnd",
    required: false,
    description: "ISO 8601 timestamp with timezone; exclusive; defaults to now",
  })
  @ApiQuery({
    name: "interval",
    required: false,
    enum: ["30s", "1m", "5m", "15m", "1h"],
  })
  @ApiQuery({ name: "instanceId", required: false })
  @ApiQuery({ name: "processStartId", required: false })
  history(@Query() query: Record<string, unknown>) {
    return this.stats.history(query);
  }
}

@Module({
  imports: [AuthModule],
  providers: [ServerStatsService, ServerStatsAdminGuard],
  controllers: [ServerStatsController],
  exports: [ServerStatsService],
})
export class ServerStatsModule {}
