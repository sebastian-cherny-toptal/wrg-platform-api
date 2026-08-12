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
3. `npm run db:deploy && npm run db:seed`.
4. `npm run start:dev`.

- Nest API: `http://localhost:3000/api/v1` (Swagger at `/docs`)
- Frontend-compatible routes: `http://localhost:3000/user/login`, `/client/...`, etc.
- Seed Nest account: `admin@example.test` / `ChangeMe123!` (local-only)

## Safety

- Integration calls for Nest modules are mocked while `INTEGRATIONS_MOCK=true`.
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
