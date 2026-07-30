import type { Prisma } from "@prisma/client";
import { Queue } from "bullmq";
import { PrismaService } from "../../database/prisma.service.js";
export interface SyncPayload {
    provider: "zoho" | "checkmarket";
    kind: string;
    externalId?: string;
    cursor?: string;
    idempotencyKey?: string;
}
export declare class SyncQueue {
    private readonly queue;
    private readonly prisma;
    constructor(queue: Queue<SyncPayload>, prisma: PrismaService);
    enqueue(payload: SyncPayload, idempotencyKey: string): Promise<{
        output: Prisma.JsonValue | null;
        error: string | null;
        input: Prisma.JsonValue;
        id: string;
        legacyId: string | null;
        externalId: string | null;
        status: import("@prisma/client").$Enums.JobStatus;
        createdAt: Date;
        updatedAt: Date;
        cursor: string | null;
        idempotencyKey: string;
        provider: string;
        kind: string;
        attempts: number;
        startedAt: Date | null;
        finishedAt: Date | null;
    }>;
}
export declare class CrmSyncModule {
}
