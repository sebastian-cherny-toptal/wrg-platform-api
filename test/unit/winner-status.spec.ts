import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  winnerBooleanFromExternalValue,
  winnerBooleanFromStatus,
  winnerStatusFromBoolean,
} from "../../src/common/winner-status.js";

describe("winner status conversion", () => {
  it("maps application booleans to Y/N and missing values to null", () => {
    assert.equal(winnerStatusFromBoolean(true), "Y");
    assert.equal(winnerStatusFromBoolean(false), "N");
    assert.equal(winnerStatusFromBoolean(undefined), null);
    assert.equal(winnerStatusFromBoolean(null), null);
  });

  it("preserves missing Current_Year_Winner values as unknown", () => {
    assert.equal(winnerBooleanFromExternalValue("Yes"), true);
    assert.equal(winnerBooleanFromExternalValue("N"), false);
    assert.equal(winnerBooleanFromExternalValue(null), null);
    assert.equal(winnerBooleanFromExternalValue(""), null);
    assert.equal(winnerBooleanFromExternalValue("not set"), null);
  });

  it("maps stored Y/N values back to nullable application booleans", () => {
    assert.equal(winnerBooleanFromStatus("Y"), true);
    assert.equal(winnerBooleanFromStatus("N"), false);
    assert.equal(winnerBooleanFromStatus(null), null);
  });
});
