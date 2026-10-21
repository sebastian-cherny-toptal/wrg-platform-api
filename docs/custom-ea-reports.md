# Custom Benefits & Best Practices reports

Every program has an uploaded EA Definition or a pinned default template version,
starting at v1. New programs without an upload use the full v1 catalog. The chosen
content is saved with the program and future releases do not alter it. Uploaded
definitions replace the complete previous selection. See
[survey-definitions.md](survey-definitions.md) for source storage and deployment.

Calculation definitions select the quantitative questions, answer rows, ordering,
and calculations. They are stored as
`program.metadata.employerAssessmentReportDefinition = { version: 2, questions }`.
This `2` is the report data format, separate from template version `v1`.

## Workbook contract

Use the existing EA definition upload endpoints and multipart field
`employerAssessmentDefinitionFile`. The workbook retains Questions and Answers.
EA uploads require `category` and `display_order` on every Questions row and
`display_order` on every Answers row, including standard label templates. Missing
columns and blank or whitespace-only cells are rejected; no category or order is
inferred. Orders must be positive whole numbers. EFS requires an explicit `question_type` for every question.

For custom reports, every Questions row includes:

| Column                             | Meaning                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| question_key                       | Unique report question key; matrix item keys must be unique.                  |
| question_label                     | Display wording.                                                              |
| category                           | Report section.                                                               |
| display_order                      | Presentation order, independent of raw codes.                                 |
| calculation                        | `yesNo`, `choice`, `multi`, or `mean`.                                        |
| source_column                      | EA export column used by scalar questions.                                    |
| output_format                      | `number` or `percent`; percentages use 0–100 values.                          |
| group_key                          | Optional shared parent question key for matrix items.                         |
| group_label                        | Optional item heading within that parent.                                     |
| eligible_question / eligible_value | Optional EA column and raw code restricting eligible organizations.           |
| missing_source                     | `skip` for a reusable catalog; blank or `error` requires every mapped source. |

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
supplied Campaign, Ad Age, and Automotive Dealership (AD) QA sheets can also be
uploaded. Question keys and types are declared in the existing report bindings
in `src/modules/reports/benefits-question-bindings.ts`, including additional PTO
policies, bonuses, four-day weeks, and training and career
development. These contracts apply across programs, captions, and workbook names.
Report generation, Q&A normalization, and Question Response conversion reuse
these same bindings. Numeric questions use the `mean` calculation. Explicit
selection instructions and matrix structure take precedence during
Question Response conversion. Unknown questions still require explicit mappings,
and generated source mappings must match the program's EA export. The default
report template continues to control which questions appear in a standard report.
Use a newly converted definition to include questions that the earlier converter
omitted.

## Validation and calculations

Preview and save validate the same definition. Source columns must exist in the
EA export or the saved program's EA survey. Known question aliases, smart quotes,
whitespace, single/double quote differences, and Medallia's semicolon-to-space
header conversion are resolved. Exact matches take priority. A shortened export
header can match the beginning of a longer source name only under the same
question key and with at least 60 characters of matching answer text. This
fallback must identify one export column and must not map distinct source names
to the same column; ambiguous matches fail and require explicit source mappings.
The same resolution is used for validation and report calculations. Changing a
display caption never changes a source column.

Scalar/matrix percentages use answered eligible organizations. Multi-select
percentages use the full eligible cohort, preserving current behavior. Numeric
means include finite values, including zero; holiday means are not limited to
1–25. A nonblank free-text Other answer counts as selected. Missing calculations
display `x`, as do cohorts with fewer than five available employer assessments.

The default downloadable EA template combines the 38 legacy report questions
with the nine additional AD questions and the AD answer variants. It includes
all calculation and source mapping columns. New programs without an upload use this pinned catalog. Existing saved
definitions retain their content.
EA downloads omit `question_type` and `score`; EA report behavior is controlled
by `calculation`. Older uploads containing these columns remain accepted.
EFS templates retain both columns because EFS processing uses them.

Default template rows use `missing_source = skip`. Questions whose source columns
are absent from a program are ignored, and absent multi-select/numeric answer
columns are omitted rather than displayed as zero. Sections are created only
for applicable questions, so extra catalog questions do not create empty
sections. An eligibility condition on these optional rows applies only when its
parent question column exists in the program; blank individual answers never
disable the condition. Ambiguous sources still block uploads. Remove `skip` or
use `error` to require a particular question and all its mapped answer columns.
Custom templates without this column retain their existing strict validation.

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
