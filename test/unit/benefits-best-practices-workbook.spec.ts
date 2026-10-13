import assert from "node:assert/strict";
import { describe, it } from "node:test";
import AdmZip from "adm-zip";
import ExcelJS from "exceljs";
import {
  hasPublishedBenefitsBestPractices,
  parseBenefitsBestPracticesWorkbook,
} from "../../src/modules/reports/benefits-best-practices-workbook.js";
import { createBenefitsWorkbook } from "../../src/modules/reports/report-template-workbooks.js";

async function exampleWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Benefits & Best Practices");
  worksheet.getCell("B6").value = "All Winners";
  worksheet.getCell("C6").value = "All Non-Winners";
  worksheet.getCell("A8").value = "EMPLOYEE EXPERIENCE";
  worksheet.getCell("A9").value =
    "Does your organization recognize milestones?";
  worksheet.getCell("A10").value = "Yes";
  worksheet.getCell("B10").value = 0.86;
  worksheet.getCell("C10").value = 0.42;
  worksheet.getCell("B10").numFmt = "0%";
  worksheet.getCell("C10").numFmt = "0%";
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("Benefits & Best Practices workbook parsing", () => {
  for (const headerCount of [2, 8, 10]) {
    it(`removes stale template rows and fills section/footer bands across ${headerCount} cohorts`, async () => {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(
        (await createBenefitsWorkbook({
          headers: Array.from(
            { length: headerCount },
            (_, i) => `Cohort ${i + 1}`,
          ),
          sections: [
            {
              title: "Employee Feedback, Development, and Engagement",
              questions: [
                {
                  text: "Do you offer training?",
                  responses: [
                    {
                      label: "Yes",
                      format: "percent",
                      values: Array.from({ length: headerCount }, () => 80),
                    },
                  ],
                },
              ],
            },
          ],
        })) as never,
      );
      const sheet = workbook.worksheets[0];
      assert.ok(sheet);
      const notes: number[] = [];
      sheet.eachRow((row) => {
        if (String(row.getCell(1).value ?? "").includes("Insufficient data"))
          notes.push(row.number);
      });
      assert.deepEqual(notes, [11]);
      assert.equal(sheet.rowCount, 11);
      for (const row of [8, 11]) {
        for (let column = 1; column <= headerCount + 1; column += 1) {
          const fill = sheet.getCell(row, column).fill as ExcelJS.Fill;
          assert.equal(fill.type, "pattern");
          assert.equal(fill.pattern, "solid");
          assert.match(fill.fgColor?.argb ?? "", /2E1065$/u);
        }
      }
      assert.equal(sheet.getCell("B10").value, 0.8);
    });
  }

  it("parses report headers, sections, questions, and percentages", async () => {
    const snapshot = await parseBenefitsBestPracticesWorkbook(
      await exampleWorkbook(),
      "benefits.xlsx",
    );

    assert.deepEqual(snapshot.headers, [
      { title: "All Size Categories", type: "All_Yes" },
      { title: "All Size Categories", type: "All_No" },
    ]);
    const section = snapshot.sections[0];
    assert.ok(section);
    const question = section.questions[0];
    assert.ok(question);
    const response = question.responses[0];
    assert.ok(response);
    assert.equal(section.title, "Employee Experience");
    assert.equal(question.text, "Does your organization recognize milestones?");
    assert.deepEqual(response.dataValues, [86, 42]);
    assert.equal(
      hasPublishedBenefitsBestPractices({
        publishedReports: { benefitsBestPractices: snapshot },
      }),
      true,
    );
  });

  it("rejects workbooks without report headers", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Empty");
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await assert.rejects(
      parseBenefitsBestPracticesWorkbook(buffer, "empty.xlsx"),
      /report headers/u,
    );
  });

  it("accepts workbooks based on the downloadable report template", async () => {
    const buffer = await createBenefitsWorkbook({
      headers: ["All Winners", "All Non-Winners"],
      programName: "Test Program 2026",
      sections: [
        {
          title: "Benefits",
          questions: [
            {
              text: "Do you offer healthcare?",
              responses: [
                { format: "percent", label: "Yes", values: [90.4, 70.2] },
                { format: "percent", label: "No", values: [9.6, 29.8] },
              ],
            },
          ],
        },
        {
          title: "Workplace Practices",
          questions: [
            {
              text: "Average paid holidays",
              responses: [
                {
                  format: "number",
                  label: "Average paid holidays",
                  values: [10.4, 8.7],
                },
              ],
            },
          ],
        },
      ],
    });

    const generated = new ExcelJS.Workbook();
    await generated.xlsx.load(buffer as never);
    const generatedSheet = generated.getWorksheet("Benefits & Best Practices");
    assert.ok(generatedSheet);
    assert.equal(
      generatedSheet.getCell("A1").value,
      "BENEFITS & BEST PRACTICES",
    );
    assert.equal(
      generatedSheet.getCell("A6").value,
      "PROGRAM: Test Program 2026",
    );
    assert.equal(generatedSheet.getCell("B4").value, "All Size Categories");
    assert.equal(generatedSheet.getCell("B6").value, "All Winners");
    assert.equal(generatedSheet.getCell("A8").value, "BENEFITS");
    assert.equal(
      generatedSheet.getCell("A9").value,
      "Do you offer healthcare?",
    );
    assert.equal(generatedSheet.getCell("B10").value, 0.904);
    assert.equal(generatedSheet.getCell("B10").numFmt, "0%");
    assert.equal(generatedSheet.getCell("A12").value, "WORKPLACE PRACTICES");
    assert.equal(generatedSheet.getCell("B13").value, 10.4);
    assert.equal(generatedSheet.getCell("B13").numFmt, "0");
    assert.equal(generatedSheet.columnCount, 3);
    assert.deepEqual(generatedSheet.model.merges.includes("B1:C1"), true);
    const titleFill = generatedSheet.getCell("A1").fill;
    const questionFill = generatedSheet.getCell("A9").fill;
    assert.equal(titleFill.type, "pattern");
    assert.equal(questionFill.type, "pattern");
    assert.match(titleFill.fgColor?.argb ?? "", /2E1065$/u);
    assert.match(
      generatedSheet.getCell("A1").font.color?.argb ?? "",
      /F3F4F5$/u,
    );
    assert.match(questionFill.fgColor?.argb ?? "", /E2E8F0$/u);

    const archive = new AdmZip(buffer);
    const drawing = archive
      .getEntry("xl/drawings/drawing1.xml")
      ?.getData()
      .toString("utf8");
    assert.ok(drawing);
    assert.match(drawing, /<a:off x="128000" y="72000"\/>/u);
    assert.match(drawing, /<a:ext cx="2857500" cy="476250"\/>/u);

    const snapshot = await parseBenefitsBestPracticesWorkbook(
      buffer,
      "template-report.xlsx",
    );

    const section = snapshot.sections[0];
    assert.ok(section);
    const question = section.questions[0];
    assert.ok(question);
    assert.equal(section.title, "Benefits");
    assert.equal(section.questions.length, 1);
    assert.deepEqual(
      question.responses.map(({ dataValues, label }) => ({
        dataValues: dataValues.map((value) =>
          typeof value === "number" ? Number(value.toFixed(6)) : value,
        ),
        label,
      })),
      [
        { dataValues: [90.4, 70.2], label: "Yes" },
        { dataValues: [9.6, 29.8], label: "No" },
      ],
    );
    assert.equal(snapshot.sections[1]?.title, "Workplace Practices");
    assert.deepEqual(
      snapshot.sections[1].questions[0]?.responses[0]?.dataValues,
      [10.4, 8.7],
    );
  });

  it("fills all eight cohort columns without re-merging the template title", async () => {
    const headers = Array.from(
      { length: 8 },
      (_, index) => `Cohort ${index + 1}`,
    );
    const buffer = await createBenefitsWorkbook({ headers, sections: [] });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet("Benefits & Best Practices");
    assert.ok(sheet);
    assert.equal(sheet.columnCount, 9);
    assert.equal(sheet.getCell("I6").value, "Cohort 8");
    assert.equal(
      sheet.model.merges.filter((merge) => merge === "B1:I1").length,
      1,
    );
  });

  for (const categories of [
    ["All", "Boutique", "Small", "Medium", "Large"],
    Array.from({ length: 14 }, (_, index) => `Category ${index + 1}`),
  ]) {
    it(`exports all ${categories.length * 2} cohort columns with template formatting`, async () => {
      const headers = categories.flatMap((category) => [
        `${category} Winners`,
        `${category} Non-Winners`,
      ]);
      const values = headers.map((_, index) => index + 1);
      const buffer = await createBenefitsWorkbook({
        headers,
        sections: [
          {
            title: "Benefits",
            questions: [
              {
                text: "Offer healthcare?",
                responses: [{ format: "percent", label: "Yes", values }],
              },
              {
                text: "Paid holidays",
                responses: [
                  { format: "number", label: "Paid holidays", values },
                ],
              },
            ],
          },
        ],
      });
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as never);
      const sheet = workbook.getWorksheet("Benefits & Best Practices");
      assert.ok(sheet);
      assert.equal(sheet.columnCount, headers.length + 1);
      for (let index = 0; index < headers.length; index += 1) {
        const column = index + 2;
        const value = values[index];
        assert.ok(value !== undefined);
        assert.equal(sheet.getCell(6, column).value, headers[index]);
        assert.equal(sheet.getCell(10, column).value, value / 100);
        assert.equal(sheet.getCell(10, column).numFmt, "0%");
        assert.equal(sheet.getCell(11, column).value, values[index]);
        assert.equal(sheet.getCell(11, column).numFmt, "0");
        assert.equal(sheet.getColumn(column).width, sheet.getColumn(2).width);
        assert.deepEqual(
          sheet.getCell(6, column).style,
          sheet.getCell(6, 2).style,
        );
        assert.deepEqual(
          sheet.getCell(10, column).style,
          sheet.getCell(10, 2).style,
        );
        assert.deepEqual(
          sheet.getCell(11, column).style,
          sheet.getCell(11, 2).style,
        );
      }
      const lastLetter = sheet.getColumn(headers.length + 1).letter;
      for (const row of [1, 8, 9, 12]) {
        assert.ok(
          sheet.model.merges.includes(
            `${row === 1 ? "B" : "A"}${row}:${lastLetter}${row}`,
          ),
        );
      }
      assert.equal(sheet.pageSetup.printArea, `A1:${lastLetter}12`);
      for (let pair = 0; pair < categories.length; pair += 1) {
        const column = 2 + pair * 2;
        assert.equal(sheet.getCell(3, column).value, "Averaged Responses");
        assert.equal(
          sheet.getCell(4, column).value,
          categories[pair] === "All"
            ? "All Size Categories"
            : `${categories[pair]} Employers`,
        );
        for (const row of [3, 4, 5]) {
          assert.ok(
            sheet.model.merges.includes(
              `${sheet.getColumn(column).letter}${row}:${sheet.getColumn(column + 1).letter}${row}`,
            ),
          );
        }
      }
      const parsed = await parseBenefitsBestPracticesWorkbook(
        buffer,
        "all-categories.xlsx",
      );
      assert.equal(parsed.headers.length, headers.length);
      const section = parsed.sections[0];
      assert.ok(section);
      assert.deepEqual(
        section.questions
          .flatMap((question) => question.responses)
          .find((response) => response.label === "Paid holidays")?.dataValues,
        values,
      );
    });
  }

  it("creates a single-column workbook when no cohorts are available", async () => {
    const buffer = await createBenefitsWorkbook({ headers: [], sections: [] });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet("Benefits & Best Practices");
    assert.ok(sheet);
    assert.equal(sheet.columnCount, 1);
    assert.equal(sheet.getCell("A1").value, "BENEFITS & BEST PRACTICES");
    assert.equal(sheet.model.merges.includes("B1:I1"), false);
  });
});
