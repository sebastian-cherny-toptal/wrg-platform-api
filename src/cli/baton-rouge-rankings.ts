import ExcelJS from "exceljs";

export const batonRougeRankingYear = 2026;

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
  return statuses.get(normalizeRankingOrganizationName(organizationName)) ?? false;
}

export async function loadBatonRougeWinnerStatuses(
  filePath: string,
): Promise<Map<string, boolean>> {
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
  if (!organizationNameColumn || !winnerColumn) {
    throw new Error(
      `${filePath} must include "Alias Name" and "CY Winner" columns`,
    );
  }

  const statuses = new Map<string, boolean>();
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const organizationName = normalizeRankingOrganizationName(
      row.getCell(organizationNameColumn).text,
    );
    const rawWinner = row.getCell(winnerColumn).text.trim().toLowerCase();
    if (!organizationName || (rawWinner !== "yes" && rawWinner !== "no")) {
      continue;
    }
    const isWinner = rawWinner === "yes";
    const existing = statuses.get(organizationName);
    if (existing !== undefined && existing !== isWinner) {
      throw new Error(
        `${filePath} contains conflicting winner statuses for ${row.getCell(organizationNameColumn).text}`,
      );
    }
    statuses.set(organizationName, isWinner);
  }
  if (statuses.size === 0) {
    throw new Error(`${filePath} contains no valid Yes/No winner assignments`);
  }
  return statuses;
}
