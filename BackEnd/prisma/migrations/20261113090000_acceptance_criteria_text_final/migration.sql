-- Keep the database column aligned with Prisma's canonical String field.
DO $$
DECLARE
  column_type TEXT;
BEGIN
  SELECT udt_name INTO column_type
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'tasks'
    AND column_name = 'acceptance_criteria';

  IF column_type = '_text' THEN
    ALTER TABLE tasks ALTER COLUMN acceptance_criteria DROP DEFAULT;
    ALTER TABLE tasks
      ALTER COLUMN acceptance_criteria TYPE TEXT
      USING COALESCE(array_to_string(acceptance_criteria, E'\n'), '');
    ALTER TABLE tasks ALTER COLUMN acceptance_criteria SET DEFAULT '';
    ALTER TABLE tasks ALTER COLUMN acceptance_criteria SET NOT NULL;
  ELSIF column_type IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'Unexpected type for tasks.acceptance_criteria: %', column_type;
  END IF;
END $$;
