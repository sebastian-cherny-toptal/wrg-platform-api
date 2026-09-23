# WRG Platform API

Strict TypeScript/NestJS service backed by PostgreSQL and Prisma.

It serves two surfaces on one port:

| Surface                               | Paths                                                                                           | Stack                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Native compatibility** (FE drop-in) | `/user`, `/client`, `/admin`, `/payment`, `/zoho`, `/dashboard`, `/ping`, `/health`, `/webhook/stripe/payment` | NestJS / Fastify / PostgreSQL / Prisma |
| **Platform API**                      | `/api/v1/*`, `/docs`, `/openapi.json`                                                           | NestJS / Fastify / PostgreSQL / Prisma |

Point `REACT_APP_API_ENDPOINT` at this service the same way you pointed it at `wrg-platform-be`.

## Local development

1. Copy `.env.example` to `.env` and set the local service credentials.
2. `docker compose up -d` (Postgres, Redis, MinIO).
3. `npm run db:deploy && npm run db:seed` (roles and permissions only).
4. `npm run start:dev`.

### Baton Rouge XLSX-backed local data

The Baton Rouge Medallia exports and published report workbooks can be loaded
into PostgreSQL as deterministic local data. Report endpoints never substitute
in-code examples: all rendered values come from these imported rows and program
snapshots. Administrative and identity columns before `Score %` are excluded;
report questions and answers after it, including employee verbatims, are
preserved exactly.

With the repository's `Baton Rouge 24-26.zip` in the parent directory:

```sh
npm run db:seed:baton-rouge -- --source "../Baton Rouge 24-26.zip"
```

To validate the files without connecting to PostgreSQL:

```sh
npm run db:seed:baton-rouge -- --source "../Baton Rouge 24-26.zip" --dry-run
```

The Docker Compose one-shot service applies migrations and imports the same file:

```sh
docker compose --profile baton-rouge run --rm seed-baton-rouge
```

Use `--report-source <directory>` or `BR_REPORT_SOURCE` when the published
workbooks are not beside the raw ZIP. Every non-dry run automatically reconciles
survey/question/response totals, round-trips the published XLSX snapshots, and
asserts that the report user has every imported program grant.

The seed imports `BR_SEED_ORGANIZATIONS_COUNT` organizations from each raw
workbook (10 by default when the value is missing or is not a positive integer).
Commerce Title & Abstract Company is always selected first, and `test.baton`
remains scoped only to that organization.

The seed reads `BR 2026 Ranking Data Extract.xlsx` from the repository root and
matches its `Alias Name` values to 2026 organizations. Use
`--ranking-source <file>` or `BR_RANKING_SOURCE` to override that path. Valid
`CY Winner` values (`Yes` or `No`) set each matching organization-program's
winner status; other values are ignored.

Before writing, the command compares the `test.baton` user, its project and
program links, and the seeded organization-program count with the incoming
seed's expected metrics. When every metric matches, it skips the rebuild. Set
`BR_SEED_FORCE_UPDATE=true` to force the existing `seed-br` records to be
deleted and recreated. When a rebuild is needed, only records in the `seed-br`
namespace are replaced, leaving ordinary application data untouched. The ZIP
can instead be an extracted directory when passed via `--source` or
`BR_SEED_SOURCE`. The
reusable parser lives in `src/modules/imports/xlsx-survey-importer.ts`; a future
multipart endpoint can save an upload to a temporary path and use the same
definition/row iteration API as the seed CLI.

To regenerate the sanitized web E2E fixture without copying raw survey data
into Git, run:

```sh
npm run fixture:baton-rouge -- \
  --source "../Baton Rouge 24-26.zip" \
  --report-source .. \
  --output "../wrg-platform-web/apps/client/e2e/fixtures/baton-rouge-test-data.zip"
```

The generated archive preserves numeric survey inputs and aggregate reports,
but replaces row-level identifiers, categorical strings, and free text with
deterministic synthetic values.

That sanitized archive is only a regression/E2E fixture. The production image
bundles the explicitly committed inputs under `secure/`. To seed a deployed
environment, set `BR_SEED_SOURCE` to
`/app/secure/seed-data/Baton Rouge 24-26.zip` and `BR_REPORT_SOURCE` to
`/app/secure/report-data`; otherwise the production deployment command applies
migrations without creating demo data.

The seed creates a client user with access to every imported Baton Rouge program:

- Username: `test.baton`
- Email: `test.baton@example.test`

- Nest API: `http://localhost:3000/api/v1` (Swagger at `/docs`)
- Frontend-compatible routes: `http://localhost:3000/user/login`, `/client/...`, etc.

## Safety

- Integration reads return no fabricated provider records while `INTEGRATIONS_MOCK=true`.
- No production credentials belong in this repository.
- To provision the first production administrator, set `ADMIN_USERNAME` (a valid
  email address) and `ADMIN_PASSWORD` on the API service. On startup the API
  creates an active administrator when that email/username is unused. When it
  already exists, the API updates its password only if the configured password
  differs, allowing credential rotation through a variable change and redeploy.
- Stripe payment webhooks use Stripe raw-body verification. Zoho and CheckMarket webhook receivers and legacy `/webhook/*` synchronization controls are not part of this service.

## Commands

`npm run lint`, `npm run typecheck`, `npm test`, `npm run openapi:generate`, and `npm run client:generate` are suitable for CI. `scripts/start-local.sh` starts dependencies and the API; `scripts/reset-local.sh` destructively resets only the configured local PostgreSQL database.

## Fresh production database launch

This service does not import or synchronize data from the previous application.
Production starts from a new PostgreSQL database, and all organizations, users,
projects, programs, surveys, entitlements, and orders must be created in this
platform.

1. Provision an empty PostgreSQL database and Redis instance.
2. Configure the production environment without `BR_SEED_SOURCE` unless the
   explicitly committed Baton Rouge dataset is intentionally required.
3. Run `npm run db:deploy` to create the schema from the committed Prisma
   migrations.
4. Run `npm run db:seed` once to create the platform roles and permissions.
5. Create the required production administrators and business records through
   the supported application workflows.
6. Validate authentication, authorization, reports, payments, queues, and
   integrations on the Railway temporary URLs.
7. Take a PostgreSQL backup, then switch the frontend API origin and public
   domains to the new services.
8. Switch Stripe to `/webhook/stripe/payment` (or
   `/api/v1/webhooks/stripe`). Configure any Zoho or CheckMarket automation
   outside this service; it does not expose webhook receivers for those
   providers.

The previous application remains a separate historical system. There is no
dual-write, reconciliation, or automatic rollback of data between the two
applications. After customer writes begin here, rollback means restoring this
PostgreSQL database or deploying a forward fix—not routing writes back to the
previous application.
