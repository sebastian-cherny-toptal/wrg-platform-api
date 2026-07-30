import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  BYPASS_LOGIN_AUTH: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  SENDGRID_KEY: z.string().min(1).optional(),
  SENDGRID_DOMAIN: z.string().email().optional(),
  FRONTEND_URL: z.string().url().optional(),
  ZOHO_BASE_URL: z.string().url(),
  ZOHO_CLIENT_ID: z.string().min(1),
  ZOHO_CLIENT_SECRET: z.string().min(1),
  ZOHO_WEBHOOK_SECRET: z.string().min(16),
  CHECKMARKET_BASE_URL: z.string().url(),
  CHECKMARKET_API_KEY: z.string().min(1),
  CHECKMARKET_WEBHOOK_SECRET: z.string().min(16),
  INTEGRATIONS_MOCK: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  LOG_LEVEL: z.string().default("info"),
  ETL_ALLOW_WRITE: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  /** Serve wrg-platform-be Express routes for FE drop-in replacement. Default on. */
  LEGACY_COMPAT: z
    .string()
    .default("true")
    .transform((value) => value !== "false"),
  LEGACY_SECRETS_FROM_ENV: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  LEGACY_SECRETS_FILE: z.string().optional(),
  LEGACY_SECRETS_JSON: z.string().optional(),
  MONGO_URI: z.string().optional(),
  APP_ENV: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export function validateEnv(input: Record<string, unknown>): Env {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid environment: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}
