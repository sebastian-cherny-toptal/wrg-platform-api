# Legacy characterization

This document records observed behavior without reproducing credentials or customer data.

## Runtime compatibility

`wrg-platform-api` exposes the FE/integration paths (`/user`, `/client`, `/admin`, `/webhook`, `/payment`, `/zoho`, `/dashboard`, `/health`, `/ping`) through native Nest controllers backed by PostgreSQL. The copied Express/Mongoose runtime has been removed. Nest also owns `/api/v1`, `/docs`, and `/openapi.json`.

## Source model mapping

- `organization`: Zoho account fields, Stripe customer ID, contact and employee metadata. Stable Mongo `_id` maps to `legacyId`; Zoho `id` maps to `externalId`; long-tail fields remain in `metadata`.
- `project`, `program`, `organizationprogram`: project/program hierarchy plus deal-specific report access, fees, payment state, survey counts, and rankings. The new join entity enforces one organization enrollment per program.
- `User`, `Role`, `loginSession`: tenant-aware identity, roles, permissions, and revocable refresh sessions. Legacy PBKDF2 hashes must be rehashed to Argon2 after a controlled migration/login flow.
- `survey`, `surveyQuestion`, `surveyRespondent`: CheckMarket IDs become external IDs. Embedded respondent answers become normalized `Response` rows.
- `order`: legacy string amounts are converted to integer minor currency units. New checkout never mutates prices based on environment.
- webhook/log/custom report records map to `WebhookEvent`, `AuditLog`, assets, and generated report projections.

## Characterized routes

The old service exposed unauthenticated synchronization routes alongside provider callbacks. Native compatibility keeps provider callback paths available, records them idempotently, and queues provider work. Manual synchronization paths now require an administrator or operations JWT. The canonical `/api/v1/webhooks/*` routes require provider signatures.

Observed commerce behavior creates Stripe PaymentIntents and invoice orders, then writes report-access fields back to Zoho. Nest records immutable order items and defers CRM projection updates to idempotent BullMQ jobs.

## Migration invariants

1. Mongo and provider identifiers remain queryable.
2. Tenant-owned records cannot be accessed using only a caller-supplied organization ID.
3. Money is stored in minor units with an explicit ISO currency.
4. Webhook provider/event IDs and sync idempotency keys are unique.
5. ETL source access uses Mongo read preference and defaults to dry-run.
6. Reconciliation compares counts before any cutover; additional field-level checks should be added per migration wave.
7. PostgreSQL is authoritative for both frontend-compatible routes and `/api/v1`; Mongo is read only by explicit ETL/reconciliation commands.
