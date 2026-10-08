# Report templates

`workforce-feedback-results.xlsx` is deprecated as a structural report
template. The Workforce Feedback generator creates every section, question,
average, note, and supplementary row dynamically from the current survey
definition. The workbook remains in this directory only as the visual style
source for the report header, logo, column widths, and row formatting.

Do not add fixed question slots or section capacities to this workbook. New
Workforce Feedback layout behavior belongs in `report-template-workbooks.ts`.

`annual-trends.xlsx` is likewise deprecated as a structural report template.
The Annual Trends generator creates its section, question, section-average,
survey-average, and note rows dynamically from the two surveys being compared.
The workbook remains only as the visual source for the report header, logo,
column widths, and row formatting. Do not add fixed question or section slots
to it; Annual Trends layout behavior belongs in `report-template-workbooks.ts`.
