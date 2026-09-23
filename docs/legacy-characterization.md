# Legacy characterization

This document records observed behavior without reproducing credentials or customer data.

## Runtime compatibility

`wrg-platform-api` exposes the FE/integration paths (`/user`, `/client`, `/admin`, `/payment`, `/zoho`, `/dashboard`, `/health`, `/ping`, and `/webhook/stripe/payment`) through native Nest controllers backed by PostgreSQL. Nest also owns `/api/v1`, `/docs`, and `/openapi.json`.

## Source model mapping

- `organization`: Zoho account fields, Stripe customer ID, contact and employee metadata. Previous-system identifiers may be stored as `legacyId`; Zoho `id` maps to `externalId`; long-tail fields remain in `metadata`.
- `project`, `program`, `organizationprogram`: project/program hierarchy plus deal-specific report access, fees, payment state, survey counts, and rankings. The new join entity enforces one organization enrollment per program.
- `User`, `Role`, `loginSession`: tenant-aware identity, roles, permissions, and revocable refresh sessions. New credentials are hashed with Argon2.
- `survey`, `surveyQuestion`, `surveyRespondent`: CheckMarket IDs become external IDs. Embedded respondent answers become normalized `Response` rows.
- `order`: legacy string amounts are converted to integer minor currency units. New checkout never mutates prices based on environment.
- webhook/log/custom report records map to `WebhookEvent`, `AuditLog`, assets, and generated report projections.

## Characterized routes

The platform does not expose Zoho or CheckMarket webhook receivers or the previous `/webhook/*` synchronization controls. Provider synchronization initiated by supported administrative workflows remains separate from inbound callbacks. Stripe payment callbacks are retained at `/webhook/stripe/payment` and `/api/v1/webhooks/stripe` and require Stripe's signature.

Observed commerce behavior creates Stripe PaymentIntents and invoice orders, then writes report-access fields back to Zoho. Nest records immutable order items and defers CRM projection updates to idempotent BullMQ jobs.

## Platform invariants

1. Platform and provider identifiers remain queryable.
2. Tenant-owned records cannot be accessed using only a caller-supplied organization ID.
3. Money is stored in minor units with an explicit ISO currency.
4. Webhook provider/event IDs and sync idempotency keys are unique.
5. PostgreSQL is authoritative for both frontend-compatible routes and `/api/v1`.
6. Production records are created through supported platform workflows rather than imported from the previous application.
