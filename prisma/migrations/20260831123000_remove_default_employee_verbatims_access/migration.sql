-- Employee Verbatims is not part of the access granted merely by assigning a
-- Client to an organization and program. Reverse the earlier client backfill
-- for non-Full-Package enrollments while preserving explicitly full packages.
UPDATE "OrganizationProgram" AS enrollment
SET "reportAccess" = COALESCE(enrollment."reportAccess", '{}'::jsonb) ||
  '{"EV_Access":"no"}'::jsonb,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE LOWER(COALESCE(enrollment.stage, '')) <> 'full package'
  AND LOWER(COALESCE(enrollment."reportAccess"->>'SEV_Access', '')) <> 'yes'
  AND EXISTS (
    SELECT 1
    FROM "User" AS portal_user
    INNER JOIN "UserProgram" AS user_program
      ON user_program."userId" = portal_user.id
    INNER JOIN "UserRole" AS user_role
      ON user_role."userId" = portal_user.id
    INNER JOIN "Role" AS role
      ON role.id = user_role."roleId"
    WHERE portal_user."organizationId" = enrollment."organizationId"
      AND user_program."programId" = enrollment."programId"
      AND role.key = 'client'
  );

-- Repair completed Response Detail purchases whose order was marked paid
-- before its enrollment entitlement was persisted.
UPDATE "OrganizationProgram" AS enrollment
SET "reportAccess" = COALESCE(enrollment."reportAccess", '{}'::jsonb) ||
  '{"RD_Access":"yes"}'::jsonb,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1
  FROM "Order" AS purchase
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE jsonb_typeof(purchase.items)
      WHEN 'array' THEN purchase.items
      ELSE jsonb_build_array(purchase.items)
    END
  ) AS item
  WHERE purchase."organizationProgramId" = enrollment.id
    AND purchase.status = 'PAID'
    AND COALESCE(
      item->>'productId',
      item->'keys'->>'productId'
    ) = 'report-response-detail'
);
