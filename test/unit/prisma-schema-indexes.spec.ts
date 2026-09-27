import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Prisma relation indexes", () => {
  it("indexes Response.questionId for cascading question deletes", () => {
    const schema = readFileSync(
      join(process.cwd(), "prisma", "schema.prisma"),
      "utf8",
    );
    const responseModel = /model Response \{[\s\S]*?\n\}/u.exec(schema)?.[0];

    assert.ok(responseModel, "Response model not found");
    assert.match(responseModel, /@@index\(\[questionId\]\)/u);
  });
});
