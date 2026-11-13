DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'tasks'
      AND column_name = 'acceptanceCriteria'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'tasks'
      AND column_name = 'acceptance_criteria'
  ) THEN
    ALTER TABLE tasks RENAME COLUMN "acceptanceCriteria" TO acceptance_criteria;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'tasks'
      AND column_name = 'acceptance_criteria'
  ) THEN
    RAISE EXCEPTION 'Neither tasks.acceptanceCriteria nor tasks.acceptance_criteria exists';
  END IF;
END $$;
