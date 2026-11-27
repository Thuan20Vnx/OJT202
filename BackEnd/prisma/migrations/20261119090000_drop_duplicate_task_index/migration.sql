-- tasks_project_id_status_idx (project_id, status) là tiền tố của
-- tasks_project_status_due_idx (project_id, status, "dueDate") nên không cần nữa.
DROP INDEX IF EXISTS "tasks_project_id_status_idx";
