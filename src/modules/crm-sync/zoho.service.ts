import { request } from "undici";

export interface ZohoRecord {
  id: string;
  [key: string]: unknown;
}

interface ZohoResponse<T = unknown> {
  data?: T;
  count?: number;
  info?: { more_records?: boolean };
  state?: string;
}

export interface ZohoServiceOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  grantType?: string;
  accountsUrl?: string;
  baseUrl?: string;
}

/**
 * Zoho CRM client ported from the legacy API's helper/zoho.service.js.
 *
 * The old Mongo/Redis-specific addProgram and addOrganization methods do not
 * belong in this HTTP client. Token caching is kept in-process instead.
 */
export class ZohoService {
  readonly org_module = "Accounts";
  readonly project_module = "Main_Projects";
  readonly program_module = "Programs";
  readonly client_module = "Contacts";
  readonly deal_module = "Deals";
  readonly product_module = "Products";

  private readonly baseUrl: string;
  private readonly accountsUrl: string;
  private accessToken?: { value: string; expiresAt: number };

  constructor(private readonly options: ZohoServiceOptions) {
    this.baseUrl = (options.baseUrl ?? "https://www.zohoapis.com").replace(/\/$/, "");
    this.accountsUrl = (options.accountsUrl ?? "https://accounts.zoho.com").replace(/\/$/, "");
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): ZohoService {
    const required = (name: string): string => {
      const value = env[name];
      if (!value) throw new Error(`Missing required environment variable ${name}`);
      return value;
    };
    return new ZohoService({
      clientId: required("ZOHO_CLIENT_ID"),
      clientSecret: required("ZOHO_CLIENT_SECRET"),
      refreshToken: required("ZOHO_REFRESH_TOKEN"),
      grantType: env.ZOHO_GRANT_TYPE ?? "refresh_token",
      ...(env.ZOHO_CRM_BASE_URL ? { baseUrl: env.ZOHO_CRM_BASE_URL } : {}),
      ...(env.ZOHO_ACCOUNTS_URL ? { accountsUrl: env.ZOHO_ACCOUNTS_URL } : {}),
    });
  }

  async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  isRateLimitError(error: unknown): boolean {
    return error instanceof Error && /Zoho request failed (420|429)|too many requests/i.test(error.message);
  }

  private async zohoRequest<T>(
    path: string,
    init: { method?: string; token?: string; body?: unknown; form?: URLSearchParams } = {},
    maxRetries = 3,
  ): Promise<ZohoResponse<T>> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await request(path.startsWith("http") ? path : `${this.baseUrl}${path}`, {
          method: init.method ?? "GET",
          headers: {
            ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
            ...(init.body ? { "content-type": "application/json" } : {}),
            ...(init.form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
          },
          ...(init.body ? { body: JSON.stringify(init.body) } : {}),
          ...(init.form ? { body: init.form.toString() } : {}),
          headersTimeout: 30_000,
          bodyTimeout: 30_000,
        });
        const payload = (await response.body.json()) as ZohoResponse<T> & {
          message?: string;
          error_description?: string;
        };
        if (response.statusCode >= 400) {
          throw new Error(
            `Zoho request failed ${response.statusCode}: ${payload.message ?? payload.error_description ?? "unknown error"}`,
          );
        }
        return payload;
      } catch (error) {
        lastError = error;
        if (attempt === maxRetries || (!this.isRateLimitError(error) && !(error instanceof Error && /Zoho request failed (408|5\d\d)/.test(error.message)))) throw error;
        await this.sleep(1_000 * (attempt + 1));
      }
    }
    throw lastError;
  }

  async getAuthToken(): Promise<{ access_token: string; expires_in?: number }> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now()) {
      return { access_token: this.accessToken.value };
    }
    const form = new URLSearchParams({
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      refresh_token: this.options.refreshToken,
      grant_type: this.options.grantType ?? "refresh_token",
    });
    const result = await this.zohoRequest<{ access_token?: string }>(
      `${this.accountsUrl}/oauth/v2/token`,
      { method: "POST", form },
    ) as unknown as { access_token?: string; expires_in?: number };
    if (!result.access_token) throw new Error("Zoho token response did not contain access_token");
    this.accessToken = {
      value: result.access_token,
      expiresAt: Date.now() + Math.max(0, (result.expires_in ?? 3600) - 60) * 1000,
    };
    return { access_token: result.access_token, ...(result.expires_in ? { expires_in: result.expires_in } : {}) };
  }

  async fetchDataWithRecursiveCall(module: string, accessToken: string, ids: string[] = []): Promise<ZohoRecord[]> {
    if (ids.length) {
      const pages = await Promise.all(ids.map((id) => this.zohoRequest<ZohoRecord[]>(`/crm/v5/${encodeURIComponent(module)}/${encodeURIComponent(id)}`, { token: accessToken })));
      return pages.flatMap((page) => page.data ?? []);
    }
    const count = await this.zohoRequest<never>(`/crm/v5/${encodeURIComponent(module)}/actions/count`, { token: accessToken });
    const pageCount = Math.ceil((count.count ?? 0) / 200);
    const pages = await Promise.all(Array.from({ length: pageCount }, (_, index) => this.zohoRequest<ZohoRecord[]>(`/crm/v5/${encodeURIComponent(module)}?page=${index + 1}&per_page=200`, { token: accessToken })));
    return pages.flatMap((page) => page.data ?? []);
  }

  async fetchDataWithRecursiveCallV2(module: string, accessToken: string, ids: string[] = []): Promise<ZohoRecord[]> {
    if (ids.length) {
      const results: ZohoRecord[] = [];
      for (let offset = 0; offset < ids.length; offset += 50) {
        const batch = ids.slice(offset, offset + 50).map(encodeURIComponent).join(",");
        const response = await this.zohoRequest<ZohoRecord[]>(`/crm/v2/${encodeURIComponent(module)}?ids=${batch}`, { token: accessToken });
        results.push(...(response.data ?? []));
      }
      return results;
    }
    const results: ZohoRecord[] = [];
    for (let page = 1; ; page += 1) {
      const response = await this.zohoRequest<ZohoRecord[]>(`/crm/v2/${encodeURIComponent(module)}?page=${page}&per_page=200`, { token: accessToken });
      const records = response.data ?? [];
      results.push(...records);
      if (records.length < 200) return results;
    }
  }

  async fetchDataWithCOQL(module: string, accessToken: string, ids: string[] | null = null): Promise<ZohoRecord[]> {
    const where = ids?.length ? ` where ${ids.map((id) => `(Id = '${id.replaceAll("'", "\\'")}')`).join(" or ")}` : "";
    const response = await this.zohoRequest<ZohoRecord[]>("/crm/v5/coql", { method: "POST", token: accessToken, body: { select_query: `select id from ${module}${where} limit 200` } });
    return response.data ?? [];
  }

  async fetchDataWithCOQLV2(query: string): Promise<ZohoRecord[]> {
    const { access_token } = await this.getAuthToken();
    const response = await this.zohoRequest<ZohoRecord[]>("/crm/v5/coql", { method: "POST", token: access_token, body: { select_query: query } });
    return response.data ?? [];
  }

  async getZohoModules(): Promise<unknown> {
    const { access_token } = await this.getAuthToken();
    return this.zohoRequest("/crm/v5/settings/modules", { token: access_token });
  }

  private async all(module: string, ids?: string[]): Promise<ZohoRecord[]> {
    const { access_token } = await this.getAuthToken();
    return this.fetchDataWithRecursiveCallV2(module, access_token, ids);
  }

  getAllProjects(): Promise<ZohoRecord[]> { return this.all(this.project_module); }
  getAllProgram(): Promise<ZohoRecord[]> { return this.all(this.program_module); }
  getAllOrganizations(): Promise<ZohoRecord[]> { return this.all(this.org_module); }
  getAllClients(): Promise<ZohoRecord[]> { return this.all(this.client_module); }
  getAllDeals(ids?: string[]): Promise<ZohoRecord[]> { return this.all(this.deal_module, ids); }
  getAllRecords({ module, ids }: { module: string; ids?: string[] }): Promise<ZohoRecord[]> { return this.all(module, ids); }
  getAllProducts(): Promise<ZohoRecord[]> { return this.all(this.product_module); }

  async getRecordById({ module, id }: { module: string; id: string }): Promise<ZohoRecord[]> {
    const { access_token } = await this.getAuthToken();
    const response = await this.zohoRequest<ZohoRecord[]>(`/crm/v5/${encodeURIComponent(module)}/${encodeURIComponent(id)}`, { token: access_token });
    return response.data ?? [];
  }

  async getRecordBySearch({ module, criteria }: { module: string; criteria: string }): Promise<ZohoRecord[]> {
    const { access_token } = await this.getAuthToken();
    const response = await this.zohoRequest<ZohoRecord[]>(`/crm/v5/${encodeURIComponent(module)}/search?criteria=${encodeURIComponent(criteria)}`, { token: access_token });
    return response.data ?? [];
  }

  async updateCrm({ module, id, payload }: { module: string; id: string; payload: Record<string, unknown> }): Promise<unknown> {
    const { access_token } = await this.getAuthToken();
    return this.zohoRequest(`/crm/v6/${encodeURIComponent(module)}/${encodeURIComponent(id)}`, { method: "PATCH", token: access_token, body: payload });
  }

  async bulkUpdateCrm(module: string, updates: ZohoRecord[]): Promise<unknown[]> {
    const results: unknown[] = [];
    for (let offset = 0; offset < updates.length; offset += 100) {
      const { access_token } = await this.getAuthToken();
      const response = await this.zohoRequest<unknown[]>(`/crm/v2/${encodeURIComponent(module)}`, { method: "PUT", token: access_token, body: { data: updates.slice(offset, offset + 100), trigger: [] } });
      results.push(...(response.data ?? []));
    }
    return results;
  }

  createCSVForBulkWrite(updates: Array<Record<string, unknown>>): string {
    if (!updates.length) return "";
    const headers = [...new Set(["id", ...updates.flatMap(Object.keys)])];
    const escape = (value: unknown): string => {
      const text = value == null ? "" : String(value);
      return /[,"\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    return [headers.join(","), ...updates.map((record) => headers.map((header) => escape(record[header])).join(","))].join("\n");
  }

  getFieldMappings(sampleRecord: Record<string, unknown>): Array<{ api_name: string; index: number }> {
    return Object.keys(sampleRecord).map((api_name, index) => ({ api_name, index }));
  }

  updateCrmWithRateLimit(options: { module: string; id: string; payload: Record<string, unknown> }): Promise<unknown> {
    return this.updateCrm(options);
  }
}
