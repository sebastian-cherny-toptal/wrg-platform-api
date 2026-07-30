import "dotenv/config";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import { RequestMethod, ValidationPipe, VersioningType } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import type { Env } from "./config/env.js";
import { AppModule } from "./app.module.js";

export async function createApp(): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({ bodyLimit: 2 * 1024 * 1024, trustProxy: true });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    {
      bufferLogs: true,
      rawBody: true,
    },
  );
  app.useLogger(app.get(Logger));
  await app.register(helmet);
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024, files: 20 } });
  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  });
  const nativeCompatibilityPrefixes = ["user", "client", "admin", "dashboard", "payment", "zoho", "webhook"];
  const nativeCompatibilityRoutes = nativeCompatibilityPrefixes.flatMap((prefix) => [
    prefix,
    `${prefix}/:one`,
    `${prefix}/:one/:two`,
    `${prefix}/:one/:two/:three`,
    `${prefix}/:one/:two/:three/:four`,
  ]);
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
  process.env.APP_ENV ??= process.env.NODE_ENV === "production" ? "prod" : "dev";
  const app = await createApp();
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const port = Number(config.get("PORT", { infer: true }));
  await app.listen(port, "0.0.0.0");
}

if (process.env.NODE_ENV !== "test") {
  void bootstrap();
}
