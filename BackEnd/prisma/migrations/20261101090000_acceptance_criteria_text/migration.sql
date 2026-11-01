-- Preserve every existing criterion in its original order, including line breaks.
ALTER TABLE tasks ALTER COLUMN "acceptanceCriteria" DROP DEFAULT;
ALTER TABLE tasks ALTER COLUMN "acceptanceCriteria" TYPE TEXT
  USING COALESCE(array_to_string("acceptanceCriteria", E'\n'), '');
ALTER TABLE tasks ALTER COLUMN "acceptanceCriteria" SET DEFAULT '';
ALTER TABLE tasks ALTER COLUMN "acceptanceCriteria" SET NOT NULL;
ALTER TABLE tasks RENAME COLUMN "acceptanceCriteria" TO acceptance_criteria;
