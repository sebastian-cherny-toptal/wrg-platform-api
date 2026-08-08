import { Inject, Injectable, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { request } from "undici";
import type { Env } from "../../config/env.js";

async function withRetry<T>(
  operation: () => Promise<T>,
  attempts = 4,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) {
        await new Promise((resolve) =>
          setTimeout(resolve, 150 * 2 ** attempt + Math.random() * 100),
        );
      }
    }
  }
  throw lastError;
}

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

@Injectable()
export class ZohoAdapter {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  async listRecords(module: string, page = 1): Promise<ZohoRecord[]> {
    if (this.config.get("INTEGRATIONS_MOCK", { infer: true })) {
      return [{ id: `zoho-mock-${module}-${page}`, Name: `Mock ${module}` }];
    }
    return withRetry(async () => {
      const response = await request(
        `${this.config.get("ZOHO_BASE_URL", { infer: true })}/${encodeURIComponent(module)}?page=${page}`,
        {
          headers: {
            "x-client-id": this.config.get("ZOHO_CLIENT_ID", { infer: true }),
            "x-client-secret": this.config.get("ZOHO_CLIENT_SECRET", {
              infer: true,
            }),
          },
        },
      );
      if (response.statusCode >= 500 || response.statusCode === 429)
        throw new Error(`Zoho transient error ${response.statusCode}`);
      if (response.statusCode >= 400)
        throw new Error(`Zoho request failed ${response.statusCode}`);
      const payload = (await response.body.json()) as { data?: ZohoRecord[] };
      return payload.data ?? [];
    });
  }

  async updateRecord(
    module: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<ZohoRecord> {
    if (this.config.get("INTEGRATIONS_MOCK", { infer: true }))
      return { id, ...data };
    return withRetry(async () => {
      const response = await request(
        `${this.config.get("ZOHO_BASE_URL", { infer: true })}/${encodeURIComponent(module)}/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-client-id": this.config.get("ZOHO_CLIENT_ID", { infer: true }),
            "x-client-secret": this.config.get("ZOHO_CLIENT_SECRET", {
              infer: true,
            }),
          },
          body: JSON.stringify({ data: [data] }),
        },
      );
      if (response.statusCode >= 500 || response.statusCode === 429)
        throw new Error(`Zoho transient error ${response.statusCode}`);
      if (response.statusCode >= 400)
        throw new Error(`Zoho request failed ${response.statusCode}`);
      return { id, ...data };
    });
  }
}

@Injectable()
export class CheckMarketAdapter {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  async getSurvey(id: number): Promise<CheckMarketSurvey> {
    if (this.config.get("INTEGRATIONS_MOCK", { infer: true })) {
      return { Id: id, Title: `Mock survey ${id}`, SurveyStatusId: "1" };
    }
    return withRetry(async () => {
      const response = await request(
        `${this.config.get("CHECKMARKET_BASE_URL", { infer: true })}/surveys/${id}`,
        {
          headers: {
            authorization: `Bearer ${this.config.get("CHECKMARKET_API_KEY", { infer: true })}`,
          },
        },
      );
      if (response.statusCode >= 500 || response.statusCode === 429) {
        throw new Error(`CheckMarket transient error ${response.statusCode}`);
      }
      if (response.statusCode >= 400)
        throw new Error(`CheckMarket request failed ${response.statusCode}`);
      return (await response.body.json()) as CheckMarketSurvey;
    });
  }

  async listSurveys(): Promise<CheckMarketSurvey[]> {
    if (this.config.get("INTEGRATIONS_MOCK", { infer: true })) {
      return [{ Id: 1, Title: "Mock survey 1", SurveyStatusId: "1" }];
    }
    return withRetry(async () => {
      const response = await request(
        `${this.config.get("CHECKMARKET_BASE_URL", { infer: true })}/surveys`,
        {
          headers: {
            authorization: `Bearer ${this.config.get("CHECKMARKET_API_KEY", { infer: true })}`,
          },
        },
      );
      if (response.statusCode >= 500 || response.statusCode === 429) {
        throw new Error(`CheckMarket transient error ${response.statusCode}`);
      }
      if (response.statusCode >= 400) {
        throw new Error(`CheckMarket request failed ${response.statusCode}`);
      }
      const payload = (await response.body.json()) as
        | CheckMarketSurvey[]
        | { data?: CheckMarketSurvey[]; Data?: CheckMarketSurvey[] };
      return Array.isArray(payload)
        ? payload
        : (payload.data ?? payload.Data ?? []);
    });
  }

  async activateWebhook(id: string): Promise<{ activated: true }> {
    if (this.config.get("INTEGRATIONS_MOCK", { infer: true })) {
      return { activated: true };
    }
    return withRetry(async () => {
      const response = await request(
        `${this.config.get("CHECKMARKET_BASE_URL", { infer: true })}/hooks/${encodeURIComponent(id)}/activate`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.config.get("CHECKMARKET_API_KEY", { infer: true })}`,
          },
        },
      );
      if (response.statusCode >= 500 || response.statusCode === 429) {
        throw new Error(`CheckMarket transient error ${response.statusCode}`);
      }
      if (response.statusCode >= 400) {
        throw new Error(`CheckMarket request failed ${response.statusCode}`);
      }
      return { activated: true };
    });
  }
}

@Module({
  providers: [ZohoAdapter, CheckMarketAdapter],
  exports: [ZohoAdapter, CheckMarketAdapter],
})
export class IntegrationsModule {}
