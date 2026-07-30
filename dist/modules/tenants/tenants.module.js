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
import { Controller, ForbiddenException, Get, Inject, Injectable, Module, Param, UseGuards, } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../../database/prisma.service.js";
import { CurrentUser, JwtAuthGuard, } from "../auth/auth.module.js";
let TenantGuard = class TenantGuard {
    canActivate(context) {
        const request = context
            .switchToHttp()
            .getRequest();
        const requested = request.params.organizationId;
        if (requested &&
            request.user.organizationId !== requested &&
            !request.user.roles.includes("admin")) {
            throw new ForbiddenException("Tenant access denied");
        }
        return true;
    }
};
TenantGuard = __decorate([
    Injectable()
], TenantGuard);
export { TenantGuard };
let TenantsController = class TenantsController {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    me(principal) {
        if (!principal.organizationId)
            throw new ForbiddenException("No organization assigned");
        return this.prisma.organization.findUniqueOrThrow({
            where: { id: principal.organizationId },
        });
    }
    programs(organizationId) {
        return this.prisma.organizationProgram.findMany({
            where: { organizationId },
            include: { program: { include: { project: true } } },
        });
    }
};
__decorate([
    Get("me"),
    __param(0, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], TenantsController.prototype, "me", null);
__decorate([
    Get(":organizationId/programs"),
    __param(0, Param("organizationId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], TenantsController.prototype, "programs", null);
TenantsController = __decorate([
    ApiTags("tenants"),
    ApiBearerAuth(),
    UseGuards(JwtAuthGuard, TenantGuard),
    Controller("organizations"),
    __param(0, Inject(PrismaService)),
    __metadata("design:paramtypes", [PrismaService])
], TenantsController);
let TenantsModule = class TenantsModule {
};
TenantsModule = __decorate([
    Module({
        providers: [TenantGuard],
        controllers: [TenantsController],
        exports: [TenantGuard],
    })
], TenantsModule);
export { TenantsModule };
//# sourceMappingURL=tenants.module.js.map