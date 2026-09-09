import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  loadBatonRougeRankingData,
  loadBatonRougeWinnerStatuses,
  normalizeRankingOrganizationName,
  rankingWinnerStatus,
} from "../../src/cli/baton-rouge-rankings.js";

describe("Baton Rouge ranking extract", () => {
  it("loads the category and ranks needed by seeded program enrollments", async () => {
    const rankings = await loadBatonRougeRankingData(
      resolve(process.cwd(), "BR 2026 Ranking Data Extract.xlsx"),
    );

    assert.deepEqual(
      rankings.get(
        normalizeRankingOrganizationName("Commerce Title & Abstract Company"),
      ),
      {
        categoryRank: "24",
        currentYearCategory: "Small",
        isWinner: "Y",
        overallRank: "61",
      },
    );
  });

  it("loads winner and non-winner assignments by normalized organization name", async () => {
    const statuses = await loadBatonRougeWinnerStatuses(
      resolve(process.cwd(), "BR 2026 Ranking Data Extract.xlsx"),
    );

    assert.equal(
      statuses.get(
        normalizeRankingOrganizationName("Commerce Title & Abstract Company"),
      ),
      "Y",
    );
    assert.equal(statuses.get(normalizeRankingOrganizationName("b1BANK")), "N");
    assert.equal(
      statuses.has(normalizeRankingOrganizationName("Bear Process Safety")),
      false,
      "rows whose CY Winner value is neither Yes nor No are ignored",
    );
    assert.equal(
      rankingWinnerStatus(2026, "Commerce Title & Abstract Company", statuses),
      "Y",
    );
    assert.equal(rankingWinnerStatus(2026, "b1BANK", statuses), "N");
    assert.equal(
      rankingWinnerStatus(2025, "Commerce Title & Abstract Company", statuses),
      "N",
      "the 2026 extract must not alter prior-year programs",
    );
  });
});
