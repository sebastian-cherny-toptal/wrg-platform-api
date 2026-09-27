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
2. Set `FRONTEND_URL` and `ADMIN_FRONTEND_URL` to the public application
   origins, and list any additional Railway testing origins in the
   comma-separated `CORS_ALLOWED_ORIGINS` variable.
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
