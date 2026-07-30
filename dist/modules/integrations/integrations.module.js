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
import { Inject, Injectable, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { request } from "undici";
async function withRetry(operation, attempts = 4) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            return await operation();
        }
        catch (error) {
            lastError = error;
            if (attempt + 1 < attempts) {
                await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt + Math.random() * 100));
            }
        }
    }
    throw lastError;
}
let ZohoAdapter = class ZohoAdapter {
    config;
    constructor(config) {
        this.config = config;
    }
    async listRecords(module, page = 1) {
        if (this.config.get("INTEGRATIONS_MOCK", { infer: true })) {
            return [{ id: `zoho-mock-${module}-${page}`, Name: `Mock ${module}` }];
        }
        return withRetry(async () => {
            const response = await request(`${this.config.get("ZOHO_BASE_URL", { infer: true })}/${encodeURIComponent(module)}?page=${page}`, {
                headers: {
                    "x-client-id": this.config.get("ZOHO_CLIENT_ID", { infer: true }),
                    "x-client-secret": this.config.get("ZOHO_CLIENT_SECRET", {
                        infer: true,
                    }),
                },
            });
            if (response.statusCode >= 500 || response.statusCode === 429)
                throw new Error(`Zoho transient error ${response.statusCode}`);
            if (response.statusCode >= 400)
                throw new Error(`Zoho request failed ${response.statusCode}`);
            const payload = (await response.body.json());
            return payload.data ?? [];
        });
    }
    async updateRecord(module, id, data) {
        if (this.config.get("INTEGRATIONS_MOCK", { infer: true }))
            return { id, ...data };
        return withRetry(async () => {
            const response = await request(`${this.config.get("ZOHO_BASE_URL", { infer: true })}/${encodeURIComponent(module)}/${encodeURIComponent(id)}`, {
                method: "PATCH",
                headers: {
                    "content-type": "application/json",
                    "x-client-id": this.config.get("ZOHO_CLIENT_ID", { infer: true }),
                    "x-client-secret": this.config.get("ZOHO_CLIENT_SECRET", {
                        infer: true,
                    }),
                },
                body: JSON.stringify({ data: [data] }),
            });
            if (response.statusCode >= 500 || response.statusCode === 429)
                throw new Error(`Zoho transient error ${response.statusCode}`);
            if (response.statusCode >= 400)
                throw new Error(`Zoho request failed ${response.statusCode}`);
            return { id, ...data };
        });
    }
};
ZohoAdapter = __decorate([
    Injectable(),
    __param(0, Inject(ConfigService)),
    __metadata("design:paramtypes", [ConfigService])
], ZohoAdapter);
export { ZohoAdapter };
let CheckMarketAdapter = class CheckMarketAdapter {
    config;
    constructor(config) {
        this.config = config;
    }
    async getSurvey(id) {
        if (this.config.get("INTEGRATIONS_MOCK", { infer: true })) {
            return { Id: id, Title: `Mock survey ${id}`, SurveyStatusId: "1" };
        }
        return withRetry(async () => {
            const response = await request(`${this.config.get("CHECKMARKET_BASE_URL", { infer: true })}/surveys/${id}`, {
                headers: {
                    authorization: `Bearer ${this.config.get("CHECKMARKET_API_KEY", { infer: true })}`,
                },
            });
            if (response.statusCode >= 500 || response.statusCode === 429) {
                throw new Error(`CheckMarket transient error ${response.statusCode}`);
            }
            if (response.statusCode >= 400)
                throw new Error(`CheckMarket request failed ${response.statusCode}`);
            return (await response.body.json());
        });
    }
};
CheckMarketAdapter = __decorate([
    Injectable(),
    __param(0, Inject(ConfigService)),
    __metadata("design:paramtypes", [ConfigService])
], CheckMarketAdapter);
export { CheckMarketAdapter };
let IntegrationsModule = class IntegrationsModule {
};
IntegrationsModule = __decorate([
    Module({
        providers: [ZohoAdapter, CheckMarketAdapter],
        exports: [ZohoAdapter, CheckMarketAdapter],
    })
], IntegrationsModule);
export { IntegrationsModule };
//# sourceMappingURL=integrations.module.js.map