import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
      sections: [
        {
          title: "Benefits",
          questions: [
            {
              text: "Do you offer healthcare?",
              responses: [
                { label: "Yes", values: [90, 70] },
                { label: "No", values: [10, 30] },
              ],
            },
          ],
        },
      ],
    });

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
        dataValues,
        label,
      })),
      [
        { dataValues: [90, 70], label: "Yes" },
        { dataValues: [10, 30], label: "No" },
      ],
    );
  });
});
