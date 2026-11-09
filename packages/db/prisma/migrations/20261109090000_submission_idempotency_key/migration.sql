-- Idempotency-Key cho POST /lessons/:lessonId/exercise/submit (gửi lại từ hàng chờ offline của app mobile).
-- Chỉ thêm cột tuỳ chọn và một unique index; không đổi dữ liệu cũ. Postgres coi NULL là khác nhau,
-- nên các lượt nộp không có key vẫn không bị ràng buộc.
ALTER TABLE "Submission" ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "requestHash" TEXT,
ADD COLUMN "response" JSONB;

CREATE UNIQUE INDEX "Submission_userId_idempotencyKey_key" ON "Submission"("userId", "idempotencyKey");
