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

interface ZohoErrorPayload {
  code?: unknown;
  details?: unknown;
  message?: unknown;
}

function zohoErrorMessage(statusCode: number, body: string): string {
  let detail = body.trim();
  try {
    const payload = JSON.parse(body) as ZohoErrorPayload;
    detail = [payload.code, payload.message]
      .filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      )
      .join(": ");
    if (!detail && payload.details !== undefined) {
      detail = JSON.stringify(payload.details);
    }
  } catch {
    // Keep the plain-text response when Zoho did not return JSON.
  }
  return `Zoho request failed ${statusCode}${detail ? `: ${detail.slice(0, 500)}` : ""}`;
}

function zohoRecordPage(payload: unknown): ZohoRecordPage {
  if (Array.isArray(payload)) {
    return { data: payload as ZohoRecord[], info: { more_records: false } };
  }
  if (payload === null || typeof payload !== "object") return { data: [] };
  const envelope = payload as Record<string, unknown>;
  const nested =
    envelope.data !== null &&
    typeof envelope.data === "object" &&
    !Array.isArray(envelope.data)
      ? (envelope.data as Record<string, unknown>)
      : undefined;
  const records = Array.isArray(envelope.data)
    ? envelope.data
    : Array.isArray(envelope.Data)
      ? envelope.Data
      : Array.isArray(nested?.data)
        ? nested.data
        : Array.isArray(nested?.Data)
          ? nested.Data
          : [];
  const info =
    envelope.info !== null && typeof envelope.info === "object"
      ? (envelope.info as ZohoRecordPage["info"])
      : nested?.info !== null && typeof nested?.info === "object"
        ? (nested.info as ZohoRecordPage["info"])
        : undefined;
  return {
    data: records as ZohoRecord[],
    ...(info ? { info } : {}),
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
  private accessToken?: {
    apiDomain: string;
    expiresAt: number;
    value: string;
  };

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  private async directAccessToken(): Promise<{
    apiDomain: string;
    value: string;
  }> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now()) {
      return this.accessToken;
    }
    const refreshToken = this.config.get("ZOHO_REFRESH_TOKEN", {
      infer: true,
    });
    if (!refreshToken) throw new Error("Zoho refresh token is not configured");
    const accountsUrl = (
      this.config.get("ZOHO_ACCOUNTS_URL", { infer: true }) ??
      "https://accounts.zoho.com"
    ).replace(/\/$/u, "");
    const response = await request(`${accountsUrl}/oauth/v2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.get("ZOHO_CLIENT_ID", { infer: true }),
        client_secret: this.config.get("ZOHO_CLIENT_SECRET", { infer: true }),
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
    const payload = (await response.body.json()) as {
      access_token?: string;
      api_domain?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (response.statusCode >= 400 || !payload.access_token) {
      throw new Error(
        `Zoho OAuth refresh failed ${response.statusCode}: ${payload.error_description ?? payload.error ?? "missing access token"}`,
      );
    }
    const token = {
      value: payload.access_token,
      apiDomain: (payload.api_domain ?? "https://www.zohoapis.com").replace(
        /\/$/u,
        "",
      ),
      expiresAt:
        Date.now() + Math.max(0, (payload.expires_in ?? 3600) - 60) * 1000,
    };
    this.accessToken = token;
    return token;
  }

  private async recordPage(
    module: string,
    options: { fields?: string[]; page?: number; pageToken?: string } = {},
  ): Promise<ZohoRecordPage> {
    if (this.config.get("INTEGRATIONS_MOCK", { infer: true })) {
      return { data: [], info: { more_records: false } };
    }
    return withRetry(async () => {
      const query = new URLSearchParams({ per_page: "200" });
      if (options.fields?.length) query.set("fields", options.fields.join(","));
      if (options.pageToken) query.set("page_token", options.pageToken);
      else query.set("page", String(options.page ?? 1));
      const refreshToken = this.config.get("ZOHO_REFRESH_TOKEN", {
        infer: true,
      });
      const direct = refreshToken ? await this.directAccessToken() : undefined;
      const url = direct
        ? `${direct.apiDomain}/crm/${encodeURIComponent(this.config.get("ZOHO_API_VERSION", { infer: true }))}/${encodeURIComponent(module)}?${query.toString()}`
        : `${this.config.get("ZOHO_BASE_URL", { infer: true })}/${encodeURIComponent(module)}?${query.toString()}`;
      const response = await request(url, {
        headers: direct
          ? { authorization: `Zoho-oauthtoken ${direct.value}` }
          : {
              "x-client-id": this.config.get("ZOHO_CLIENT_ID", {
                infer: true,
              }),
              "x-client-secret": this.config.get("ZOHO_CLIENT_SECRET", {
                infer: true,
              }),
            },
      });
      if (response.statusCode === 204) return { data: [] };
      const body = await response.body.text();
      if (response.statusCode >= 400)
        throw new Error(zohoErrorMessage(response.statusCode, body));
      if (!body.trim()) return { data: [] };
      try {
        return zohoRecordPage(JSON.parse(body) as unknown);
      } catch {
        throw new Error("Zoho returned a non-JSON records response");
      }
    });
  }

  private async searchPage(
    module: string,
    criteria: string,
    options: { fields?: string[]; page?: number } = {},
  ): Promise<ZohoRecordPage> {
    if (this.config.get("INTEGRATIONS_MOCK", { infer: true })) {
      return { data: [], info: { more_records: false } };
    }
    return withRetry(async () => {
      const query = new URLSearchParams({
        criteria,
        per_page: "200",
        page: String(options.page ?? 1),
      });
      if (options.fields?.length) query.set("fields", options.fields.join(","));
      const refreshToken = this.config.get("ZOHO_REFRESH_TOKEN", {
        infer: true,
      });
      const direct = refreshToken ? await this.directAccessToken() : undefined;
      const url = direct
        ? `${direct.apiDomain}/crm/${encodeURIComponent(this.config.get("ZOHO_API_VERSION", { infer: true }))}/${encodeURIComponent(module)}/search?${query.toString()}`
        : `${this.config.get("ZOHO_BASE_URL", { infer: true })}/${encodeURIComponent(module)}/search?${query.toString()}`;
      const response = await request(url, {
        headers: direct
          ? { authorization: `Zoho-oauthtoken ${direct.value}` }
          : {
              "x-client-id": this.config.get("ZOHO_CLIENT_ID", {
                infer: true,
              }),
              "x-client-secret": this.config.get("ZOHO_CLIENT_SECRET", {
                infer: true,
              }),
            },
      });
      if (response.statusCode === 204) return { data: [] };
      const body = await response.body.text();
      if (response.statusCode >= 400)
        throw new Error(zohoErrorMessage(response.statusCode, body));
      if (!body.trim()) return { data: [] };
      try {
        return zohoRecordPage(JSON.parse(body) as unknown);
      } catch {
        throw new Error("Zoho returned a non-JSON search response");
      }
    });
  }

  async listRecords(
    module: string,
    page = 1,
    fields: string[] = ["id"],
  ): Promise<ZohoRecord[]> {
    return (await this.recordPage(module, { fields, page })).data;
  }

  async listAllRecords(
    module: string,
    fields: string[] = ["id"],
  ): Promise<ZohoRecord[]> {
    const records: ZohoRecord[] = [];
    const perPage = 200;
    const maxPages = 500;
    let pageToken: string | undefined;
    for (let page = 1; page <= maxPages; page += 1) {
      const result = await this.recordPage(module, {
        fields,
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

  async searchAllRecords(
    module: string,
    criteria: string,
    fields?: string[],
  ): Promise<ZohoRecord[]> {
    const records: ZohoRecord[] = [];
    const maxPages = 10;
    for (let page = 1; page <= maxPages; page += 1) {
      const result = await this.searchPage(module, criteria, {
        ...(fields ? { fields } : {}),
        page,
      });
      records.push(...result.data);
      if (!result.info?.more_records) return records;
    }
    throw new Error("Zoho search exceeded its 2,000-record limit");
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
