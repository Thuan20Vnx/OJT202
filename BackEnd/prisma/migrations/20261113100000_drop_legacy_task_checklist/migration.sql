-- 20261110100000_task_checklist_json thêm lại tasks.checklist (JSONB) dù Sprint 2 đã chuyển checklist sang
-- bảng checklist_items và xóa cột này. schema.prisma không có cột, ứng dụng không đọc/ghi, nên DB lệch schema.
-- Giữ dữ liệu trước khi xóa: chỉ chuyển checklist JSON của task CHƯA có dòng checklist_items (tránh nhân bản),
-- cùng quy ước Sprint 2 (text -> title, done -> is_done, thứ tự giữ nguyên). Chạy lại an toàn khi cột đã mất.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'tasks' AND column_name = 'checklist'
  ) THEN
    INSERT INTO checklist_items (task_id, title, is_done, position)
    SELECT t.id, LEFT(item.value->>'text', 300), COALESCE((item.value->>'done')::boolean, false), (item.ordinality - 1)::integer
    FROM tasks t
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t.checklist) = 'array' THEN t.checklist ELSE '[]'::jsonb END)
      WITH ORDINALITY AS item(value, ordinality)
    WHERE NOT EXISTS (SELECT 1 FROM checklist_items c WHERE c.task_id = t.id)
      AND COALESCE(btrim(item.value->>'text'), '') <> '';
    ALTER TABLE tasks DROP COLUMN checklist;
  END IF;
END $$;
