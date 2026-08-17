import "dotenv/config";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import { LogController } from "fastify";
import { RequestMethod, ValidationPipe, VersioningType } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Env } from "./config/env.js";
import { AppModule } from "./app.module.js";
import { ServerErrorLoggingFilter } from "./common/http/server-error-exception.filter.js";
import { requestLogPropsForRequest } from "./common/logging/request-logging.js";

export async function createApp(): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
    logController: new LogController({ disableRequestLogging: true }),
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "*.password",
        "*.passcode",
        "*.token",
        "*.secret",
        "*.apiKey",
        "*.signature",
        "*.otp",
      ],
    },
    genReqId: (request: IncomingMessage) => {
      const incoming = request.headers["x-correlation-id"];
      return typeof incoming === "string" && incoming.length <= 128
        ? incoming
        : randomUUID();
    },
  });
  const fastify = adapter.getInstance();
  fastify.addHook("onRequest", (request, reply, done) => {
    reply.header("x-correlation-id", request.id);
    done();
  });
  fastify.addHook("onResponse", (request, reply, done) => {
    const log = requestLogPropsForRequest(request, reply.raw);
    const record = {
      ...log,
      statusCode: reply.statusCode,
      durationMs: reply.elapsedTime,
      outcome:
        reply.statusCode >= 500
          ? "server_error"
          : reply.statusCode >= 400
            ? "client_error"
            : "success",
    };

    if (reply.statusCode >= 500) {
      request.log.error(record, "http request completed");
    } else if (reply.statusCode >= 400) {
      request.log.warn(record, "http request completed");
    } else {
      request.log.info(record, "http request completed");
    }
    done();
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    {
      abortOnError: false,
      bufferLogs: true,
      rawBody: true,
    },
  );
  app.useLogger(app.get(Logger));
  await app.register(helmet);
  await app.register(multipart, {
    limits: { fileSize: 100 * 1024 * 1024, files: 20 },
  });
  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  });
  const nativeCompatibilityPrefixes = [
    "user",
    "client",
    "admin",
    "dashboard",
    "payment",
    "zoho",
    "webhook",
  ];
  const nativeCompatibilityRoutes = nativeCompatibilityPrefixes.flatMap(
    (prefix) => [
      prefix,
      `${prefix}/:one`,
      `${prefix}/:one/:two`,
      `${prefix}/:one/:two/:three`,
      `${prefix}/:one/:two/:three/:four`,
    ],
  );
  app.setGlobalPrefix("api", {
    exclude: [
      ...nativeCompatibilityRoutes,
      { path: "ping", method: RequestMethod.ALL },
      { path: "deploy-check", method: RequestMethod.ALL },
      { path: "health", method: RequestMethod.ALL },
    ],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ServerErrorLoggingFilter());

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("WRG Platform API")
      .setDescription(
        "Tenant-aware platform API. Legacy Express routes (/user, /client, …) are served alongside /api/v1 for drop-in replacement of wrg-platform-be.",
      )
      .setVersion("1.0")
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup("docs", app, document, {
    jsonDocumentUrl: "openapi.json",
  });
  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const port = Number(config.get("PORT", { infer: true }));
  await app.listen(port, "0.0.0.0");
}

if (process.env.NODE_ENV !== "test") {
  void bootstrap().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown startup failure";
    // Nest's logger may not exist yet when configuration validation fails.
    // Keep this on stderr so Railway always surfaces the cause in deploy logs.
    console.error(`[FATAL] API failed to start: ${message}`);
    process.exit(1);
  });
}
