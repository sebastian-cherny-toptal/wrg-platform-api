var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { randomUUID } from "node:crypto";
import { validateEnv } from "./config/env.js";
import { DatabaseModule } from "./database/database.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { CommerceModule } from "./modules/commerce/commerce.module.js";
import { ContentModule } from "./modules/content/content.module.js";
import { CrmSyncModule } from "./modules/crm-sync/crm-sync.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { IntegrationsModule } from "./modules/integrations/integrations.module.js";
import { WebhooksModule } from "./modules/integrations/webhooks.module.js";
import { LegacyEndpointsModule } from "./modules/legacy-endpoints/legacy-endpoints.module.js";
import { OpsModule } from "./modules/ops/ops.module.js";
import { ReportsModule } from "./modules/reports/reports.module.js";
import { SurveysModule } from "./modules/surveys/surveys.module.js";
import { TenantsModule } from "./modules/tenants/tenants.module.js";
let AppModule = class AppModule {
};
AppModule = __decorate([
    Module({
        imports: [
            ConfigModule.forRoot({
                isGlobal: true,
                cache: true,
                validate: validateEnv,
            }),
            LoggerModule.forRootAsync({
                inject: [ConfigService],
                useFactory: (config) => ({
                    pinoHttp: {
                        level: config.get("LOG_LEVEL", { infer: true }),
                        genReqId: (request, reply) => {
                            const incoming = request.headers["x-correlation-id"];
                            const id = typeof incoming === "string" && incoming.length <= 128
                                ? incoming
                                : randomUUID();
                            reply.setHeader("x-correlation-id", id);
                            return id;
                        },
                        redact: [
                            "req.headers.authorization",
                            "req.headers.cookie",
                            'res.headers["set-cookie"]',
                            "*.password",
                            "*.token",
                        ],
                    },
                }),
            }),
            ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
            BullModule.forRootAsync({
                inject: [ConfigService],
                useFactory: (config) => {
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
            TenantsModule,
            SurveysModule,
            ReportsModule,
            CommerceModule,
            IntegrationsModule,
            CrmSyncModule,
            ContentModule,
            OpsModule,
            WebhooksModule,
            LegacyEndpointsModule,
            HealthModule,
        ],
    })
], AppModule);
export { AppModule };
//# sourceMappingURL=app.module.js.map