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
import { Body, Controller, ForbiddenException, Get, Inject, Injectable, Module, Post, UseGuards, } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString } from "class-validator";
import { PrismaService } from "../../database/prisma.service.js";
import { JwtAuthGuard } from "../auth/auth.module.js";
import { CrmSyncModule, SyncQueue } from "../crm-sync/crm-sync.module.js";
class StartSyncDto {
    provider;
    kind;
    externalId;
    idempotencyKey;
}
__decorate([
    IsIn(["zoho", "checkmarket"]),
    __metadata("design:type", String)
], StartSyncDto.prototype, "provider", void 0);
__decorate([
    IsString(),
    __metadata("design:type", String)
], StartSyncDto.prototype, "kind", void 0);
__decorate([
    IsOptional(),
    IsString(),
    __metadata("design:type", String)
], StartSyncDto.prototype, "externalId", void 0);
__decorate([
    IsString(),
    __metadata("design:type", String)
], StartSyncDto.prototype, "idempotencyKey", void 0);
let AdminGuard = class AdminGuard {
    canActivate(context) {
        const principal = context
            .switchToHttp()
            .getRequest().user;
        if (!principal.roles.includes("admin") &&
            !principal.permissions.includes("ops.manage")) {
            throw new ForbiddenException("Administrator access required");
        }
        return true;
    }
};
AdminGuard = __decorate([
    Injectable()
], AdminGuard);
let OpsController = class OpsController {
    prisma;
    syncQueue;
    constructor(prisma, syncQueue) {
        this.prisma = prisma;
        this.syncQueue = syncQueue;
    }
    jobs() {
        return this.prisma.syncJob.findMany({
            orderBy: { createdAt: "desc" },
            take: 100,
        });
    }
    audit() {
        return this.prisma.auditLog.findMany({
            orderBy: { createdAt: "desc" },
            take: 100,
        });
    }
    start(body) {
        return this.syncQueue.enqueue({
            provider: body.provider,
            kind: body.kind,
            ...(body.externalId ? { externalId: body.externalId } : {}),
        }, body.idempotencyKey);
    }
};
__decorate([
    Get("sync-jobs"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "jobs", null);
__decorate([
    Get("audit"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "audit", null);
__decorate([
    Post("sync-jobs"),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [StartSyncDto]),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "start", null);
OpsController = __decorate([
    ApiTags("ops"),
    ApiBearerAuth(),
    UseGuards(JwtAuthGuard, AdminGuard),
    Controller("admin"),
    __param(0, Inject(PrismaService)),
    __param(1, Inject(SyncQueue)),
    __metadata("design:paramtypes", [PrismaService,
        SyncQueue])
], OpsController);
let OpsModule = class OpsModule {
};
OpsModule = __decorate([
    Module({
        imports: [CrmSyncModule],
        providers: [AdminGuard],
        controllers: [OpsController],
    })
], OpsModule);
export { OpsModule };
//# sourceMappingURL=ops.module.js.map