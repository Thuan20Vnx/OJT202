-- Ngắt kết nối runner từ web: runner gửi mã phiên mỗi lần hỏi việc, phiên bị ngắt thì tự dừng.
ALTER TABLE "agent_tokens" ADD COLUMN "runner_session" VARCHAR(64);
ALTER TABLE "agent_tokens" ADD COLUMN "runner_stop" VARCHAR(64);
