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
import { BadRequestException, Body, Controller, Headers, Inject, Injectable, Post, Req, UseGuards, } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiTags } from "@nestjs/swagger";
import { createHmac, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import { PrismaService } from "../../database/prisma.service.js";
import { SyncQueue } from "../crm-sync/crm-sync.module.js";
export function verifySharedSignature(raw, signature, timestamp, secret) {
    if (!signature ||
        !timestamp ||
        Math.abs(Date.now() - Number(timestamp) * 1_000) > 300_000)
        return false;
    const expected = `sha256=${createHmac("sha256", secret).update(timestamp).update(".").update(raw).digest("hex")}`;
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    return (actualBuffer.length === expectedBuffer.length &&
        timingSafeEqual(actualBuffer, expectedBuffer));
}
let SharedSignatureGuard = class SharedSignatureGuard {
    config;
    constructor(config) {
        this.config = config;
    }
    canActivate(context) {
        const request = context
            .switchToHttp()
            .getRequest();
        const signature = request.headers["x-wrg-signature"];
        const timestamp = request.headers["x-wrg-timestamp"];
        const valid = verifySharedSignature(request.rawBody ?? Buffer.alloc(0), Array.isArray(signature) ? signature[0] : signature, Array.isArray(timestamp) ? timestamp[0] : timestamp, this.config.get(this.secretKey, { infer: true }));
        if (!valid)
            throw new BadRequestException("Invalid or expired webhook signature");
        return true;
    }
};
SharedSignatureGuard = __decorate([
    __param(0, Inject(ConfigService)),
    __metadata("design:paramtypes", [ConfigService])
], SharedSignatureGuard);
let ZohoSignatureGuard = class ZohoSignatureGuard extends SharedSignatureGuard {
    secretKey = "ZOHO_WEBHOOK_SECRET";
};
ZohoSignatureGuard = __decorate([
    Injectable()
], ZohoSignatureGuard);
export { ZohoSignatureGuard };
let CheckMarketSignatureGuard = class CheckMarketSignatureGuard extends SharedSignatureGuard {
    secretKey = "CHECKMARKET_WEBHOOK_SECRET";
};
CheckMarketSignatureGuard = __decorate([
    Injectable()
], CheckMarketSignatureGuard);
export { CheckMarketSignatureGuard };
let WebhooksController = class WebhooksController {
    prisma;
    syncQueue;
    stripe;
    constructor(config, prisma, syncQueue) {
        this.prisma = prisma;
        this.syncQueue = syncQueue;
        this.stripe = new Stripe(config.get("STRIPE_SECRET_KEY", { infer: true }));
        this.stripeSecret = config.get("STRIPE_WEBHOOK_SECRET", { infer: true });
    }
    stripeSecret;
    async stripeWebhook(request, signature) {
        if (!signature || !request.rawBody)
            throw new BadRequestException("Missing Stripe signature");
        let event;
        try {
            event = this.stripe.webhooks.constructEvent(request.rawBody, signature, this.stripeSecret);
        }
        catch {
            throw new BadRequestException("Invalid Stripe signature");
        }
        const stored = await this.prisma.webhookEvent.upsert({
            where: {
                provider_externalId: { provider: "stripe", externalId: event.id },
            },
            update: {},
            create: {
                provider: "stripe",
                externalId: event.id,
                eventType: event.type,
                payload: event,
                signatureValid: true,
            },
        });
        if (!stored.processedAt && event.type === "payment_intent.succeeded") {
            const intent = event.data.object;
            await this.prisma.$transaction([
                this.prisma.order.updateMany({
                    where: { paymentIntentId: intent.id, status: "REQUIRES_PAYMENT" },
                    data: { status: "PAID" },
                }),
                this.prisma.webhookEvent.update({
                    where: { id: stored.id },
                    data: { processedAt: new Date() },
                }),
            ]);
        }
        return { received: true };
    }
    async zoho(body) {
        const externalId = String(body.id ?? body.event_id ?? crypto.randomUUID());
        await this.prisma.webhookEvent.upsert({
            where: { provider_externalId: { provider: "zoho", externalId } },
            update: {},
            create: {
                provider: "zoho",
                externalId,
                eventType: String(body.type ?? "record.changed"),
                payload: body,
                signatureValid: true,
            },
        });
        await this.syncQueue.enqueue({ provider: "zoho", kind: String(body.module ?? "Deals"), externalId }, `zoho:${externalId}`);
        return { queued: true };
    }
    async checkMarket(body) {
        const externalId = String(body.eventId ?? body.RespondentId ?? crypto.randomUUID());
        await this.prisma.webhookEvent.upsert({
            where: { provider_externalId: { provider: "checkmarket", externalId } },
            update: {},
            create: {
                provider: "checkmarket",
                externalId,
                eventType: String(body.type ?? "respondent.changed"),
                payload: body,
                signatureValid: true,
            },
        });
        await this.syncQueue.enqueue({
            provider: "checkmarket",
            kind: "survey",
            externalId: String(body.SurveyId ?? ""),
        }, `checkmarket:${externalId}`);
        return { queued: true };
    }
};
__decorate([
    Post("stripe"),
    __param(0, Req()),
    __param(1, Headers("stripe-signature")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], WebhooksController.prototype, "stripeWebhook", null);
__decorate([
    Post("zoho"),
    UseGuards(ZohoSignatureGuard),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WebhooksController.prototype, "zoho", null);
__decorate([
    Post("checkmarket"),
    UseGuards(CheckMarketSignatureGuard),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WebhooksController.prototype, "checkMarket", null);
WebhooksController = __decorate([
    ApiTags("webhooks"),
    Controller("webhooks"),
    __param(0, Inject(ConfigService)),
    __param(1, Inject(PrismaService)),
    __param(2, Inject(SyncQueue)),
    __metadata("design:paramtypes", [ConfigService,
        PrismaService,
        SyncQueue])
], WebhooksController);
export { WebhooksController };
//# sourceMappingURL=webhooks.controller.js.map