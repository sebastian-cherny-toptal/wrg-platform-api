# WRG Platform API

Strict TypeScript/NestJS service that **replaces** the legacy Express/Mongoose backend (`wrg-platform-be`).

It serves two surfaces on one port:

| Surface | Paths | Stack |
|---------|--------|--------|
| **Native compatibility** (FE drop-in) | `/user`, `/client`, `/admin`, `/webhook`, `/payment`, `/zoho`, `/dashboard`, `/ping`, `/health` | Nest controllers + preserved MongoDB business logic |
| **Platform API** | `/api/v1/*`, `/docs`, `/openapi.json` | NestJS / Fastify / PostgreSQL / Prisma |

Point `REACT_APP_API_ENDPOINT` at this service the same way you pointed it at `wrg-platform-be`.

## Local development

1. Copy `.env.example` to `.env` and set Mongo + secrets (see below).
2. `docker compose up -d` (Postgres, Redis, MinIO).
3. `npm run db:deploy && npm run db:seed`.
4. `npm run start:dev`.

- Nest API: `http://localhost:3000/api/v1` (Swagger at `/docs`)
- Legacy routes: `http://localhost:3000/user/login`, `/client/...`, etc.
- Seed Nest account: `admin@example.test` / `ChangeMe123!` (local-only)

### Legacy secrets

Pick one:

1. **AWS Secrets Manager** (same as old BE): set `APP_ENV=dev` and use the `wrg` AWS profile.
2. **Env file JSON**: `LEGACY_SECRETS_FILE=./secrets.local.json` (shape matches `ha-*-secrets`).
3. **Process env**: `LEGACY_SECRETS_FROM_ENV=true` plus at least `MONGO_URI` and `JWT_SECRET` (or `JWT_ACCESS_SECRET`).

Disable compatibility endpoints with `LEGACY_COMPAT=false` (Nest-only; not FE-compatible).

The compatibility implementation is part of the Nest project under `src/native-legacy/`. Its controllers, Mongoose models, middleware, report calculations, webhook handlers, uploads, and provider helpers are loaded by `LegacyRuntimeService`; no Express application or separate legacy project is mounted.

## Safety

- Integration calls for Nest modules are mocked while `INTEGRATIONS_MOCK=true`.
- ETL only reads MongoDB unless both `ETL_ALLOW_WRITE=true` and `--apply` are supplied.
- No production credentials belong in this repository.
- Nest Stripe webhooks use Stripe raw-body verification. Nest Zoho/CheckMarket webhooks use `x-wrg-timestamp` + `x-wrg-signature`. Legacy webhook routes keep their existing verification behavior.

## Commands

`npm run lint`, `npm run typecheck`, `npm test`, `npm run openapi:generate`, and `npm run client:generate` are suitable for CI. `scripts/start-local.sh` starts dependencies and the API; `scripts/reset-local.sh` destructively resets only the configured local PostgreSQL database.

## Cutover from wrg-platform-be

1. Deploy this service with `LEGACY_COMPAT=true` and the same Mongo/secrets the old BE used.
2. Switch the frontend (and Stripe/CheckMarket/Zoho webhook URLs) to the new host.
3. Keep Nest `/api/v1` for new clients; migrate compatibility handlers to Prisma-backed services over time via ETL into Postgres.
