-- Preserve tasks and comments for audit; normal application queries exclude tombstones.
ALTER TABLE tasks ADD COLUMN deleted_at TIMESTAMP(3);
CREATE INDEX tasks_project_id_deleted_at_idx ON tasks(project_id, deleted_at);
