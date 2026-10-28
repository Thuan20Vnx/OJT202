CREATE TYPE "ProjectRole" AS ENUM ('pm', 'member', 'viewer');
CREATE TABLE "project_members" (
  "project_id" UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" "ProjectRole" NOT NULL DEFAULT 'member',
  PRIMARY KEY ("project_id", "user_id")
);
CREATE INDEX "project_members_user_id_idx" ON "project_members"("user_id");

-- Chuyển dữ liệu cũ; không tự cấp quyền đọc cho Owner/Admin ngoài dự án.
INSERT INTO project_members (project_id, user_id, role)
SELECT p.id, m.user_id,
  CASE WHEN m.role = 'viewer' THEN 'viewer'::"ProjectRole"
       WHEN m.user_id = p.manager_id THEN 'pm'::"ProjectRole"
       ELSE 'member'::"ProjectRole" END
FROM projects p JOIN memberships m ON m.workspace_id = p.workspace_id
WHERE m.user_id = ANY(p.members) OR m.user_id = p.manager_id;

-- Nếu manager cũ không còn hợp lệ, chọn thành viên có quyền ghi; dừng migration thay vì cấp PM cho Viewer.
DO $$
DECLARE p RECORD; candidate UUID;
BEGIN
  FOR p IN SELECT id FROM projects LOOP
    SELECT user_id INTO candidate FROM project_members
      WHERE project_id = p.id AND role <> 'viewer'
      ORDER BY (role = 'pm') DESC, user_id LIMIT 1;
    IF candidate IS NULL THEN
      RAISE EXCEPTION 'Project % has no eligible PM; assign a non-viewer member before migrating', p.id;
    END IF;
    UPDATE project_members SET role = 'pm' WHERE project_id = p.id AND user_id = candidate;
    UPDATE projects SET manager_id = candidate,
      members = ARRAY(SELECT user_id FROM project_members WHERE project_id = p.id ORDER BY user_id)
      WHERE id = p.id;
  END LOOP;
END $$;

ALTER TABLE tasks ADD COLUMN "remainingHours" DOUBLE PRECISION;
UPDATE tasks SET "remainingHours" = CASE WHEN status = 'done' THEN 0
  WHEN "estimateHours" IS NOT NULL THEN GREATEST(0, "estimateHours" - "spentHours") ELSE NULL END;
ALTER TABLE tasks ADD CONSTRAINT tasks_remaining_hours_nonnegative CHECK ("remainingHours" IS NULL OR "remainingHours" >= 0);
