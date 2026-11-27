-- Xóa workspace hẹn giờ: Owner yêu cầu, workspace chỉ đọc 24 giờ rồi job xóa hẳn.
ALTER TABLE "workspaces" ADD COLUMN "deletion_scheduled_at" TIMESTAMP(3);
ALTER TABLE "workspaces" ADD COLUMN "deletion_requested_by" UUID;

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'workspace';
