import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseSurveyDefinition } from "../../src/modules/imports/survey-definition.js";

/** Old test fixtures predate required EA answer ordering. Upgrade test input explicitly. */
export async function parseLegacyEaFixture(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const answers = workbook.getWorksheet("Answers");
  assert.ok(answers);
  const headers = answers.getRow(1).values as ExcelJS.CellValue[];
  const orderColumn = headers.indexOf("display_order");
  const positions = new Map<string, number>();
  answers.eachRow((row, index) => {
    if (index === 1) return;
    const key = String(row.getCell(1).value);
    const position = (positions.get(key) ?? 0) + 1;
    positions.set(key, position);
    if (!row.getCell(orderColumn).value)
      row.getCell(orderColumn).value = position;
  });
  return parseSurveyDefinition(
    Buffer.from(await workbook.xlsx.writeBuffer()),
    "EA",
  );
}
