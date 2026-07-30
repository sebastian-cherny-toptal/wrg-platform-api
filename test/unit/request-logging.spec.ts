import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, it } from "node:test";
import type pino from "pino";
import {
  requestLogProps,
  sanitizeLogValue,
  serializeRequest,
} from "../../src/common/logging/request-logging.js";

describe("request logging", () => {
  it("redacts sensitive keys and bounds untrusted values", () => {
    const value = sanitizeLogValue({
      email: "person@example.com",
      password: "do-not-log",
      nested: { access_token: "also-secret" },
      long: "x".repeat(600),
    }) as Record<string, unknown>;

    assert.equal(value.password, "[REDACTED]");
    assert.deepEqual(value.nested, { access_token: "[REDACTED]" });
    assert.equal((value.long as string).length, 513);
    assert.equal(value.email, "person@example.com");
  });

  it("keeps useful request fields while removing sensitive headers", () => {
    const serialized = serializeRequest({
      id: "request-1",
      method: "GET",
      url: "/api/v1/projects?organizationId=org-1&token=secret",
      headers: {
        accept: "application/json",
        authorization: "Bearer secret",
        "user-agent": "test-agent",
      },
      remoteAddress: "127.0.0.1",
      remotePort: 1234,
      params: { organizationId: "org-1" },
      query: { organizationId: "org-1", token: "secret" },
    } as unknown as ReturnType<typeof pino.stdSerializers.req>);

    assert.equal(serialized.url, "/api/v1/projects");
    assert.deepEqual(serialized.headers, {
      accept: "application/json",
      "user-agent": "test-agent",
    });
    assert.deepEqual(serialized.query, {
      organizationId: "org-1",
      token: "[REDACTED]",
    });
  });

  it("adds route, response context, and authenticated actor metadata", () => {
    const response = {
      statusCode: 200,
      getHeader: (name: string) =>
        name === "content-length"
          ? "42"
          : name === "content-type"
            ? "application/json"
            : undefined,
    } as unknown as ServerResponse;

    const props = requestLogProps(
      {
        id: "request-2",
        method: "GET",
        url: "/api/v1/projects?organizationId=org-1",
        headers: { "user-agent": "test-agent", "content-length": "10" },
        socket: { remoteAddress: "127.0.0.1" },
        routeOptions: { url: "/api/v1/projects" },
        params: { organizationId: "org-1" },
        query: { organizationId: "org-1", token: "secret" },
        ip: "203.0.113.10",
        protocol: "https",
        user: {
          sub: "user-1",
          organizationId: "org-1",
          roles: ["admin"],
        },
      } as unknown as IncomingMessage,
      response,
    );

    assert.equal(props.event, "http_request");
    assert.equal(props.route, "/api/v1/projects");
    assert.equal(props.path, "/api/v1/projects");
    assert.deepEqual(props.params, { organizationId: "org-1" });
    assert.deepEqual(props.query, {
      organizationId: "org-1",
      token: "[REDACTED]",
    });
    assert.equal(props.auth, "authenticated");
    assert.deepEqual(props.actor, {
      id: "user-1",
      organizationId: "org-1",
      roles: ["admin"],
    });
    assert.equal(props.requestBytes, 10);
    assert.equal(props.responseBytes, 42);
  });
});
