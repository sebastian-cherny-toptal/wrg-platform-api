# Program definition files and template versions

Every program has two independent, durable selections: **EFS Survey Definition**
and **EA Definition**. A new program without uploaded definition files uses
**default template v1** for each. The wizard and final review name that choice.
Changing a program's ordinary settings or reuploading survey data preserves its
saved selections. Selecting “Use default template v1” explicitly replaces a saved
custom definition.

Each selection stores a full definition snapshot in program metadata and either:

- `surveyDefinitionVersion` / `employerAssessmentDefinitionVersion`, such as `v1`; or
- `surveyDefinitionFile` / `employerAssessmentDefinitionFile`, containing the
  original filename, SHA-256, and original workbook bytes (`contentBase64`).

Files are retained in the database after temporary import files are removed.
Program downloads export the saved definition, including normalized EA calculation
mappings. They never reconstruct a definition from another program's questions.
Uploading an identical file still records its source association.

Released catalogs live in `src/modules/imports/templates/v1/efs.json` and `ea.json`.
The UK Campaign alternative is also frozen in that directory and exported as
version v1. Released files are immutable. To release v2, add new catalog files and register them in
`definition-templates.ts`, then advance `CURRENT_DEFINITION_VERSION`. Keep all
released versions. Programs keep their saved snapshots and version IDs; a release
only changes the default for newly configured programs. Update the database
default and trigger in a new migration when advancing the default for direct
database creation too; existing version IDs are never rewritten.

## Deployment and existing programs

The migration adds database source checks for both definitions and a default for
programs created outside the import wizard. Both `npm run db:deploy` and
`npm run db:deploy:production` run the idempotent backfill and validate the checks.
The production command requires the built `dist` artifact.

The backfill archives existing definitions as XLSX snapshots when the original
bytes were not retained. For existing surveys it captures that program’s current
EFS wording, types and answers and the previous EA report catalog, preserving
current behavior. Programs without imported data or saved definitions use v1.
It never consults another program’s questions.
Run it separately with `npm run db:pin-program-definitions` if necessary.

## EFS workbook

Use **Questions** and **Answers** sheets with headers in row 1. Sheet names and
headers are case-insensitive; question keys and raw answers are case-sensitive.
Upload a complete replacement definition, covering every imported EFS question.
Missing questions block saving. Unused catalog questions may remain in the file.

| Questions column | Requirement |
| --- | --- |
| `question_key` | Required exact EFS column name, including organization-specific suffixes. |
| `question_label` | Required full question wording. |
| `question_type` | Required on every row: `likert`, `demographic`, `choice`, `open-text`, or `text`. Missing columns, blanks, whitespace and unknown values are rejected. |
| `category` | Optional. Blank means no category. |
| `display_order` | Optional positive whole number; otherwise uses this file's question row order. |

Types, labels, categories, ordering and answer lists are never merged with a
previous upload or inherited from stored questions. Organization-specific columns
such as `_ORGID_234` must be explicitly listed to be imported.

Answers requires `question_key`, `raw_answer`, and `answer_label`.
`display_order` is optional and defaults to row order within the question.
Include all recorded nonblank values for every supplied answer list. Open-text
questions do not need answer rows. Omitted answer lists clear the previous list.
For Likert answers whose raw codes differ from standard codes, provide `score`:
1–5 for scored responses and 6 for N/A. Standard raw codes 1–5, 6, and 99 retain
their scale meaning. There can be at most six distinct Likert captions, including
N/A. Response values themselves are preserved.

The selected-EFS download uses v1 and the source EFS keys. Unknown keys have blank
wording and type; complete those cells before uploading. No database question
lookup supplies missing definitions.

The Re-uploads tab has **Download current file** beside each definition's upload
control. It downloads the original uploaded workbook and filename, or exports
that program's saved template snapshot with its version in the filename. The
separate editable-definition downloads continue to include normalized mappings.

## Endpoints

- `GET /admin/historicalImports/default-survey-definition.xlsx`: full default EFS v1 template.
- `POST /admin/historicalImports/default-survey-definition.xlsx`: template for the uploaded `efsFile` and `metadata`.
- `POST /admin/historicalImports/default-employer-assessment-definition.xlsx`: default EA v1 catalog.
- `GET /admin/programs/:programId/definitions/:kind/current.xlsx`: current uploaded file or pinned snapshot (`EFS` or `EA`).
- `GET /admin/programs/:programId/survey-definition.xlsx`: saved EFS definition.
- `POST /admin/programs/:programId/survey-definition`: complete replacement `surveyDefinitionFile`.
- `GET /admin/programs/:programId/employer-assessment-definition.xlsx`: saved EA definition.
- `POST /admin/programs/:programId/employer-assessment-definition`: complete replacement `employerAssessmentDefinitionFile`.

The historical-import preview and submit endpoints accept the same multipart
file fields. EA columns and calculation rules are documented in
[custom-ea-reports.md](custom-ea-reports.md). EA does not require `question_type`;
its calculation mappings determine report behavior.
