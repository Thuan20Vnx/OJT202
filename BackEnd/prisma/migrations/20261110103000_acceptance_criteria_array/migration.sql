DO $$
DECLARE
  column_type TEXT;
BEGIN
  SELECT udt_name INTO column_type
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'tasks'
    AND column_name = 'acceptance_criteria';

  IF column_type = 'text' THEN
    ALTER TABLE tasks ALTER COLUMN acceptance_criteria DROP DEFAULT;
    ALTER TABLE tasks
      ALTER COLUMN acceptance_criteria TYPE TEXT[]
      USING CASE
        WHEN acceptance_criteria IS NULL OR acceptance_criteria = '' THEN ARRAY[]::TEXT[]
        ELSE regexp_split_to_array(acceptance_criteria, E'\r?\n')
      END;
    ALTER TABLE tasks ALTER COLUMN acceptance_criteria SET DEFAULT ARRAY[]::TEXT[];
    ALTER TABLE tasks ALTER COLUMN acceptance_criteria SET NOT NULL;
  ELSIF column_type IS DISTINCT FROM '_text' THEN
    RAISE EXCEPTION 'Unexpected type for tasks.acceptance_criteria: %', column_type;
  END IF;
END $$;
