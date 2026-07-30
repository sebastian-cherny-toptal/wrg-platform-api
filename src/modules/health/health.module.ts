import {
  Controller,
  Get,
  Inject,
  Module,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";
import type { Env } from "../../config/env.js";
import { PrismaService } from "../../database/prisma.service.js";

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

@Module({ controllers: [HealthController] })
export class HealthModule {}
