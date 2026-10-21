-- Direct program creation also gets an explicit, immutable default version.
ALTER TABLE "Program" ALTER COLUMN "metadata" SET DEFAULT
  '{"surveyDefinitionVersion":"v1","employerAssessmentDefinitionVersion":"v1"}'::jsonb;

CREATE FUNCTION pin_program_definition_sources() RETURNS trigger AS $$
BEGIN
  IF NOT (NEW."metadata" ? 'surveyDefinitionVersion')
     AND jsonb_typeof(NEW."metadata"->'surveyDefinition') IS DISTINCT FROM 'array'
     AND jsonb_typeof(NEW."metadata"->'surveyDefinitionFile'->'contentBase64') IS DISTINCT FROM 'string' THEN
    NEW."metadata" := NEW."metadata" || '{"surveyDefinitionVersion":"v1"}'::jsonb;
  END IF;
  IF NOT (NEW."metadata" ? 'employerAssessmentDefinitionVersion')
     AND jsonb_typeof(NEW."metadata"->'employerAssessmentDefinition') IS DISTINCT FROM 'array'
     AND jsonb_typeof(NEW."metadata"->'employerAssessmentReportDefinition') IS DISTINCT FROM 'object'
     AND jsonb_typeof(NEW."metadata"->'employerAssessmentDefinitionFile'->'contentBase64') IS DISTINCT FROM 'string' THEN
    NEW."metadata" := NEW."metadata" || '{"employerAssessmentDefinitionVersion":"v1"}'::jsonb;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER program_definition_sources BEFORE INSERT OR UPDATE ON "Program"
FOR EACH ROW EXECUTE FUNCTION pin_program_definition_sources();

-- NOT VALID allows the deployment backfill to archive legacy custom definitions
-- before validating all historical rows. New writes are checked immediately.
ALTER TABLE "Program" ADD CONSTRAINT program_efs_definition_source CHECK (
  COALESCE("metadata"->>'surveyDefinitionVersion' ~ '^v[1-9][0-9]*$', false)
  OR COALESCE(length("metadata"->'surveyDefinitionFile'->>'contentBase64') > 0, false)
) NOT VALID;
ALTER TABLE "Program" ADD CONSTRAINT program_ea_definition_source CHECK (
  COALESCE("metadata"->>'employerAssessmentDefinitionVersion' ~ '^v[1-9][0-9]*$', false)
  OR COALESCE(length("metadata"->'employerAssessmentDefinitionFile'->>'contentBase64') > 0, false)
) NOT VALID;
