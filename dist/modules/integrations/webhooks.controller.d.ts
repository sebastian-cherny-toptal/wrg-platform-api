import { CanActivate, ExecutionContext } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { FastifyRequest } from "fastify";
import type { Env } from "../../config/env.js";
import { PrismaService } from "../../database/prisma.service.js";
import { SyncQueue } from "../crm-sync/crm-sync.module.js";
export declare function verifySharedSignature(raw: Buffer, signature: string | undefined, timestamp: string | undefined, secret: string): boolean;
declare abstract class SharedSignatureGuard implements CanActivate {
    protected readonly config: ConfigService<Env, true>;
    protected abstract readonly secretKey: "ZOHO_WEBHOOK_SECRET" | "CHECKMARKET_WEBHOOK_SECRET";
    constructor(config: ConfigService<Env, true>);
    canActivate(context: ExecutionContext): boolean;
}
export declare class ZohoSignatureGuard extends SharedSignatureGuard {
    protected readonly secretKey: "ZOHO_WEBHOOK_SECRET";
}
export declare class CheckMarketSignatureGuard extends SharedSignatureGuard {
    protected readonly secretKey: "CHECKMARKET_WEBHOOK_SECRET";
}
export declare class WebhooksController {
    private readonly prisma;
    private readonly syncQueue;
    private readonly stripe;
    constructor(config: ConfigService<Env, true>, prisma: PrismaService, syncQueue: SyncQueue);
    private readonly stripeSecret;
    stripeWebhook(request: RawBodyRequest<FastifyRequest>, signature: string | undefined): Promise<{
        received: true;
    }>;
    zoho(body: Record<string, unknown>): Promise<{
        queued: true;
    }>;
    checkMarket(body: Record<string, unknown>): Promise<{
        queued: true;
    }>;
}
export {};
