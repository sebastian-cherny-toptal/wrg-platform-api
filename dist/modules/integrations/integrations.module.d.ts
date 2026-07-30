import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.js";
export interface ZohoRecord {
    id: string;
    Modified_Time?: string;
    [key: string]: unknown;
}
export interface CheckMarketSurvey {
    Id: number;
    Title: string;
    SurveyStatusId: string;
    LastModifyDate?: string;
}
export declare class ZohoAdapter {
    private readonly config;
    constructor(config: ConfigService<Env, true>);
    listRecords(module: string, page?: number): Promise<ZohoRecord[]>;
    updateRecord(module: string, id: string, data: Record<string, unknown>): Promise<ZohoRecord>;
}
export declare class CheckMarketAdapter {
    private readonly config;
    constructor(config: ConfigService<Env, true>);
    getSurvey(id: number): Promise<CheckMarketSurvey>;
}
export declare class IntegrationsModule {
}
