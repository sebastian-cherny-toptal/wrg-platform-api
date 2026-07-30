import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { verifySharedSignature } from "../../src/modules/integrations/webhooks.controller.js";

describe("shared webhook signatures", () => {
  it("accepts a current valid signature and rejects tampering", () => {
    const secret = "a-long-shared-test-secret";
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const body = Buffer.from('{"id":"event-1"}');
    const signature = `sha256=${createHmac("sha256", secret).update(timestamp).update(".").update(body).digest("hex")}`;

    assert.equal(
      verifySharedSignature(body, signature, timestamp, secret),
      true,
    );
    assert.equal(
      verifySharedSignature(
        Buffer.from("tampered"),
        signature,
        timestamp,
        secret,
      ),
      false,
    );
  });

  it("rejects stale signatures", () => {
    const timestamp = String(Math.floor(Date.now() / 1_000) - 301);
    assert.equal(
      verifySharedSignature(
        Buffer.from("{}"),
        "sha256=invalid",
        timestamp,
        "a-long-shared-test-secret",
      ),
      false,
    );
  });
});
