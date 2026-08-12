import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { randomUUID } from "node:crypto";
import {
  requestErrorObject,
  requestLogProps,
  requestSuccessObject,
  serializeRequest,
  serializeResponse,
} from "./common/logging/request-logging.js";
import { validateEnv, type Env } from "./config/env.js";
import { DatabaseModule } from "./database/database.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { ImpersonationModule } from "./modules/auth/impersonation.module.js";
import { CommerceModule } from "./modules/commerce/commerce.module.js";
import { CompatibilityPaymentModule } from "./modules/commerce/compatibility-payment.module.js";
import { ContentModule } from "./modules/content/content.module.js";
import { CrmSyncModule } from "./modules/crm-sync/crm-sync.module.js";
import { CompatibilityZohoModule } from "./modules/crm-sync/compatibility-zoho.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { IntegrationsModule } from "./modules/integrations/integrations.module.js";
import { WebhooksModule } from "./modules/integrations/webhooks.module.js";
import { CompatibilityWebhooksModule } from "./modules/integrations/compatibility-webhooks.module.js";
import { OpsModule } from "./modules/ops/ops.module.js";
import { ReportsModule } from "./modules/reports/reports.module.js";
import { CompatibilityReportsModule } from "./modules/reports/compatibility-reports.module.js";
import { SurveysModule } from "./modules/surveys/surveys.module.js";
import { TenantsModule } from "./modules/tenants/tenants.module.js";
import { UsersModule } from "./modules/users/users.module.js";
import { AccountAccessModule } from "./modules/users/account-access.module.js";
import { CompatibilityManagementModule } from "./modules/management/compatibility-management.module.js";
import { CompatibilityAdminModule } from "./modules/management/compatibility-admin.module.js";
import { BootstrapAdminService } from "./bootstrap-admin.service.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get("LOG_LEVEL", { infer: true }),
          genReqId: (request, reply) => {
            const incoming = request.headers["x-correlation-id"];
            const id =
              typeof incoming === "string" && incoming.length <= 128
                ? incoming
                : randomUUID();
            reply.setHeader("x-correlation-id", id);
            return id;
          },
          customLogLevel: (_request, response, error) => {
            if (error || response.statusCode >= 500) return "error";
            if (response.statusCode >= 400) return "warn";
            return "info";
          },
          customProps: requestLogProps,
          customSuccessObject: requestSuccessObject,
          customErrorObject: requestErrorObject,
          autoLogging: false,
          serializers: {
            req: serializeRequest,
            res: serializeResponse,
          },
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            'res.headers["set-cookie"]',
            "*.password",
            "*.passcode",
            "*.token",
            "*.secret",
            "*.apiKey",
            "*.signature",
            "*.otp",
          ],
        },
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const redis = new URL(config.get("REDIS_URL", { infer: true }));
        return {
          connection: {
            host: redis.hostname,
            port: Number(redis.port || 6379),
            username: redis.username || undefined,
            password: redis.password || undefined,
          },
        };
      },
    }),
    BullModule.registerQueue({ name: "integrations" }),
    DatabaseModule,
    AuthModule,
    ImpersonationModule,
    UsersModule,
    AccountAccessModule,
    TenantsModule,
    SurveysModule,
    ReportsModule,
    CompatibilityReportsModule,
    CompatibilityManagementModule,
    CompatibilityAdminModule,
    CommerceModule,
    CompatibilityPaymentModule,
    IntegrationsModule,
    CrmSyncModule,
    CompatibilityZohoModule,
    ContentModule,
    OpsModule,
    WebhooksModule,
    CompatibilityWebhooksModule,
    HealthModule,
  ],
  providers: [BootstrapAdminService],
})
export class AppModule {}
