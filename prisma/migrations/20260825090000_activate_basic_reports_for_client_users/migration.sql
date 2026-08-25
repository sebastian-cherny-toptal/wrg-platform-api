-- A Client assigned to an organization and program owns the program's basic
-- reporting package. Keep additional-report entitlements unchanged.
UPDATE "OrganizationProgram" AS enrollment
SET "reportAccess" = COALESCE(enrollment."reportAccess", '{}'::jsonb) ||
  '{"WFR_Access":"yes","EV_Access":"yes","WBC_Access":"yes","BBP_Access":"yes"}'::jsonb,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (
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
