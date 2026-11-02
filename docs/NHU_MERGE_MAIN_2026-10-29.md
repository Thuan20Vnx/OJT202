# Đồng bộ Nhu với main — 29/10/2026

Nhánh nguồn của Như trước hợp nhất: `78d6186`. Main đã fetch từ GitHub: `8aa32ab` (SMTP, xóa mềm và realtime draft của Lộc). Hợp nhất main vào Nhu bằng merge commit để giữ lịch sử; không merge trực tiếp vào main.

## Xung đột đã xử lý

- `FrontEnd/src/components/TaskDetailModal.jsx`: thống nhất ref task hiện tại, mounted, sequence và revision của bản nháp. Giữ cơ chế mới từ main để bỏ phản hồi cũ, vô hiệu request tải trước khi lưu và không xóa cờ dirty nếu người dùng nhập thêm trong lúc lưu. Giữ phần Như: nhãn truy cập, chặn hiển thị nhầm task, nút đóng/thử lại và xóa dữ liệu khỏi view khi mất quyền.
- `test/e2e/sprint1.test.mjs`: giữ cả test SMTP/xóa mềm/giờ còn lại của main, test SMTP bị từ chối và test Kanban bàn phím/rollback/hai tab/logout của Như. Không chọn bỏ một phía để giải quyết conflict.
- `BackEnd/src/db.js` tự hợp nhất: giữ khởi động PostgreSQL Windows qua pg_ctl của Như và lọc task xóa mềm trong tiện ích populate của main.

Các thay đổi mailer, auth, project/task ACL, migration xóa mềm và API từ main được giữ lại. Kanban bàn phím, khóa gửi lặp, form task, TypeScript entry, lint/typecheck/CI của Như cũng được giữ lại.

## Kiểm tra bản hợp nhất

| Kiểm tra | Kết quả |
| --- | --- |
| Frontend lint | Không có lỗi; 4 cảnh báo eslint-disable cũ không sử dụng |
| TypeScript | `npm --prefix FrontEnd run typecheck` đạt |
| Toàn bộ unit/integration | **187/187**: AIService 16, backend 129, frontend 42; không skip |
| Production build và Edge E2E | **3/3**: SMTP/workflow/xóa mềm, Kanban của Như và SMTP lỗi/gửi lại |
| Xung đột Git | Không còn unmerged entries hoặc conflict marker |
| Whitespace | `git diff --cached --check` đạt sau chuẩn hóa khoảng trắng cuối dòng của log |

Log: `test-evidence/2026-10-29-nhu-merge-tests.txt`, `test-evidence/2026-10-29-nhu-merge-e2e.txt`. Lỗi SMTP/audit in trong log là lỗi được chủ động tạo trong test để kiểm tra phục hồi/rollback; kết quả tổng fail 0.

Test dùng PostgreSQL và SMTP cục bộ tạm, không kết nối DB triển khai hoặc gửi email ra ngoài. Không tự cập nhật trạng thái nghiệm thu trong Excel. CI trên GitHub cần xem trạng thái sau push; kết quả local không phải kết quả CI.
