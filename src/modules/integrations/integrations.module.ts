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

interface ZohoRecordPage {
  data: ZohoRecord[];
  info?: {
    more_records?: boolean;
    next_page_token?: string | null;
  };
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

  private async recordPage(
    module: string,
    options: { page?: number; pageToken?: string } = {},
  ): Promise<ZohoRecordPage> {
    if (this.config.get("INTEGRATIONS_MOCK", { infer: true })) {
      return { data: [], info: { more_records: false } };
    }
    return withRetry(async () => {
      const query = new URLSearchParams({ per_page: "200" });
      if (options.pageToken) query.set("page_token", options.pageToken);
      else query.set("page", String(options.page ?? 1));
      const response = await request(
        `${this.config.get("ZOHO_BASE_URL", { infer: true })}/${encodeURIComponent(module)}?${query.toString()}`,
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
      const payload = (await response.body.json()) as {
        data?: ZohoRecord[];
        info?: ZohoRecordPage["info"];
      };
      return {
        data: payload.data ?? [],
        ...(payload.info ? { info: payload.info } : {}),
      };
    });
  }

  async listRecords(module: string, page = 1): Promise<ZohoRecord[]> {
    return (await this.recordPage(module, { page })).data;
  }

  async listAllRecords(module: string): Promise<ZohoRecord[]> {
    const records: ZohoRecord[] = [];
    const perPage = 200;
    const maxPages = 500;
    let pageToken: string | undefined;
    for (let page = 1; page <= maxPages; page += 1) {
      const result = await this.recordPage(module, {
        ...(pageToken ? { pageToken } : { page }),
      });
      records.push(...result.data);
      if (
        result.info?.more_records === false ||
        (result.info?.more_records === undefined &&
          result.data.length < perPage)
      ) {
        return records;
      }
      const nextPageToken = result.info?.next_page_token;
      if (nextPageToken) pageToken = nextPageToken;
      else if (pageToken) {
        throw new Error("Zoho did not return the next records page token");
      }
    }
    throw new Error("Zoho records exceeded the supported pagination limit");
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
      throw new Error(
        "CheckMarket is disabled locally; load survey data into PostgreSQL with a seed command",
      );
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
      return [];
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
