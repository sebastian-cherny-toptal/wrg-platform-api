import type { IncomingMessage, ServerResponse } from "node:http";
import type pino from "pino";

const REDACTED = "[REDACTED]";
const MAX_STRING_LENGTH = 512;
const MAX_COLLECTION_ITEMS = 50;
const MAX_DEPTH = 5;

const sensitiveKeyPattern =
  /authorization|cookie|password|passcode|secret|token|api[-_]?key|signature|otp|verification[-_]?code|refresh[-_]?token/i;

export interface RequestLogRequest {
  headers: IncomingMessage["headers"];
  id?: unknown;
  ip?: unknown;
  params?: unknown;
  protocol?: unknown;
  query?: unknown;
  raw?: unknown;
  routeOptions?: { url?: unknown };
  socket: IncomingMessage["socket"];
  url?: string;
  user?: unknown;
}

export interface RequestLogResponse {
  getHeader: (name: string) => unknown;
  statusCode: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: string): string {
  return value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}…`
    : value;
}

/**
 * Makes request-derived values safe and bounded before they are handed to a
 * logger. Request bodies are intentionally never passed to this function.
 */
export function sanitizeLogValue(
  value: unknown,
  key?: string,
  depth = 0,
): unknown {
  if (key && sensitiveKeyPattern.test(key)) return REDACTED;
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "string") return truncate(value);
  if (depth >= MAX_DEPTH) return "[TRUNCATED]";

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_COLLECTION_ITEMS)
      .map((item) => sanitizeLogValue(item, key, depth + 1));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_COLLECTION_ITEMS)
        .map(([entryKey, entryValue]) => [
          entryKey,
          sanitizeLogValue(entryValue, entryKey, depth + 1),
        ]),
    );
  }

  return truncate(String(value));
}

function selectedHeaders(
  headers: Record<string, unknown>,
): Record<string, unknown> {
  const allowedHeaders = [
    "accept",
    "content-length",
    "content-type",
    "origin",
    "referer",
    "user-agent",
    "x-forwarded-host",
    "x-forwarded-proto",
  ];

  return Object.fromEntries(
    allowedHeaders
      .filter((name) => headers[name] !== undefined)
      .map((name) => [name, sanitizeLogValue(headers[name], name)]),
  );
}

/**
 * Uses Pino's standard request fields while limiting headers and sanitizing
 * query/path parameters. This prevents secrets from leaking through URLs.
 */
export function serializeRequest(
  request: ReturnType<typeof pino.stdSerializers.req>,
): Record<string, unknown> {
  return {
    id: request.id,
    method: request.method,
    url: pathname(request.url),
    headers: selectedHeaders(request.headers),
    remoteAddress: request.remoteAddress,
    remotePort: request.remotePort,
    params: sanitizeLogValue(request.params),
    query: sanitizeLogValue(request.query),
  };
}

export function serializeResponse(
  response: ReturnType<typeof pino.stdSerializers.res>,
): Record<string, unknown> {
  const headers = isRecord(response.headers) ? response.headers : {};
  return {
    statusCode: response.statusCode,
    headers: Object.fromEntries(
      ["content-length", "content-type", "location"]
        .filter((name) => headers[name] !== undefined)
        .map((name) => [name, sanitizeLogValue(headers[name], name)]),
    ),
  };
}

function pathname(url: string | undefined): string {
  if (!url) return "/";
  try {
    return new URL(url, "http://request.local").pathname;
  } catch {
    return url.split("?", 1)[0] ?? "/";
  }
}

function numericHeader(
  headers: IncomingMessage["headers"],
  name: string,
): number | undefined {
  const value = headers[name];
  const number = typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function headerValue(
  headers: IncomingMessage["headers"],
  name: string,
): string | undefined {
  const value = headers[name];
  return typeof value === "string" ? truncate(value) : undefined;
}

function principal(
  value: unknown,
): { id: string; organizationId: string | null; roles: string[] } | undefined {
  if (!isRecord(value) || typeof value.sub !== "string") return undefined;

  return {
    id: value.sub,
    organizationId:
      typeof value.organizationId === "string" || value.organizationId === null
        ? value.organizationId
        : null,
    roles: Array.isArray(value.roles)
      ? value.roles
          .filter((role): role is string => typeof role === "string")
          .slice(0, 20)
      : [],
  };
}

export function requestLogProps(
  incomingRequest: IncomingMessage,
  incomingResponse: ServerResponse,
): Record<string, unknown> {
  return requestLogPropsForRequest(
    incomingRequest as RequestLogRequest,
    incomingResponse,
  );
}

export function requestLogPropsForRequest(
  request: RequestLogRequest,
  response: RequestLogResponse,
): Record<string, unknown> {
  const actor = principal(request.user);
  const route =
    typeof request.routeOptions?.url === "string"
      ? request.routeOptions.url
      : pathname(request.url);
  const ip =
    typeof request.ip === "string" ? request.ip : request.socket.remoteAddress;
  const responseContentLength = response.getHeader("content-length");
  const responseContentType = response.getHeader("content-type");

  return {
    event: "http_request",
    requestId: typeof request.id === "string" ? request.id : undefined,
    path: pathname(request.url),
    route,
    params: sanitizeLogValue(request.params),
    query: sanitizeLogValue(request.query),
    protocol:
      typeof request.protocol === "string" ? request.protocol : undefined,
    client: {
      ip,
      userAgent: headerValue(request.headers, "user-agent"),
      referer: headerValue(request.headers, "referer"),
    },
    auth: actor ? "authenticated" : "anonymous",
    actor,
    requestBytes: numericHeader(request.headers, "content-length"),
    responseBytes:
      typeof responseContentLength === "string"
        ? Number.isFinite(Number(responseContentLength))
          ? Number(responseContentLength)
          : undefined
        : undefined,
    responseContentType:
      typeof responseContentType === "string"
        ? truncate(responseContentType)
        : undefined,
  };
}

export function requestSuccessObject(
  _request: IncomingMessage,
  response: ServerResponse,
  value: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...value,
    event: "http_request",
    statusCode: response.statusCode,
    outcome: response.statusCode >= 400 ? "client_error" : "success",
  };
}

export function requestErrorObject(
  _request: IncomingMessage,
  response: ServerResponse,
  _error: Error,
  value: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...value,
    event: "http_request",
    statusCode: response.statusCode,
    outcome: "server_error",
  };
}
