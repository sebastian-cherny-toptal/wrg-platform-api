import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  demographicResponseCaption,
  demographicResponsePosition,
  reportResponseCaption,
} from "../../src/modules/reports/compatibility-reports.module.js";

describe("demographic response labels", () => {
  it("returns the WRG standard gender captions for imported numeric codes", () => {
    const question = {
      dataLabel: "f_PersonalDemographics_gender",
      metadata: { QuestionTypeId: 2 },
    };

    assert.equal(demographicResponseCaption(1, question, 2025), "Female");
    assert.equal(demographicResponseCaption(2, question, 2025), "Male");
    assert.equal(demographicResponseCaption(3, question, 2025), "Non-Binary");
    assert.equal(
      demographicResponseCaption(4, question, 2025),
      "Prefer not to answer",
    );
  });

  it("prefers question metadata over the standard fallback", () => {
    assert.equal(
      demographicResponseCaption(
        1,
        {
          dataLabel: "f_PersonalDemographics_gender",
          metadata: {
            QuestionResponses: [{ Id: 1, Caption: "Woman" }],
          },
        },
        2025,
      ),
      "Woman",
    );
    assert.equal(
      demographicResponseCaption(
        "remote",
        {
          dataLabel: "custom_demographic",
          metadata: { responseOptions: { remote: "Remote employee" } },
        },
        2025,
      ),
      "Remote employee",
    );
    assert.equal(
      demographicResponseCaption(
        2,
        {
          dataLabel: "custom_demographic",
          metadata: { QuestionResponses: ["First", "Second"] },
        },
        2025,
      ),
      "Second",
    );
  });

  it("groups imported birth-year option ids into age generations", () => {
    const question = {
      dataLabel: "f_PersonalDemographics_ageGeneration",
      metadata: { QuestionTypeId: 2 },
    };

    assert.equal(
      demographicResponseCaption(19, question, 2025),
      "Millennials (Born 1981 to 1996)",
    );
    assert.equal(
      demographicResponseCaption(48, question, 2025),
      "Generation X (Born 1965 to 1980)",
    );
    assert.equal(
      demographicResponseCaption(86, question, 2025),
      "Prefer not to answer",
    );
    assert.deepEqual(
      [
        "Baby Boomers (Born 1946 to 1964)",
        "Generation X (Born 1965 to 1980)",
        "Generation Z (Born 1997 or later)",
        "Millennials (Born 1981 to 1996)",
      ].sort(
        (left, right) =>
          demographicResponsePosition(left, question, 2025) -
          demographicResponsePosition(right, question, 2025),
      ),
      [
        "Baby Boomers (Born 1946 to 1964)",
        "Generation X (Born 1965 to 1980)",
        "Millennials (Born 1981 to 1996)",
        "Generation Z (Born 1997 or later)",
      ],
    );
  });

  it("does not apply standard labels to organization-specific options", () => {
    assert.equal(
      demographicResponseCaption(
        1,
        {
          dataLabel: "f_WorkplaceDemographics_department_ORGID_14",
          metadata: { QuestionTypeId: 2 },
        },
        2025,
      ),
      "1",
    );
  });

  it("maps Likert ordinals to labels and treats 6 and 99 as N/A", () => {
    const question = {
      dataLabel: "q_Core_1",
      metadata: { QuestionTypeId: 5 },
      type: "likert",
    };

    assert.equal(reportResponseCaption(1, question, 2026), "Strongly Disagree");
    assert.equal(reportResponseCaption(5, question, 2026), "Strongly Agree");
    assert.equal(reportResponseCaption(6, question, 2026), "N/A");
    assert.equal(reportResponseCaption(99, question, 2026), "N/A");
  });
});
