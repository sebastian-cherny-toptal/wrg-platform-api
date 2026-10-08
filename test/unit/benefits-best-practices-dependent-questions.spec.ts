import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateBenefitsBestPracticesFromEa,
  loadBenefitsBestPracticesTemplate,
} from "../../src/modules/reports/benefits-best-practices-from-ea.js";
import type { BenefitsBestPracticesSnapshot } from "../../src/modules/reports/benefits-best-practices-workbook.js";

const organizations = ["one", "two", "three", "four", "five", "six"];

function generate(
  template: BenefitsBestPracticesSnapshot,
  values: (index: number) => Record<string, unknown>,
): BenefitsBestPracticesSnapshot {
  return generateBenefitsBestPracticesFromEa({
    template,
    minimumOrganizations: 1,
    cohorts: [
      {
        title: "All Size Categories",
        type: "All_All",
        organizationIds: organizations,
      },
    ],
    answers: organizations.map((organizationId, index) => ({
      organizationId,
      values: values(index),
    })),
  });
}

describe("Benefits & Best Practices dependent-question denominators", () => {
  it("counts a populated free-text Other response as selected", () => {
    const template: BenefitsBestPracticesSnapshot = {
      sourceFile: "test.xlsx",
      headers: [],
      sections: [
        {
          title: "Organizational Benefits",
          questions: [
            {
              text: "Which employer-paid holidays does your organization offer?",
              responses: [
                {
                  label: "Other, please specify:",
                  format: "percent",
                  dataValues: [],
                },
              ],
            },
          ],
        },
      ],
    };

    const snapshot = generate(template, (index) => ({
      "q_OrganizationalBenefits_SelectPaidHolidays.other":
        index < 3 ? "Company anniversary" : "",
    }));

    assert.equal(
      snapshot.sections[0]?.questions[0]?.responses[0]?.dataValues[0],
      50,
    );
  });

  it("includes the adoption and birth benefits question in the report template", async () => {
    const template = await loadBenefitsBestPracticesTemplate();
    const question = template.sections
      .flatMap(({ questions }) => questions)
      .find(({ text }) => /adoption\/birth of a child/iu.test(text));

    assert.ok(question);
    assert.deepEqual(
      question.responses.map(({ label }) => label),
      [
        "Fully or partially paid maternity leave",
        "Unpaid maternity leave",
        "Fully or partially paid paternity leave",
        "Unpaid paternity leave",
        "Other",
        "Our organization does not offer other benefits for the adoption/birth of a child.",
      ],
    );

    const snapshot = generate(template, (index) => ({
      "q_OrganizationalBenefits_AdoptionBirthBenefits. Fully or partially paid maternity leave":
        index < 3 ? 1 : 0,
      "q_OrganizationalBenefits_AdoptionBirthBenefits.other":
        index < 2 ? "Additional caregiver leave" : "",
    }));
    const generatedQuestion = snapshot.sections
      .flatMap(({ questions }) => questions)
      .find(({ text }) => /adoption\/birth of a child/iu.test(text));
    assert.ok(generatedQuestion);
    assert.equal(generatedQuestion.responses[0]?.dataValues[0], 50);
    assert.equal(generatedQuestion.responses[4]?.dataValues[0], 100 / 3);
  });

  it("excludes organizations without healthcare benefits from every healthcare follow-up", () => {
    const template: BenefitsBestPracticesSnapshot = {
      sourceFile: "test.xlsx",
      headers: [],
      sections: [
        {
          title: "Organizational Benefits",
          questions: [
            {
              text: "Who is eligible for healthcare benefits?",
              responses: [
                {
                  label: "Full-time employees only",
                  format: "percent",
                  dataValues: [],
                },
                {
                  label:
                    "Full-time and part-time employees (working less than 32 hours a week)",
                  format: "percent",
                  dataValues: [],
                },
              ],
            },
            {
              text: "When can a new hire enroll in your organization’s healthcare plan (check one)?",
              responses: [
                {
                  label: "First day of hire",
                  format: "percent",
                  dataValues: [],
                },
                {
                  label: "30 days after hire",
                  format: "percent",
                  dataValues: [],
                },
              ],
            },
            {
              text: "Please put a check mark next to each benefit provided by your organization. If your organization offers more than one plan for any benefit, please select the response which describes your most basic plan.",
              responses: [
                {
                  label: "Medical coverage (employee)",
                  format: "percent",
                  dataValues: [],
                },
              ],
            },
            {
              text: "What percentage of the premium cost is absorbed by the organization?(Percent sign not needed)",
              responses: [
                {
                  label: "Medical coverage (employee)",
                  format: "percent",
                  dataValues: [],
                },
              ],
            },
          ],
        },
      ],
    };

    const snapshot = generate(template, (index) => ({
      q_OrganizationalBenefits_HealthcareBenefits: index < 4 ? 1 : 2,
      q_OrganizationalBenefits_EligibilityHealthcareBene:
        index < 2 || index >= 4 ? 1 : 2,
      q_OrganizationalBenefits_NewHireEnrollHelthcreBenf:
        index === 0 || index >= 4 ? 1 : 2,
      "q_OrganizationalBenefits_Benefits. Medical coverage (employee)":
        index < 2 ? 1 : undefined,
      "q_OrganizationalBenefits_PctCostPaidByEmployerBenf. Medical coverage (employee)":
        index < 4 ? [80, 80, 60, 100][index] : 0,
    }));

    const questions = snapshot.sections[0]?.questions ?? [];
    assert.deepEqual(
      questions[0]?.responses.map(({ dataValues }) => dataValues[0]),
      [50, 50],
    );
    assert.deepEqual(
      questions[1]?.responses.map(({ dataValues }) => dataValues[0]),
      [25, 75],
    );
    assert.equal(questions[2]?.responses[0]?.dataValues[0], 50);
    assert.equal(questions[3]?.responses[0]?.dataValues[0], 80);
  });

  it("excludes organizations that do not offer paid time off from its follow-ups", () => {
    const template: BenefitsBestPracticesSnapshot = {
      sourceFile: "test.xlsx",
      headers: [],
      sections: [
        {
          title: "Organizational Benefits",
          questions: [
            {
              text: "Does your organization provide time off as PTO (one bank of time) or as vacation/sick/personal days (separate banks)?",
              responses: [
                {
                  label: "PTO (one bank of time)",
                  format: "percent",
                  dataValues: [],
                },
                {
                  label: "Vacation/sick/personal days (separate banks)",
                  format: "percent",
                  dataValues: [],
                },
              ],
            },
            {
              text: "Does your organization offer unlimited PTO?",
              responses: [{ label: "Yes", format: "percent", dataValues: [] }],
            },
            {
              text: "Does your organization offer unlimited vacation days?",
              responses: [{ label: "Yes", format: "percent", dataValues: [] }],
            },
            {
              text: "Does your organization offer unlimited sick days?",
              responses: [{ label: "Yes", format: "percent", dataValues: [] }],
            },
            {
              text: "Does your organization offer unlimited personal days?",
              responses: [{ label: "Yes", format: "percent", dataValues: [] }],
            },
          ],
        },
      ],
    };

    const snapshot = generate(template, (index) => ({
      q_OrganizationalBenefits_OfferPTOVSP: index < 4 ? 1 : 2,
      q_OrganizationalBenefits_PtoVacationSickPersonal:
        index < 2 || index >= 4 ? 1 : 2,
      q_OrganizationalBenefits_OfferUnlimitedPTO:
        index === 0 || index >= 4 ? 1 : 2,
      q_OrganizationalBenefits_OfferUnlimitedVacationDay:
        index === 1 || index >= 4 ? 1 : 2,
      q_OrganizationalBenefits_OfferUnlimitedSickDays:
        index === 2 || index >= 4 ? 1 : 2,
      q_OrganizationalBenefits_OfferUnlimitedPersonalDay:
        index === 3 || index >= 4 ? 1 : 2,
    }));

    const questions = snapshot.sections[0]?.questions ?? [];
    assert.deepEqual(
      questions[0]?.responses.map(({ dataValues }) => dataValues[0]),
      [50, 50],
    );
    assert.equal(questions[1]?.responses[0]?.dataValues[0], 25);
    assert.equal(questions[2]?.responses[0]?.dataValues[0], 25);
    assert.equal(questions[3]?.responses[0]?.dataValues[0], 25);
    assert.equal(questions[4]?.responses[0]?.dataValues[0], 25);
  });
});
