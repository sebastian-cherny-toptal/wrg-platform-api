const os = require("os");
const fs = require("fs");
const ExcelJS = require("exceljs");
const { downloadFileStream } = require("./fileStorage");

const CURRENT_PURPLE = "2E1065";
const CURRENT_TEXT = "F3F4F5";
const CURRENT_LIGHT = "E2E8F0";
const RESPONSE_DETAIL_SECTION_LIGHT = "ECEEF4";
const RESPONSE_DETAIL_SAMPLE_KEY = "Full_Response_Detail_Report_SAMPLE.xlsx";

const EDUCATION_RESPONSE_HEADERS = new Set([
  "SOME HIGH SCHOOL",
  "HIGH SCHOOL GRADUATE (INCLUDES EQUIVALENCY)",
  "VOCATIONAL TRAINING",
  "SOME COLLEGE",
  "ASSOCIATE DEGREE",
  "BACHELOR'S DEGREE",
  "MASTER'S OR PROFESSIONAL DEGREE",
  "OTHER",
  "PREFER NOT TO ANSWER",
]);

const normalizeColor = (value) => {
  if (!value || typeof value !== "string") return null;
  const color = value.replace("#", "").toUpperCase();
  return color.length === 8 ? color.slice(2) : color;
};

const withOriginalAlpha = (original, replacement) => {
  if (!original || typeof original !== "string") return replacement;
  const cleanOriginal = original.replace("#", "").toUpperCase();
  if (cleanOriginal.length === 8) return `${cleanOriginal.slice(0, 2)}${replacement}`;
  return replacement;
};

const isOldAccentColor = (value) => {
  const color = normalizeColor(value);
  if (!color) return false;

  const oldThemeColors = new Set([
    "FF0000",
    "F00000",
    "C00000",
    "D00000",
    "E00000",
    "000000",
    "111111",
    "17242E",
    "172733",
    "1A2A33",
    "1F2933",
    "243746",
    "263238",
  ]);

  if (oldThemeColors.has(color)) return true;

  const red = parseInt(color.slice(0, 2), 16);
  const green = parseInt(color.slice(2, 4), 16);
  const blue = parseInt(color.slice(4, 6), 16);

  const looksRed = red > 180 && green < 80 && blue < 80;
  const looksDarkHeader = red < 55 && green < 65 && blue < 75;

  return looksRed || looksDarkHeader;
};

const isOldRedColor = (value) => {
  const color = normalizeColor(value);
  if (!color) return false;

  const red = parseInt(color.slice(0, 2), 16);
  const green = parseInt(color.slice(2, 4), 16);
  const blue = parseInt(color.slice(4, 6), 16);

  return red > 180 && green < 80 && blue < 80;
};

const normalizeColorObject = (colorObj, replacement) => {
  if (!colorObj || !colorObj.argb || !isOldAccentColor(colorObj.argb)) {
    return colorObj;
  }

  return {
    ...colorObj,
    argb: withOriginalAlpha(colorObj.argb, replacement),
  };
};

const getCellText = (cell) => {
  const value = cell?.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return `${value}`;
  if (value.richText) return value.richText.map((item) => item.text || "").join("");
  if (value.text) return value.text;
  if (value.result !== undefined) return `${value.result}`;
  return "";
};

const normalizeText = (value) => getCellText(value).replace(/\s+/g, " ").trim().toUpperCase();

const getSolidFill = (argb) => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb },
  bgColor: { argb },
});

const getThinBlackBorder = ({ removeLeft = false, removeRight = false } = {}) => ({
  top: { style: "thin", color: { argb: "000000" } },
  left: removeLeft ? { style: "none" } : { style: "thin", color: { argb: "000000" } },
  bottom: { style: "thin", color: { argb: "000000" } },
  right: removeRight ? { style: "none" } : { style: "thin", color: { argb: "000000" } },
});

const getMergedRanges = (worksheet) =>
  Object.values(worksheet._merges || {})
    .map((merge) => merge.model || merge)
    .filter((merge) =>
      Number.isInteger(merge.top) &&
      Number.isInteger(merge.left) &&
      Number.isInteger(merge.bottom) &&
      Number.isInteger(merge.right)
    );

const getMergedRangeForCell = (worksheet, rowNumber, columnNumber) =>
  getMergedRanges(worksheet).find(
    (range) =>
      rowNumber >= range.top &&
      rowNumber <= range.bottom &&
      columnNumber >= range.left &&
      columnNumber <= range.right
  );

const findHeaderRangeByText = (worksheet, headerText) => {
  const targetText = headerText.toUpperCase();

  for (let rowNumber = 1; rowNumber <= Math.min(6, worksheet.rowCount); rowNumber++) {
    const row = worksheet.getRow(rowNumber);

    for (let columnNumber = 1; columnNumber <= worksheet.columnCount; columnNumber++) {
      const cell = row.getCell(columnNumber);
      if (normalizeText(cell) !== targetText) continue;

      return getMergedRangeForCell(worksheet, rowNumber, columnNumber) || {
        top: rowNumber,
        left: columnNumber,
        bottom: rowNumber,
        right: columnNumber,
      };
    }
  }

  return null;
};

const findEducationColumnRange = (worksheet) => {
  const educationHeaderRange = findHeaderRangeByText(worksheet, "EDUCATION");
  if (educationHeaderRange) return educationHeaderRange;

  let bestMatch = null;
  for (let rowNumber = 1; rowNumber <= Math.min(6, worksheet.rowCount); rowNumber++) {
    const matches = [];
    const row = worksheet.getRow(rowNumber);

    for (let columnNumber = 1; columnNumber <= worksheet.columnCount; columnNumber++) {
      const text = normalizeText(row.getCell(columnNumber));
      if (EDUCATION_RESPONSE_HEADERS.has(text)) matches.push(columnNumber);
    }

    if (matches.length >= 3 && (!bestMatch || matches.length > bestMatch.matches)) {
      bestMatch = {
        left: Math.min(...matches),
        right: Math.max(...matches),
        matches: matches.length,
      };
    }
  }

  return bestMatch ? { top: 1, bottom: worksheet.rowCount, left: bestMatch.left, right: bestMatch.right } : null;
};

const hideEducationDemographicColumns = (worksheet) => {
  const educationRange = findEducationColumnRange(worksheet);
  if (!educationRange) return;

  for (let columnNumber = educationRange.left; columnNumber <= educationRange.right; columnNumber++) {
    const column = worksheet.getColumn(columnNumber);
    column.hidden = true;
    column.width = 0.1;
  }
};

const normalizeResponseDetailWidths = (worksheet) => {
  worksheet.getColumn(1).width = 1;
  worksheet.getColumn(2).width = 60;
  worksheet.getColumn(3).width = 45;
  worksheet.getColumn(4).width = 1;

  worksheet.columns.forEach((column, index) => {
    const columnNumber = index + 1;
    if (column.hidden) return;
    if (columnNumber > 4 && column.width > 1) {
      column.width = 16;
    }
  });
};

const mergeResponseDetailTitleBlock = (worksheet) => {
  [
    { top: 2, left: 2, bottom: 2, right: 3 },
    { top: 3, left: 2, bottom: 3, right: 3 },
  ].forEach((range) => {
    const existingMerge = getMergedRangeForCell(worksheet, range.top, range.left);
    if (existingMerge) return;

    try {
      worksheet.mergeCells(range.top, range.left, range.bottom, range.right);
    } catch (error) {
      console.log(error, "error merging response detail sample title block");
    }
  });
};

const styleResponseDetailHeaderRows = (worksheet) => {
  const row2 = worksheet.getRow(2);
  const row3 = worksheet.getRow(3);
  const row4 = worksheet.getRow(4);

  row2.height = 80;
  row3.height = 230;

  const titleCell = row3.getCell(2);
  const titleText = getCellText(titleCell);
  if (titleText.toUpperCase().includes("FOR SAMPLE PURPOSES ONLY")) {
    titleCell.value = titleText
      .replace("FOR SAMPLE PURPOSES ONLY: THIS IS NOT YOUR ORGANIZATION'S DATA", "FOR SAMPLE PURPOSES ONLY: THIS IS NOT YOUR\nORGANIZATION'S DATA")
      .replace("FOR SAMPLE PURPOSES ONLY: THIS IS NOT YOUR ORGANISATION'S DATA", "FOR SAMPLE PURPOSES ONLY: THIS IS NOT YOUR\nORGANISATION'S DATA");
  }

  worksheet.columns.forEach((column, index) => {
    const columnNumber = index + 1;
    const removeLeft = columnNumber === 3;
    const removeRight = columnNumber === 2;

    let cell = row2.getCell(columnNumber);
    cell.alignment = {
      horizontal: "center",
      vertical: "bottom",
      readingOrder: "ltr",
      wrapText: true,
      shrinkToFit: false,
    };
    if (column.width > 1) {
      cell.fill = getSolidFill(CURRENT_PURPLE);
      cell.font = {
        color: { argb: CURRENT_TEXT },
        bold: true,
        size: 16,
        name: "calibri",
      };
    }
    cell.border = getThinBlackBorder({ removeLeft, removeRight });

    cell = row3.getCell(columnNumber);
    if (column.width > 1) {
      cell.fill = getSolidFill(CURRENT_LIGHT);
    }
    if (columnNumber === 2 || columnNumber === 3) {
      cell.font = {
        color: { argb: CURRENT_PURPLE },
        bold: true,
        size: 26,
        name: "calibri",
      };
      cell.alignment = {
        horizontal: columnNumber === 2 ? "left" : "left",
        vertical: "bottom",
        readingOrder: "ltr",
        wrapText: true,
        shrinkToFit: false,
      };
    } else if (columnNumber > 3) {
      cell.font = {
        color: { argb: CURRENT_PURPLE },
        bold: true,
        size: 15,
        name: "calibri",
      };
      cell.alignment = {
        textRotation: 90,
        wrapText: true,
        horizontal: "center",
        vertical: "bottom",
        readingOrder: "ltr",
        shrinkToFit: columnNumber === 5,
      };
    }
    cell.border = getThinBlackBorder({ removeLeft, removeRight });

    cell = row4.getCell(columnNumber);
    cell.fill = getSolidFill(CURRENT_PURPLE);
    cell.font = {
      color: { argb: CURRENT_TEXT },
      bold: true,
      size: 12,
      name: "calibri",
    };
  });
};

const isResponseDetailSectionRow = (row) => {
  if (row.number <= 4) return false;

  const sectionText = normalizeText(row.getCell(2));
  if (!sectionText || sectionText.includes("NOTE:")) return false;

  const nonEmptyCells = [];
  row.eachCell({ includeEmpty: false }, (cell) => {
    if (normalizeText(cell)) nonEmptyCells.push(cell);
  });

  return sectionText === getCellText(row.getCell(2)).trim() && nonEmptyCells.length <= 2;
};

const styleResponseDetailSectionRows = (worksheet) => {
  worksheet.eachRow((row) => {
    if (!isResponseDetailSectionRow(row)) return;

    worksheet.columns.forEach((column, index) => {
      const cell = row.getCell(index + 1);
      cell.fill = getSolidFill(RESPONSE_DETAIL_SECTION_LIGHT);
      cell.font = {
        color: { argb: CURRENT_PURPLE },
        bold: true,
        size: 16,
        name: "calibri",
      };
    });
  });
};

const normalizeResponseDetailSampleWorksheet = (worksheet) => {
  normalizeResponseDetailWidths(worksheet);
  hideEducationDemographicColumns(worksheet);
  mergeResponseDetailTitleBlock(worksheet);
  styleResponseDetailHeaderRows(worksheet);
  styleResponseDetailSectionRows(worksheet);
};

const applyCurrentThemeToCell = (cell) => {
  if (cell.fill) {
    cell.fill = {
      ...cell.fill,
      fgColor: normalizeColorObject(cell.fill.fgColor, CURRENT_PURPLE),
      bgColor: normalizeColorObject(cell.fill.bgColor, CURRENT_PURPLE),
    };
  }

  if (cell.font?.color?.argb && isOldRedColor(cell.font.color.argb)) {
    cell.font = {
      ...cell.font,
      color: { ...cell.font.color, argb: withOriginalAlpha(cell.font.color.argb, CURRENT_PURPLE) },
    };
  }

  if (cell.value && typeof cell.value === "string" && cell.value.toUpperCase().includes("SAMPLE")) {
    cell.font = {
      ...(cell.font || {}),
      color: { argb: CURRENT_PURPLE },
      bold: true,
    };
  }
};

const applyCurrentThemeToWorksheet = (worksheet) => {
  worksheet.eachRow((row) => {
    row.eachCell({ includeEmpty: true }, applyCurrentThemeToCell);
  });

  if (worksheet.conditionalFormattings) {
    worksheet.conditionalFormattings.forEach((formatting) => {
      formatting.rules?.forEach((rule) => {
        if (rule.style?.fill) {
          rule.style.fill = {
            ...rule.style.fill,
            fgColor: normalizeColorObject(rule.style.fill.fgColor, CURRENT_LIGHT),
            bgColor: normalizeColorObject(rule.style.fill.bgColor, CURRENT_LIGHT),
          };
        }
      });
    });
  }
};

const respondWithThemedSampleWorkbook = async (res, { key, fileName, awsBucket = "sample-report-files" }) => {
  const sampleWorkbook = await downloadFileStream({ key, awsBucket });
  if (!sampleWorkbook) return false;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(sampleWorkbook);
  workbook.eachSheet((worksheet) => {
    applyCurrentThemeToWorksheet(worksheet);

    if (key === RESPONSE_DETAIL_SAMPLE_KEY) {
      normalizeResponseDetailSampleWorksheet(worksheet);
    }
  });

  const file = `${os.tmpdir()}/${fileName}`;
  await workbook.xlsx.writeFile(file);
  res.setHeader("access-control-expose-headers", "*");
  res.download(file, fileName, () => {
    try {
      fs.unlinkSync(file);
    } catch (error) {
      console.log(error, "error deleting themed sample workbook");
    }
  });

  return true;
};

module.exports = {
  respondWithThemedSampleWorkbook,
};
