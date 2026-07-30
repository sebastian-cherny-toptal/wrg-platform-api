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
import { Body, Controller, Get, Inject, Injectable, Module, Param, Post, UseGuards, } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, Min, } from "class-validator";
import Stripe from "stripe";
import { PrismaService } from "../../database/prisma.service.js";
import { JwtAuthGuard } from "../auth/auth.module.js";
import { TenantGuard } from "../tenants/tenants.module.js";
class CheckoutDto {
    currency;
    amountMinor;
    items;
    organizationProgramId;
    paymentMethod;
}
__decorate([
    IsString(),
    IsIn(["USD", "CAD", "GBP"]),
    __metadata("design:type", String)
], CheckoutDto.prototype, "currency", void 0);
__decorate([
    IsInt(),
    Min(1),
    __metadata("design:type", Number)
], CheckoutDto.prototype, "amountMinor", void 0);
__decorate([
    IsArray(),
    IsObject({ each: true }),
    __metadata("design:type", Array)
], CheckoutDto.prototype, "items", void 0);
__decorate([
    IsOptional(),
    IsString(),
    __metadata("design:type", String)
], CheckoutDto.prototype, "organizationProgramId", void 0);
__decorate([
    IsIn(["card", "invoice"]),
    __metadata("design:type", String)
], CheckoutDto.prototype, "paymentMethod", void 0);
const asJson = (value) => value;
let CommerceService = class CommerceService {
    prisma;
    config;
    stripe;
    constructor(prisma, config) {
        this.prisma = prisma;
        this.config = config;
        this.stripe = new Stripe(config.get("STRIPE_SECRET_KEY", { infer: true }));
    }
    async checkout(organizationId, dto) {
        const organization = await this.prisma.organization.findUniqueOrThrow({
            where: { id: organizationId },
        });
        if (dto.organizationProgramId) {
            await this.prisma.organizationProgram.findFirstOrThrow({
                where: { id: dto.organizationProgramId, organizationId },
                select: { id: true },
            });
        }
        if (dto.paymentMethod === "invoice") {
            return this.prisma.order.create({
                data: {
                    organizationId,
                    organizationProgramId: dto.organizationProgramId ?? null,
                    currency: dto.currency,
                    amountMinor: dto.amountMinor,
                    items: asJson(dto.items),
                    paymentMethod: "invoice",
                    status: "INVOICED",
                },
            });
        }
        if (this.config.get("INTEGRATIONS_MOCK", { infer: true })) {
            return this.prisma.order.create({
                data: {
                    organizationId,
                    organizationProgramId: dto.organizationProgramId ?? null,
                    paymentIntentId: `pi_mock_${crypto.randomUUID()}`,
                    currency: dto.currency,
                    amountMinor: dto.amountMinor,
                    items: asJson(dto.items),
                    paymentMethod: "card",
                    status: "REQUIRES_PAYMENT",
                },
            });
        }
        const intent = await this.stripe.paymentIntents.create({
            amount: dto.amountMinor,
            currency: dto.currency.toLowerCase(),
            ...(organization.stripeCustomerId
                ? { customer: organization.stripeCustomerId }
                : {}),
            metadata: { organizationId },
        }, { idempotencyKey: `checkout:${organizationId}:${crypto.randomUUID()}` });
        const order = await this.prisma.order.create({
            data: {
                organizationId,
                organizationProgramId: dto.organizationProgramId ?? null,
                paymentIntentId: intent.id,
                currency: dto.currency,
                amountMinor: dto.amountMinor,
                items: asJson(dto.items),
                paymentMethod: "card",
                status: "REQUIRES_PAYMENT",
            },
        });
        return { ...order, clientSecret: intent.client_secret };
    }
};
CommerceService = __decorate([
    Injectable(),
    __param(0, Inject(PrismaService)),
    __param(1, Inject(ConfigService)),
    __metadata("design:paramtypes", [PrismaService,
        ConfigService])
], CommerceService);
let CommerceController = class CommerceController {
    commerce;
    prisma;
    constructor(commerce, prisma) {
        this.commerce = commerce;
        this.prisma = prisma;
    }
    checkout(organizationId, body) {
        return this.commerce.checkout(organizationId, body);
    }
    orders(organizationId) {
        return this.prisma.order.findMany({
            where: { organizationId },
            orderBy: { createdAt: "desc" },
        });
    }
};
__decorate([
    Post("checkout"),
    __param(0, Param("organizationId")),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, CheckoutDto]),
    __metadata("design:returntype", void 0)
], CommerceController.prototype, "checkout", null);
__decorate([
    Get("orders"),
    __param(0, Param("organizationId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CommerceController.prototype, "orders", null);
CommerceController = __decorate([
    ApiTags("commerce"),
    ApiBearerAuth(),
    UseGuards(JwtAuthGuard, TenantGuard),
    Controller("organizations/:organizationId/commerce"),
    __param(0, Inject(CommerceService)),
    __param(1, Inject(PrismaService)),
    __metadata("design:paramtypes", [CommerceService,
        PrismaService])
], CommerceController);
let CommerceModule = class CommerceModule {
};
CommerceModule = __decorate([
    Module({ providers: [CommerceService], controllers: [CommerceController] })
], CommerceModule);
export { CommerceModule };
//# sourceMappingURL=commerce.module.js.map