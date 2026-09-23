import type { Env } from "./env.js";

const localDevelopmentOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
] as const;

type CorsEnvironment = Pick<
  Env,
  | "NODE_ENV"
  | "CORS_ALLOWED_ORIGINS"
  | "FRONTEND_URL"
  | "ADMIN_FRONTEND_URL"
>;

function normalizedOrigin(value: string): string {
  return new URL(value).origin;
}

export function corsAllowedOrigins(env: CorsEnvironment): ReadonlySet<string> {
  const configured = [
    ...env.CORS_ALLOWED_ORIGINS,
    env.FRONTEND_URL,
    env.ADMIN_FRONTEND_URL,
    ...(env.NODE_ENV === "production" ? [] : localDevelopmentOrigins),
  ].filter((value): value is string => Boolean(value));
  return new Set(configured.map(normalizedOrigin));
}

export function isCorsOriginAllowed(
  origin: string | undefined,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  if (origin === undefined) return true;
  try {
    return origin === normalizedOrigin(origin) && allowedOrigins.has(origin);
  } catch {
    return false;
  }
}
