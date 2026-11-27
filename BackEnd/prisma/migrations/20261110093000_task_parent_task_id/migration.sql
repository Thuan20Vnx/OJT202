DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'tasks'
      AND column_name = 'parent_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'tasks'
      AND column_name = 'parent_task_id'
  ) THEN
    ALTER TABLE tasks RENAME COLUMN parent_id TO parent_task_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'tasks'
      AND column_name = 'parent_task_id'
  ) THEN
    RAISE EXCEPTION 'Neither tasks.parent_id nor tasks.parent_task_id exists';
  END IF;
END $$;
