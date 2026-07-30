import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createRequire } from "node:module";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findLegacyRoute, type LegacyMiddlewareName } from "./legacy-routes.js";

type AnyRecord = Record<string, any>;
type LegacyFunction = (req: AnyRecord, res: AnyRecord, next?: (error?: unknown) => void) => unknown;

const here = path.dirname(fileURLToPath(import.meta.url));
const nativeLegacyRoot = path.resolve(here, "../../native-legacy");
const legacyRequire = createRequire(path.join(nativeLegacyRoot, "package.json"));
const mongoose = legacyRequire("mongoose") as { connection: { readyState: number } };

class NativeResponse {
  private statusCode = 200;
  private completed = false;

  constructor(private readonly reply: AnyRecord) {}

  get sent(): boolean { return this.completed || Boolean(this.reply.sent); }
  get headersSent(): boolean { return this.sent; }

  status(code: number): this { this.statusCode = code; this.reply.code(code); return this; }
  setHeader(name: string, value: unknown): this { this.reply.header(name, value); return this; }
  header(name: string, value: unknown): this { return this.setHeader(name, value); }
  writeHead(code: number, headers?: AnyRecord): this {
    this.status(code);
    for (const [name, value] of Object.entries(headers ?? {})) this.setHeader(name, value);
    return this;
  }
  json(value: unknown): unknown { this.completed = true; return this.reply.send(value); }
  send(value?: unknown): unknown { this.completed = true; return this.reply.send(value); }
  end(value?: unknown): unknown { this.completed = true; return this.reply.send(value); }
  write(value: unknown): unknown { return this.send(value); }
  on(event: string, listener: (...args: any[]) => void): this {
    this.reply.raw?.on?.(event, listener);
    return this;
  }
  download(file: string, filenameOrCallback?: string | ((error?: Error) => void), callback?: (error?: Error) => void): unknown {
    const filename = typeof filenameOrCallback === "string" ? filenameOrCallback : path.basename(file);
    const done = typeof filenameOrCallback === "function" ? filenameOrCallback : callback;
    this.reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    this.completed = true;
    const stream = createReadStream(file);
    stream.once("error", (error) => done?.(error));
    stream.once("open", () => done?.());
    return this.reply.send(stream);
  }
}

function pathname(url: string): string {
  return url.split("?", 1)[0] ?? "/";
}

function makeRequest(request: AnyRecord): AnyRecord {
  const headers = request.headers ?? {};
  return Object.assign(request, {
    rawBody: request.rawBody ?? request.raw?.body,
    header(name: string) { return headers[name.toLowerCase()]; },
    get(name: string) { return headers[name.toLowerCase()]; },
    path: pathname(request.raw?.url ?? request.url ?? "/"),
    query: request.query ?? {},
    params: request.params ?? {},
    body: request.body ?? {},
  });
}

@Injectable()
export class LegacyRuntimeService {
  private readonly logger = new Logger(LegacyRuntimeService.name);
  private readonly controllers = new Map<string, AnyRecord>();
  private readonly middleware = new Map<string, LegacyFunction>();
  private initPromise?: Promise<void>;

  private controller(name: string): AnyRecord {
    const existing = this.controllers.get(name);
    if (existing) return existing;
    const files: Record<string, string> = {
      user: "controllers/user.controller.js",
      auth: "controllers/auth.controller.js",
      reports: "controllers/clients/reports.controllers.js",
      heatmap: "controllers/clients/heatmap.controllers.js",
      workforce: "controllers/clients/workforceBenchmark.controllers.js",
      employer: "controllers/clients/employerBenchmark.controllers.js",
      management: "controllers/management.controller.js",
      dashboard: "controllers/dashboard.controller.js",
      ecom: "controllers/Ecom.controller.js",
      webhook: "controllers/webhook.controller.js",
      schedule: "controllers/scheduleJobs.controller.js",
      zoho: "controllers/zohomodule.controller.js",
    };
    const file = files[name];
    if (!file) throw new NotFoundException(`Unknown legacy controller: ${name}`);
    const loaded = legacyRequire(path.join(nativeLegacyRoot, file));
    this.controllers.set(name, loaded);
    return loaded;
  }

  private middlewareFor(name: LegacyMiddlewareName): LegacyFunction {
    const existing = this.middleware.get(name);
    if (existing) return existing;
    const access = legacyRequire(path.join(nativeLegacyRoot, "middleware/accessModule.middleware.js"));
    const benchmark = legacyRequire(path.join(nativeLegacyRoot, "middleware/benchmark.middleware.js"));
    const token = legacyRequire(path.join(nativeLegacyRoot, "middleware/jwtVerify.middleware.js"));
    const entries: Record<LegacyMiddlewareName, LegacyFunction> = {
      token,
      admin: access.adminAccess.bind(access),
      adminOrSelf: access.adminOrSelf.bind(access),
      reports: access.accessReports.bind(access),
      projects: access.clientsProjectsProgramsAccess.bind(access),
      preview: access.previewClientsDashboardAccess.bind(access),
      uploads: access.uploadDownloadCustomReportAccess.bind(access),
      keyImpact: access.uploadKeyImpactAnalysisAccess.bind(access),
      orders: access.orderLogAccess.bind(access),
      benchmark: benchmark.generateOrgCats.bind(benchmark),
      workforceData: this.controller("workforce").generateWBCData,
      employerData: this.controller("employer").generateBnBData,
      annualTrend: access.annualTrentReport.bind(access),
    };
    const fn = entries[name];
    this.middleware.set(name, fn);
    return fn;
  }

  private async initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const db = legacyRequire(path.join(nativeLegacyRoot, "config/db.js"));
        try {
          await db.connectDB();
        } catch (error) {
          this.logger.warn(`Legacy MongoDB initialization failed; requests will fail until it is available: ${String(error)}`);
        }
      })();
    }
    await this.initPromise;
  }

  private async parseMultipart(request: AnyRecord): Promise<string[]> {
    if (!request.isMultipart?.() || typeof request.parts !== "function") return [];
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wrg-upload-"));
    const files: AnyRecord[] = [];
    for await (const part of request.parts()) {
      if (part.type === "file") {
        const destination = path.join(tempDir, path.basename(part.filename || "upload"));
        const buffer = await part.toBuffer();
        await fs.writeFile(destination, buffer);
        files.push({
          fieldname: part.fieldname,
          originalname: part.filename,
          encoding: "7bit",
          mimetype: part.mimetype,
          size: buffer.length,
          destination: tempDir,
          filename: path.basename(destination),
          path: destination,
        });
      } else {
        request.body[part.fieldname] = part.value;
      }
    }
    request.files = files;
    request.file = files[0];
    return [tempDir];
  }

  private async runMiddleware(fn: LegacyFunction, request: AnyRecord, response: NativeResponse): Promise<boolean> {
    let continued = false;
    await new Promise<void>((resolve, reject) => {
      const next = (error?: unknown) => {
        continued = true;
        if (error) reject(error); else resolve();
      };
      Promise.resolve(fn(request, response, next)).then(() => {
        if (!continued) resolve();
      }).catch(reject);
    });
    return continued;
  }

  async handle(request: AnyRecord, reply: AnyRecord): Promise<void> {
    if (process.env.LEGACY_COMPAT === "false") throw new NotFoundException("Legacy endpoints are disabled");
    const req = makeRequest(request);
    const res = new NativeResponse(reply);
    const url = req.path as string;
    const route = findLegacyRoute(req.method, url);
    if (!route) throw new NotFoundException(`Legacy endpoint not found: ${req.method} ${url}`);
    if (route.controller !== "inline") await this.initialize();
    const cleanup = await this.parseMultipart(req);
    try {
      for (const middleware of route.middleware ?? []) {
        const continued = await this.runMiddleware(this.middlewareFor(middleware), req, res);
        if (!continued) return;
      }
      const target = route.controller === "inline" ? {
        ok: (_req: AnyRecord, response: NativeResponse) => response.send("cool"),
        ping: (_req: AnyRecord, response: NativeResponse) => response.send("pong"),
        deployCheck: (_req: AnyRecord, response: NativeResponse) => response.send("Hello! Deployed something"),
        legacyHealth: (_req: AnyRecord, response: NativeResponse) => {
          const connected = mongoose.connection.readyState === 1;
          return response.status(connected ? 200 : 503).json({
            status: connected ? "healthy" : "unhealthy",
            database: connected ? "connected" : "disconnected",
            ...(connected ? {} : { dbState: mongoose.connection.readyState }),
            timestamp: new Date().toISOString(),
          });
        },
      } : this.controller(route.controller);
      const result = await target[route.handler](req, res);
      if (!res.sent && result !== undefined) res.send(result);
    } finally {
      for (const directory of cleanup) await fs.rm(directory, { recursive: true, force: true });
    }
  }
}
