# Custom Benefits & Best Practices reports

Programs without a custom EA definition keep the standard report and existing
label override behavior. Custom definitions select the report's quantitative
questions, answer rows, ordering, and calculations. They are stored as
`program.metadata.employerAssessmentReportDefinition = { version: 2, questions }`.
No database migration or automatic program conversion is required.

## Workbook contract

Use the existing EA definition upload endpoints and multipart field
`employerAssessmentDefinitionFile`. The workbook retains Questions and Answers.
Existing standard label templates need no extra columns.

For custom reports, every Questions row includes:

| Column                             | Meaning                                                             |
| ---------------------------------- | ------------------------------------------------------------------- |
| question_key                       | Unique report question key; matrix item keys must be unique.        |
| question_label                     | Display wording.                                                    |
| category                           | Report section.                                                     |
| display_order                      | Presentation order, independent of raw codes.                       |
| calculation                        | `yesNo`, `choice`, `multi`, or `mean`.                              |
| source_column                      | EA export column used by scalar questions.                          |
| output_format                      | `number` or `percent`; percentages use 0–100 values.                |
| group_key                          | Optional shared parent question key for matrix items.               |
| group_label                        | Optional item heading within that parent.                           |
| eligible_question / eligible_value | Optional EA column and raw code restricting eligible organizations. |

Answers uses the existing `question_key`, `raw_answer`, `answer_label`, and
`display_order` columns, with an additional `source_column` for multi-select or
multi-column mean answers. Scalar choice codes are compared directly;
`display_order` never substitutes for an ordinal. `score` remains an EFS field.

For holidays, map each answer to its checkbox column, such as
`q_OrganisationalBenefits_SelectPaidHolidays. Boxing Day`. Its values are `1`
or blank; do not enter the holiday's position as a response code. For a benefits
matrix, map each item to its actual column, such as
`q_OrganisationalBenefits_Benefits.1`, and map `1`, `2`, and `3` to their labels.

The converter reads a survey Question Response export:

```sh
npm run convert:ea-question-response -- source.xlsx custom-definition.xlsx validation.json
```

It retains custom quantitative questions and raw codes, splits matrix items,
and excludes narrative/contact and supplementary non-report questions.
Unknown or duplicate mappings are blocking conversion errors. The previously
supplied Campaign and Ad Age QA sheets can also be uploaded: known regional
question contracts are upgraded during parsing. Use a newly converted definition
to include questions that the earlier converter omitted.

## Validation and calculations

Preview and save validate the same definition. Source columns must exist in the
EA export or the saved program's EA survey. Known question aliases, smart quotes,
whitespace, and Medallia's semicolon-to-space header conversion are resolved;
ambiguous matches fail. Changing a display caption never changes a source column.

Scalar/matrix percentages use answered eligible organizations. Multi-select
percentages use the full eligible cohort, preserving current behavior. Numeric
means include finite values, including zero; holiday means are not limited to
1–25. A nonblank free-text Other answer counts as selected. Missing calculations
display `x`, as do cohorts with fewer than five available employer assessments.

Custom uploads replace the saved definition atomically. Removed questions are
removed from the report. Download returns only that saved custom definition,
including its mappings. Standard label uploads retain legacy merge behavior;
uploading a standard definition to a custom program switches it back to the
standard report. Definitions remain scoped to their program.

The client report and XLSX download include matrix group headings. The report API
adds optional `groupLabel` to answer rows; existing rows are unchanged.

Deploy the API before the web changes. Validate a candidate program with EA,
EFS, and the matching definition before production release. Reverting a custom
program to standard behavior requires uploading a standard EA template; it does
not require reimporting responses.
