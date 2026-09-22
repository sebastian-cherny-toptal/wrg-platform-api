# Organization-level re-sort edits: technical discovery

This note supports issue 16 in `wrg-platform-web/docs/elle-tuesday/issues/16-organization-resort-edits.md`. The issue remains `needs-info`; this is a record of current code and implementation questions, not an approved API contract.

## Verified current behavior

- `POST /admin/resortOrg` in `src/modules/management/compatibility-admin.module.ts` requires the `orderLogAccess` permission and a `dealid`. It resolves one `OrganizationProgram`, reads the program's employee and employer survey IDs, and enqueues CheckMarket `survey` jobs. It has no response-edit payload, preview, approval, or edit audit write.
- The `SyncProcessor` in `src/modules/crm-sync/crm-sync.module.ts` calls `CheckMarketAdapter.getSurvey()` for those jobs and records the fetched result in `SyncJob`. This path does not update an organization's `Respondent` or `Response` rows or regenerate reports.
- `Survey` and `Question` are program-scoped. `Respondent` has an optional `organizationId`; `Response` belongs to a respondent and a question. A new organization-level write must constrain both the respondent's organization and its survey/program. Changing a shared `Question` label or metadata could affect every organization in the program.
- `AuditLog` can store actor, organization, action, resource, before/after, and correlation ID. The current re-sort route does not create one.
- The old Express `resortOrg` deleted survey/question material and re-fetched respondents. Its behavior is historical context, not a safe specification for the new edit path.

## Contract required before implementation

The missing before/after workbook must identify the exact fields and records to change, their original and desired values, the organization and program, and the expected report differences. Product decisions must then settle:

1. Whether the operation edits response values, respondent metadata, answer definitions, or an organization-specific mapping; what stable record key identifies each change; and how conflicting or stale values are rejected.
2. Whether changes are prepared and approved separately, which roles can do each step, and which counts, affected responses, and report differences are shown in the preview.
3. How corrections or rollback work, what before/after details may be retained in the audit log, and how confidential response content is protected there.
4. Which generated reports and downloads are affected, how their existing assets are invalidated or regenerated, and how completion or failure is reported.

Once approved, define request/response shapes and authorization in the implementation brief. Verify the operation against a representative fixture with two organizations in one program: the target organization's approved values and reports change, while the other organization's responses, definitions, and reports remain identical. Also verify stale-input rejection, audit content, and report refresh behavior. Until the contract is approved, do not add a generic response editor or repurpose the existing `resortOrg` route as one.
