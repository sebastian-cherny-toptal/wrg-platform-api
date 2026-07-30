var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Controller, Get, Inject, Module, ServiceUnavailableException, } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";
import { PrismaService } from "../../database/prisma.service.js";
let HealthController = class HealthController {
    prisma;
    config;
    constructor(prisma, config) {
        this.prisma = prisma;
        this.config = config;
    }
    live() {
        return { status: "ok" };
    }
    async ready() {
        const redis = new Redis(this.config.get("REDIS_URL", { infer: true }), {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
        });
        try {
            await Promise.all([
                this.prisma.$queryRaw `SELECT 1`,
                redis.connect().then(() => redis.ping()),
            ]);
            return { status: "ok", checks: { postgres: "ok", redis: "ok" } };
        }
        catch {
            throw new ServiceUnavailableException("Dependencies unavailable");
        }
        finally {
            redis.disconnect();
        }
    }
};
__decorate([
    Get("live"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], HealthController.prototype, "live", null);
__decorate([
    Get("ready"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], HealthController.prototype, "ready", null);
HealthController = __decorate([
    Controller("health"),
    __param(0, Inject(PrismaService)),
    __param(1, Inject(ConfigService)),
    __metadata("design:paramtypes", [PrismaService,
        ConfigService])
], HealthController);
let HealthModule = class HealthModule {
};
HealthModule = __decorate([
    Module({ controllers: [HealthController] })
], HealthModule);
export { HealthModule };
//# sourceMappingURL=health.module.js.map