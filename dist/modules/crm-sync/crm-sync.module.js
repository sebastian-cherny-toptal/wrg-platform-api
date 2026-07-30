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
import { BullModule, InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Injectable, Module } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Queue } from "bullmq";
import { PrismaService } from "../../database/prisma.service.js";
import { CheckMarketAdapter, IntegrationsModule, ZohoAdapter, } from "../integrations/integrations.module.js";
let SyncQueue = class SyncQueue {
    queue;
    prisma;
    constructor(queue, prisma) {
        this.queue = queue;
        this.prisma = prisma;
    }
    async enqueue(payload, idempotencyKey) {
        const existing = await this.prisma.syncJob.findUnique({
            where: { idempotencyKey },
        });
        if (existing)
            return existing;
        const record = await this.prisma.syncJob.create({
            data: {
                provider: payload.provider,
                kind: payload.kind,
                idempotencyKey,
                input: payload,
            },
        });
        const jobId = createHash("sha256").update(idempotencyKey).digest("hex");
        await this.queue.add(payload.kind, { ...payload, idempotencyKey }, {
            jobId,
            attempts: 5,
            backoff: { type: "exponential", delay: 1_000 },
            removeOnComplete: 1_000,
            removeOnFail: 5_000,
        });
        return record;
    }
};
SyncQueue = __decorate([
    Injectable(),
    __param(0, InjectQueue("integrations")),
    __param(1, Inject(PrismaService)),
    __metadata("design:paramtypes", [Queue,
        PrismaService])
], SyncQueue);
export { SyncQueue };
let SyncProcessor = class SyncProcessor extends WorkerHost {
    prisma;
    zoho;
    checkMarket;
    constructor(prisma, zoho, checkMarket) {
        super();
        this.prisma = prisma;
        this.zoho = zoho;
        this.checkMarket = checkMarket;
    }
    async process(job) {
        const idempotencyKey = job.data.idempotencyKey;
        if (!idempotencyKey)
            throw new Error("Sync job is missing its idempotency key");
        await this.prisma.syncJob.updateMany({
            where: { idempotencyKey },
            data: {
                status: "RUNNING",
                startedAt: new Date(),
                attempts: { increment: 1 },
            },
        });
        try {
            const output = job.data.provider === "zoho"
                ? await this.zoho.listRecords(job.data.kind)
                : await this.checkMarket.getSurvey(Number(job.data.externalId));
            await this.prisma.syncJob.updateMany({
                where: { idempotencyKey },
                data: {
                    status: "SUCCEEDED",
                    output: output,
                    finishedAt: new Date(),
                    error: null,
                },
            });
            return output;
        }
        catch (error) {
            await this.prisma.syncJob.updateMany({
                where: { idempotencyKey },
                data: {
                    status: "FAILED",
                    error: error instanceof Error ? error.message : "Unknown error",
                    finishedAt: new Date(),
                },
            });
            throw error;
        }
    }
};
SyncProcessor = __decorate([
    Processor("integrations"),
    __param(0, Inject(PrismaService)),
    __param(1, Inject(ZohoAdapter)),
    __param(2, Inject(CheckMarketAdapter)),
    __metadata("design:paramtypes", [PrismaService,
        ZohoAdapter,
        CheckMarketAdapter])
], SyncProcessor);
let CrmSyncModule = class CrmSyncModule {
};
CrmSyncModule = __decorate([
    Module({
        imports: [
            IntegrationsModule,
            BullModule.registerQueue({ name: "integrations" }),
        ],
        providers: [SyncQueue, SyncProcessor],
        exports: [SyncQueue],
    })
], CrmSyncModule);
export { CrmSyncModule };
//# sourceMappingURL=crm-sync.module.js.map