# Program-specific EFS definitions

The admin program wizard has a **Survey Definition** step after EA/EFS upload.
Download the default template there to inspect the effective questions and answer
options for the selected EFS workbook and program year. The workbook has Questions
and Answers sheets and uses the same definitions as import preview. Optionally
upload an edited `.xlsx` in that step. For an existing program without a new EFS
upload, the download uses its currently imported EFS definitions. Preview validates
the uploaded definition before saving.
The multipart field is `surveyDefinitionFile` on historical import `prepare` and `commit`.
Historical EFS preview lists each unresolved Likert question key as a blocking
error. A definition with the exact key and approved wording resolves that error;
templates from a different program year are not used. Commit runs the same
lookup and retains its final guard against missing question text.

You can also download and upload **Questions and Answers** directly from the
admin program view. The download exports the effective definitions from that
program's latest imported EFS, including metadata overrides and year-aware
answer defaults. It does not use the standalone 2026 workbook. Open-text
responses are never exported as answer options. Programs without imported EFS
must import it first.

The program endpoints are `GET /admin/programs/:programId/survey-definition.xlsx`
and multipart `POST /admin/programs/:programId/survey-definition` with the field
`surveyDefinitionFile`. Uploads validate all listed keys and recorded answer
values before updating questions and program metadata atomically. Uploading an
unchanged download performs no updates. Client pages read the saved labels on
refresh; detailed results retain custom answer captions rather than collapsing
them into generic agreement labels.

The wizard's default download is multipart
`POST /admin/historicalImports/default-survey-definition.xlsx` with `metadata`
and `efsFile`. It derives question keys from that EFS, resolves approved question
wording through the same year-aware template lookup as import, and exports actual
recorded and configured answer options. A question with no approved wording has a
blank label in the template; fill it before uploading the definition.

Use two sheets with headers in row 1. Sheet names and headers are case-insensitive;
question keys and raw answers are case-sensitive.

## Questions

| question_key                               | question_label | question_type | category               | display_order |
| ------------------------------------------ | -------------- | ------------- | ---------------------- | ------------- |
| f_WorkplaceDemographics_jobLevel_ORGID_234 | Job level      | demographic   | Workplace Demographics | 1             |

`question_key` and `question_label` are required. The key is the exact EFS export
column name, not a generated platform UUID. Other columns are optional.
Types: `demographic`, `likert`, `choice`, `open-text`, `text`.
Display order is a positive integer.

## Answers

| question_key                               | raw_answer | answer_label           | display_order | score |
| ------------------------------------------ | ---------- | ---------------------- | ------------- | ----- |
| f_WorkplaceDemographics_jobLevel_ORGID_234 | 1          | Executive              | 1             |       |
| f_WorkplaceDemographics_jobLevel_ORGID_234 | 2          | Individual contributor | 2             |       |

The first three columns are required. `raw_answer` can be a numeric code or text
as it appears in EFS. Numeric strings are normalized in the same way as EFS imports.
Every answer row must reference a question in the Questions sheet.
If you provide answer rows for a question, include all its nonblank answer values;
unknown values and duplicate question/answer keys block saving. An empty Answers
sheet with just the headers allows question-label-only overrides.

`display_order` is optional and defaults to workbook row order. `score` is only
needed for Likert questions whose codes differ from the standard scale: 1–5 for
scored answers, 6 for N/A. Existing standard codes 1–5, 6, and 99 keep their default
meaning unless an explicit score is supplied. The existing five-point Likert
reports support up to six distinct labels, including N/A. Demographic answer
lists do not have that limit.

## Scope and defaults

- Overrides belong to one program's EFS, including exact organization-specific
  keys such as `_ORGID_234`. These columns are imported only when explicitly listed.
- Original response values remain unchanged. Labels, ordering, and scores are
  interpreted from stored question metadata by reports and downloads.
- Unlisted questions and omitted answer lists retain the current definitions/defaults.
  Subsequent uploads merge question overrides by key; supplying a new answer list
  replaces that question's previous list.
- Definitions are retained in program metadata for subsequent imports. A customized
  question is never reused as another program's default template.
- Programs without an uploaded definition keep existing behavior. No database
  migration is required.

One raw answer value must have one meaning within a survey. If the same code was
reused for different meanings mid-survey, separate source values or survey versions
are needed; this workbook cannot reconstruct information absent from the export.
