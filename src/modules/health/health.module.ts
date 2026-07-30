import {
  Controller,
  Get,
  Inject,
  Module,
  Res,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import {
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import type { FastifyReply } from "fastify";
import { Redis } from "ioredis";
import type { Env } from "../../config/env.js";
import { PrismaService } from "../../database/prisma.service.js";

@ApiTags("health")
@Controller({ path: "", version: VERSION_NEUTRAL })
export class PingController {
  @Get("ping")
  @ApiOkResponse({ description: "The API process is accepting requests." })
  ping(): string {
    return "pong";
  }
}

@ApiTags("health")
@Controller({ path: "", version: VERSION_NEUTRAL })
export class DeployCheckController {
  @Get("deploy-check")
  @ApiOkResponse({ description: "Confirms that the deployed build is running." })
  deployCheck(): string {
    return "Hello! Deployed something";
  }
}

interface DatabaseHealthResponse {
  status: "healthy" | "unhealthy";
  database: "connected" | "disconnected";
  timestamp: string;
}

@ApiTags("health")
@Controller({ path: "", version: VERSION_NEUTRAL })
export class DatabaseHealthController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get("health")
  @ApiOkResponse({ description: "The database is reachable." })
  @ApiServiceUnavailableResponse({ description: "The database is unavailable." })
  async health(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<DatabaseHealthResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: "healthy",
        database: "connected",
        timestamp: new Date().toISOString(),
      };
    } catch {
      reply.code(503);
      return {
        status: "unhealthy",
        database: "disconnected",
        timestamp: new Date().toISOString(),
      };
    }
  }
}

@Controller("health")
class HealthController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  @Get("live")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  async ready(): Promise<{
    status: "ok";
    checks: { postgres: "ok"; redis: "ok" };
  }> {
    const redis = new Redis(this.config.get("REDIS_URL", { infer: true }), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    try {
      await Promise.all([
        this.prisma.$queryRaw`SELECT 1`,
        redis.connect().then(() => redis.ping()),
      ]);
      return { status: "ok", checks: { postgres: "ok", redis: "ok" } };
    } catch {
      throw new ServiceUnavailableException("Dependencies unavailable");
    } finally {
      redis.disconnect();
    }
  }
}

@Module({
  controllers: [
    PingController,
    DeployCheckController,
    DatabaseHealthController,
    HealthController,
  ],
})
export class HealthModule {}
