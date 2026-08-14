import { createHash } from "node:crypto";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import AdmZip from "adm-zip";
import ExcelJS from "exceljs";

interface Options {
  output: string;
  reportSource: string;
  source: string;
}

function parseOptions(argv: string[]): Options {
  let source = "";
  let reportSource = "";
  let output = "";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (
      !argument ||
      !["--source", "--report-source", "--output"].includes(argument) ||
      !value
    ) {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
    if (argument === "--source") source = resolve(value);
    if (argument === "--report-source") reportSource = resolve(value);
    if (argument === "--output") output = resolve(value);
    index += 1;
  }
  if (!source || !reportSource || !output) {
    throw new Error("--source, --report-source, and --output are required");
  }
  return { source, reportSource, output };
}

function digest(value: unknown): string {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function sanitizedValue(
  value: ExcelJS.CellValue,
  header: string,
  year: number,
): ExcelJS.CellValue {
  if (value === null || value === undefined) return null;
  const sensitiveColumn =
    /respondent|organization.*(?:id|name)|email|phone|address|passcode|password|\bip\b|location|contact|first.*name|last.*name/iu.test(
      header,
    );
  if (value instanceof Date) return new Date(`${year}-01-01T12:00:00.000Z`);
  if (typeof value === "number")
    return sensitiveColumn ? `Synthetic ${digest(value)}` : value;
  if (typeof value === "boolean") return value;

  const text = typeof value === "string" ? value.trim() : String(value);
  if (!text) return null;
  if (!sensitiveColumn && /^-?\d+(?:\.\d+)?$/u.test(text)) return Number(text);
  if (
    /^(?:yes|no|n\/a|not applicable|true|false|complete|completed|incomplete|en|es|fr)$/iu.test(
      text,
    )
  ) {
    return text.toLowerCase();
  }
  return `Synthetic ${digest(text)}`;
}

function removeWorkbookIdentity(workbook: ExcelJS.Workbook): void {
  const timestamp = new Date("2026-01-01T00:00:00.000Z");
  workbook.creator = "WRG synthetic test fixture";
  workbook.lastModifiedBy = "WRG synthetic test fixture";
  workbook.created = timestamp;
  workbook.modified = timestamp;
  workbook.company = "Workforce Research Group";
  workbook.manager = "";
  workbook.subject = "Sanitized Baton Rouge test data";
}

async function sanitizedRawWorkbook(
  bytes: Buffer,
  year: number,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  removeWorkbookIdentity(workbook);
  for (const worksheet of workbook.worksheets) {
    const headers = worksheet.getRow(1);
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      row.eachCell({ includeEmpty: false }, (cell, column) => {
        cell.value = sanitizedValue(
          cell.value,
          headers.getCell(column).text.trim(),
          year,
        );
      });
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function metadataCleanWorkbook(filePath: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  removeWorkbookIdentity(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!existsSync(options.source))
    throw new Error(`Source does not exist: ${options.source}`);
  if (!existsSync(options.reportSource)) {
    throw new Error(`Report source does not exist: ${options.reportSource}`);
  }

  const input = new AdmZip(options.source);
  const output = new AdmZip();
  const years = new Set<number>();
  for (const entry of input.getEntries()) {
    const fileName = basename(entry.entryName);
    const match = /^BR (20\d{2}) - (?:EA|EFS) ORD\.xlsx$/iu.exec(fileName);
    if (entry.isDirectory || !match?.[1]) continue;
    const year = Number(match[1]);
    years.add(year);
    output.addFile(fileName, await sanitizedRawWorkbook(entry.getData(), year));
  }
  if (years.size === 0)
    throw new Error("No Baton Rouge source workbooks were found");

  const reportFiles = readdirSync(options.reportSource).filter((fileName) => {
    const containsYear = [...years].some((year) =>
      fileName.includes(String(year)),
    );
    return (
      containsYear &&
      /(?:workforce\s+benchmark|benchmark\s+comparisons|benefits\s*&\s*best\s*practices).*\.xlsx$/iu.test(
        fileName,
      )
    );
  });
  for (const fileName of reportFiles) {
    output.addFile(
      fileName,
      await metadataCleanWorkbook(join(options.reportSource, fileName)),
    );
  }
  if (reportFiles.length !== years.size * 2) {
    throw new Error(
      `Expected ${years.size * 2} published reports, found ${reportFiles.length}`,
    );
  }

  writeFileSync(options.output, output.toBuffer());
  console.log(
    `Wrote sanitized fixture with ${years.size * 2} raw workbooks and ${reportFiles.length} reports to ${options.output}`,
  );
  console.log(
    `Only synthetic row values and aggregate published reports are included; source data remains outside Git.`,
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
