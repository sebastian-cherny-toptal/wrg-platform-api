import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { winnerStatusFromExternalValue } from "../../src/common/winner-status.js";

describe("winner status conversion", () => {
  it("normalizes external winner values to Y/N/null", () => {
    assert.equal(winnerStatusFromExternalValue(true), "Y");
    assert.equal(winnerStatusFromExternalValue(false), "N");
    assert.equal(winnerStatusFromExternalValue("Yes"), "Y");
    assert.equal(winnerStatusFromExternalValue("N"), "N");
    assert.equal(winnerStatusFromExternalValue(null), null);
    assert.equal(winnerStatusFromExternalValue(""), null);
    assert.equal(winnerStatusFromExternalValue("not set"), null);
  });
});
