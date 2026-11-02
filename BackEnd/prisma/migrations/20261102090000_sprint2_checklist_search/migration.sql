BEGIN;
ALTER TABLE tasks RENAME COLUMN parent_id TO parent_task_id;
ALTER TABLE tasks RENAME CONSTRAINT tasks_parent_id_fkey TO tasks_parent_task_id_fkey;
ALTER INDEX tasks_parent_id_idx RENAME TO tasks_parent_task_id_idx;

CREATE TABLE checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,
  title VARCHAR(300) NOT NULL,
  is_done BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0)
);
CREATE INDEX checklist_items_task_id_position_idx ON checklist_items(task_id, position);
-- Preserve order, text and completion from every existing task, including soft-deleted tasks.
INSERT INTO checklist_items (task_id, title, is_done, position)
SELECT t.id, item.value->>'text', COALESCE((item.value->>'done')::boolean, false), item.ordinality - 1
FROM tasks t CROSS JOIN LATERAL jsonb_array_elements(t.checklist) WITH ORDINALITY AS item(value, ordinality);
ALTER TABLE tasks DROP COLUMN checklist;
CREATE INDEX tasks_project_status_due_idx ON tasks(project_id, status, "dueDate");
CREATE INDEX tasks_workspace_assignee_due_idx ON tasks(workspace_id, assignee_id, "dueDate");
ALTER TABLE comments ADD COLUMN deleted_at TIMESTAMP(3);
COMMIT;
