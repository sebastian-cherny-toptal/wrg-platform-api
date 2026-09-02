import ExcelJS from "exceljs";

export const batonRougeRankingYear = 2026;

export interface BatonRougeRankingData {
  categoryRank: string;
  currentYearCategory: string;
  isWinner: boolean;
  overallRank: string;
}

export function normalizeRankingOrganizationName(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

export function rankingWinnerStatus(
  year: number,
  organizationName: string,
  statuses: Map<string, boolean>,
): boolean {
  if (year !== batonRougeRankingYear) return false;
  return (
    statuses.get(normalizeRankingOrganizationName(organizationName)) ?? false
  );
}

export async function loadBatonRougeWinnerStatuses(
  filePath: string,
): Promise<Map<string, boolean>> {
  const rankings = await loadBatonRougeRankingData(filePath);
  return new Map(
    [...rankings].map(([organizationName, ranking]) => [
      organizationName,
      ranking.isWinner,
    ]),
  );
}

export async function loadBatonRougeRankingData(
  filePath: string,
): Promise<Map<string, BatonRougeRankingData>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error(`${filePath} contains no worksheet`);

  const normalizeHeader = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
  const headers = new Map<string, number>();
  worksheet.getRow(1).eachCell((cell, column) => {
    headers.set(normalizeHeader(cell.text), column);
  });
  const organizationNameColumn = headers.get("aliasname");
  const winnerColumn = headers.get("cywinner");
  const categoryColumn = headers.get("cycategory");
  const overallRankColumn = headers.get("cyoverallrank");
  const categoryRankColumn = headers.get("cycategoryrank");
  if (
    !organizationNameColumn ||
    !winnerColumn ||
    !categoryColumn ||
    !overallRankColumn ||
    !categoryRankColumn
  ) {
    throw new Error(
      `${filePath} must include "Alias Name", "CY Winner", "CY Category", ` +
        '"CY Overall Rank", and "CY Category Rank" columns',
    );
  }

  const rankings = new Map<string, BatonRougeRankingData>();
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const organizationName = normalizeRankingOrganizationName(
      row.getCell(organizationNameColumn).text,
    );
    const rawWinner = row.getCell(winnerColumn).text.trim().toLowerCase();
    if (!organizationName || (rawWinner !== "yes" && rawWinner !== "no")) {
      continue;
    }
    const ranking = {
      categoryRank: row.getCell(categoryRankColumn).text.trim(),
      currentYearCategory: row.getCell(categoryColumn).text.trim(),
      isWinner: rawWinner === "yes",
      overallRank: row.getCell(overallRankColumn).text.trim(),
    };
    const existing = rankings.get(organizationName);
    if (existing !== undefined && existing.isWinner !== ranking.isWinner) {
      throw new Error(
        `${filePath} contains conflicting winner statuses for ${row.getCell(organizationNameColumn).text}`,
      );
    }
    rankings.set(organizationName, ranking);
  }
  if (rankings.size === 0) {
    throw new Error(`${filePath} contains no valid Yes/No winner assignments`);
  }
  return rankings;
}
