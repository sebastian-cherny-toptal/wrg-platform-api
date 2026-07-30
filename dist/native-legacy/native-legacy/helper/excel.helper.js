const os = require("os");
const ExcelJS = require("exceljs");
const moment = require("moment");
const {
  EMPLOYER_BREAKOUT_TITLE_FN,
  PROGRAM_SIZE_TITLE_FN,
  mapArrayIntoHalf,
  checkIsUK,
} = require("./benchmarkData.helper");
const imageHashes = require("../assets/imageHashes.json");
const { applyWorksheetZoom } = require("./excelZoom");

const THEME = {
  WHITE: "F3F4F5",
  RED: "2E1065",
  DARK_BLUE: "2E1065",
  GRAY: "E2E8F0",
};

class ExcelHelper {
  constructor() {
    this.genBenchmarkHeader = this.genBenchmarkHeader.bind(this);
    this.genBenchmarkContent = this.genBenchmarkContent.bind(this);
    this.genBenchmarkXLSFace = this.genBenchmarkXLSFace.bind(this);
    this.respondAsFile = this.respondAsFile.bind(this);
  }
  THEME = THEME;
  FORMATS = {
    imageHeader: {
      width: 90,
      colAction(col) {
        col.width = this.width;
      },
    },
    topHeader: {
      font: {
        family: 4,
        size: 20,
        color: { argb: null },
        bold: true,
      },
      fill: {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: null },
      },
      alignment: {
        wrapText: true,
      },
      cellAction(cell) {
        cell.font = { ...this.font, color: { argb: THEME.WHITE } };
        cell.fill = { ...this.fill, fgColor: { argb: THEME.DARK_BLUE } };
        cell.alignment = this.alignment;
      },
      cellFillAction(cell) {
        cell.fill = { ...this.fill, fgColor: { argb: THEME.DARK_BLUE } };
      },
    },
    header: {
      fill: {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: null },
      },
      alignment: {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      },
      font: {
        family: 4,
        size: 14,
        bold: true,
        color: { argb: null },
      },
      cellAction(cell, lastCell = false) {
        if (!lastCell) {
          cell.alignment = this.alignment;
        }
        cell.fill = { ...this.fill, fgColor: { argb: THEME.DARK_BLUE } };
        cell.font = this.font;
        cell.font.color.argb = THEME.WHITE;
      },
    },
    dataCell: {
      width: 28,
      font: {
        family: 4,
        size: 12,
        bold: false,
      },
      alignment: {
        vertical: "bottom",
        horizontal: "center",
      },
      percentageFormat: "0%",
      cellAction(cell) {
        cell.font = this.font;
        cell.alignment = this.alignment;
      },
      colAction(col) {
        col.width = this.width;
      },
    },
    questions: {
      font: {
        family: 4,
        size: 12,
      },
      fontBold: {
        bold: false,
        family: 4,
        size: 16,
        bold: true,
        color: { argb: null },
      },
      fill: {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: null },
      },
      alignment: {
        vertical: "middle",
        horizontal: "left",
      },
      questionCellAction(cell) {
        cell.font = this.font;
        cell.alignment = this.alignment;
      },
      whiteCellAction(cell) {
        cell.font = { ...this.fontBold, color: { argb: THEME.RED } };
        cell.alignment = this.alignment;
      },
      redCellAction(cell) {
        cell.font = { ...this.fontBold, color: { argb: THEME.WHITE } };
        cell.alignment = this.alignment;
        cell.fill = { ...this.fill, fgColor: { argb: THEME.RED } };
      },
      grayCellAction(cell, isAverage) {
        if (!isAverage) {
          cell.font = this.font;
          cell.alignment = this.alignment;
        }
        cell.font = {
          family: 4,
          size: 12,
          bold: true,
        };
        cell.fill = { ...this.fill, fgColor: { argb: THEME.GRAY } };
      },
    },
  };

  genBenchmarkXLSFace(req, { sheetTitle, firstHeading, extraMeta }) {
    const workbook = new ExcelJS.Workbook();
    const isUK = checkIsUK(req);
    const worksheet = workbook.addWorksheet(sheetTitle);
    applyWorksheetZoom(worksheet, 75);
    return {
      workbook,
      metaData: {
        image: workbook.addImage(imageHashes.wrgLogo),
        sheetTitle,
        program: `${isUK ? "PROGRAMME" : "PROGRAM"}: ${req.program.Name}`,
        dateGenerated: moment().format(isUK ? "DD/MM/YYYY" : "MM/DD/YYYY"),
        staticHeaders: [
          mapArrayIntoHalf(req.benchmarkDisplayHeader, () => firstHeading),
          mapArrayIntoHalf(req.benchmarkDisplayHeader, ({ orgSizeName }) =>
            EMPLOYER_BREAKOUT_TITLE_FN(orgSizeName)
          ),
          mapArrayIntoHalf(
            req.benchmarkDisplayHeader,
            ({ programModuleSize }) =>
              PROGRAM_SIZE_TITLE_FN(programModuleSize, isUK)
          ),
        ],
        footerTitle: "x – Insufficient data to provide meaningful feedback.",
        ...extraMeta,
      },
      worksheet,
    };
  }

  genBenchmarkHeader(metaData, worksheet, reportHeaders) {
    const HEADER_LAST_ROWS = 3 + metaData.staticHeaders.length;
    worksheet.addImage(metaData.image, {
      tl: { col: 0.2, row: 0.4 },
      ext: { width: 300, height: 50 },
    });
    this.FORMATS.imageHeader.colAction(worksheet.getColumn("A"));
    worksheet.mergeCells(`A1:A${metaData.staticHeaders.length + 2}`);

    worksheet.mergeCells(1, 2, 1, reportHeaders.length + 1);
    worksheet.getCell(1, 1).value = metaData.sheetTitle.toUpperCase();
    worksheet.getCell(6, 1).value = metaData.program;

    this.FORMATS.topHeader.cellAction(worksheet.getCell("A1"));
    this.FORMATS.topHeader.cellAction(worksheet.getCell("B1"));
    this.FORMATS.topHeader.cellAction(worksheet.getCell("A6"));

    worksheet.getRow(6).height = 50;
    worksheet.getRow(1).height = 30;
    worksheet.getRow(3).height = 27;
    worksheet.getRow(4).height = 13.5;
    worksheet.getRow(5).height = 33.75;

    worksheet.columns.forEach((col) => {
      this.FORMATS.topHeader.cellFillAction(worksheet.getCell(2, col.number));
      this.FORMATS.topHeader.cellFillAction(
        worksheet.getCell(HEADER_LAST_ROWS + 1, col.number)
      );
    });

    worksheet.columns.slice(1).forEach((col) => {
      this.FORMATS.dataCell.colAction(col);
    });

    reportHeaders.forEach((head, index) => {
      worksheet.getCell(HEADER_LAST_ROWS, 2 + index).value = head.title;
    });

    metaData.staticHeaders.forEach((titles, index) => {
      const rowNumber = index + 3;
      titles.forEach((title, index) => {
        const colNo = 2 + index * 2;
        worksheet.mergeCells([rowNumber, colNo, rowNumber, colNo + 1]);
        worksheet.getCell(rowNumber, colNo).value = title;
      });
    });

    worksheet.columns.slice(1).forEach((col) => {
      for (let rowNo = 3; rowNo <= HEADER_LAST_ROWS; rowNo++) {
        this.FORMATS.header.cellAction(worksheet.getCell(rowNo, col.number));
      }
    });
    worksheet.getRow(4).height = 25;
  }

  genBenchmarkContent({ worksheet, metaData, reportData, surveyAverage }) {
    const setDataValues = (worksheet, dataValues, rowNumber, type) => {
      dataValues.forEach((score, index) => {
        const cell = worksheet.getCell(rowNumber, 2 + index);
        this.FORMATS.dataCell.cellAction(cell);

        if (score !== null) {
          cell.numFmt = "0";
          if (typeof score === "string") {
            cell.value = score;
          } else if (type === "%") {
            cell.value = score / 100;
            cell.numFmt = this.FORMATS.dataCell.percentageFormat;
          } else {
            cell.value = score;
          }
        }
      });
    };
    let rowNumber = 7;
    reportData.forEach((labelData) => {
      let labelDataCell = worksheet.getCell(`A${++rowNumber}`);
      worksheet.mergeCells([rowNumber, 1, rowNumber, worksheet.columns.length]);

      labelDataCell.value = labelData.title.toUpperCase();
      this.FORMATS.questions.redCellAction(labelDataCell);
      labelData.nestedData.forEach((data) => {
        let cell = worksheet.getCell(`A${++rowNumber}`);
        if (data.nestedData) {
          worksheet.mergeCells([
            rowNumber,
            1,
            rowNumber,
            worksheet.columns.length,
          ]);
          cell.value = data.title;
          this.FORMATS.questions.grayCellAction(cell);

          data.nestedData.forEach((item) => {
            cell = worksheet.getCell(`A${++rowNumber}`);
            cell.value = item.title;
            this.FORMATS.questions.questionCellAction(cell);
            setDataValues(worksheet, item.dataValues, rowNumber, item.type);
          });
        } else {
          cell.value = data.title;
          if (!surveyAverage) this.FORMATS.questions.grayCellAction(cell);
          if (data.dataValues) {
            setDataValues(worksheet, data.dataValues, rowNumber, data.type);
          } else {
            worksheet.mergeCells([
              rowNumber,
              1,
              rowNumber,
              worksheet.columns.length,
            ]);
          }
        }
      });
      if (labelData.dataValues) {
        let cell = worksheet.getCell(`A${++rowNumber}`);
        cell.value = metaData.averageTagTitleFn(labelData.title);
        setDataValues(worksheet, labelData.dataValues, rowNumber);
        worksheet.columns.forEach((col) => {
          this.FORMATS.questions.grayCellAction(
            worksheet.getCell(rowNumber, col.number),
            true
          );
        });
        cell.alignment = { vertical: "middle", horizontal: "right" };
      }
    });
    if (surveyAverage) {
      let cell = worksheet.getCell(`A${++rowNumber}`);
      cell.value = metaData.surveyAverageTitle;
      setDataValues(worksheet, surveyAverage, rowNumber);
      worksheet.columns.forEach((col) => {
        this.FORMATS.header.cellAction(
          worksheet.getCell(rowNumber, col.number)
        );
      });
      cell.alignment = { vertical: "middle", horizontal: "right" };
    }
    worksheet.mergeCells([++rowNumber, 1, rowNumber, worksheet.columns.length]);
    if (worksheet.name == "Workforce Benchmark Comparisons") {
      const seclastCell = worksheet.getCell(`A${rowNumber}`);
      this.FORMATS.header.cellAction(seclastCell, true);
      seclastCell.value = metaData.footerTitle;
      const lastCell = worksheet.getCell(`A${rowNumber + 1}`);
      worksheet.mergeCells([
        ++rowNumber,
        1,
        rowNumber,
        worksheet.columns.length,
      ]);
      this.FORMATS.header.cellAction(lastCell, true);
      lastCell.value =
        "This report shows the percentage of agreement for every question asked during the survey, presented in aggregate by all competitors that did and did not make the list.";
    } else {
      const lastCell = worksheet.getCell(`A${rowNumber}`);
      this.FORMATS.header.cellAction(lastCell, true);
      lastCell.value = metaData.footerTitle;
    }
  }
  async respondAsFile(res, { workbook, fileName }) {
    const file = `${os.tmpdir()}/${fileName}`;
    await workbook.xlsx.writeFile(file);
    res.setHeader("access-control-expose-headers", "*");
    return res.download(file, fileName);
  }
}

module.exports = new ExcelHelper();