CREATE OR REPLACE FUNCTION enforce_single_super_admin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('wrg-single-super-admin'));

  IF EXISTS (
    SELECT 1
    FROM "Role"
    WHERE id = NEW."roleId"
      AND key = 'super_admin'
  ) AND EXISTS (
    SELECT 1
    FROM "UserRole"
    WHERE "roleId" = NEW."roleId"
      AND "userId" <> NEW."userId"
  ) THEN
    RAISE EXCEPTION 'Only one Super Admin is allowed'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "UserRole_single_super_admin"
BEFORE INSERT OR UPDATE ON "UserRole"
FOR EACH ROW
EXECUTE FUNCTION enforce_single_super_admin();
