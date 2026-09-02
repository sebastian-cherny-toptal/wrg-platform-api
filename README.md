# WRG Platform API

Strict TypeScript/NestJS service that **replaces** the legacy Express/Mongoose backend (`wrg-platform-be`).

It serves two surfaces on one port:

| Surface | Paths | Stack |
|---------|--------|--------|
| **Native compatibility** (FE drop-in) | `/user`, `/client`, `/admin`, `/webhook`, `/payment`, `/zoho`, `/dashboard`, `/ping`, `/health` | NestJS / Fastify / PostgreSQL / Prisma |
| **Platform API** | `/api/v1/*`, `/docs`, `/openapi.json` | NestJS / Fastify / PostgreSQL / Prisma |

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

The command is idempotent: each run replaces only records in the `seed-br`
namespace, leaving ordinary application data untouched. The ZIP can instead be
an extracted directory when passed via `--source` or `BR_SEED_SOURCE`. The
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
- ETL only reads MongoDB unless both `ETL_ALLOW_WRITE=true` and `--apply` are supplied.
- No production credentials belong in this repository.
- To provision the first production administrator, set `ADMIN_USERNAME` (a valid
  email address) and `ADMIN_PASSWORD` on the API service. On startup the API
  creates an active administrator when that email/username is unused. When it
  already exists, the API updates its password only if the configured password
  differs, allowing credential rotation through a variable change and redeploy.
- Stripe webhooks use Stripe raw-body verification. Canonical Zoho/CheckMarket webhooks use `x-wrg-timestamp` + `x-wrg-signature`. Compatibility callbacks are recorded as unverified during provider URL migration; manual `/webhook/*` sync controls require an administrator/operations JWT.

## Commands

`npm run lint`, `npm run typecheck`, `npm test`, `npm run openapi:generate`, and `npm run client:generate` are suitable for CI. `scripts/start-local.sh` starts dependencies and the API; `scripts/reset-local.sh` destructively resets only the configured local PostgreSQL database.

## Cutover from wrg-platform-be

1. Run the Mongo-to-Postgres ETL and reconciliation against a production snapshot.
2. Deploy this service with PostgreSQL, Redis, Stripe, Zoho, and CheckMarket credentials.
3. Switch the frontend API origin to the new host.
4. Switch Stripe to `/webhook/stripe/payment` (or `/api/v1/webhooks/stripe`) and move Zoho/CheckMarket to the signed canonical `/api/v1/webhooks/*` routes when those providers can supply the shared-signature headers.
