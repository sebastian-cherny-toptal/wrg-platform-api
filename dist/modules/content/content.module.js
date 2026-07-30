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
import { Controller, Get, Inject, Module, Param, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../../database/prisma.service.js";
import { JwtAuthGuard } from "../auth/auth.module.js";
import { TenantGuard } from "../tenants/tenants.module.js";
let ContentController = class ContentController {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    list(organizationId) {
        return this.prisma.asset.findMany({
            where: { organizationId },
            orderBy: { createdAt: "desc" },
        });
    }
};
__decorate([
    Get(),
    __param(0, Param("organizationId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ContentController.prototype, "list", null);
ContentController = __decorate([
    ApiTags("content"),
    ApiBearerAuth(),
    UseGuards(JwtAuthGuard, TenantGuard),
    Controller("organizations/:organizationId/assets"),
    __param(0, Inject(PrismaService)),
    __metadata("design:paramtypes", [PrismaService])
], ContentController);
let ContentModule = class ContentModule {
};
ContentModule = __decorate([
    Module({ controllers: [ContentController] })
], ContentModule);
export { ContentModule };
//# sourceMappingURL=content.module.js.map