# Hợp nhất HAnh vào main — 28/10/2026

Nguồn hợp nhất: phần Sprint 1 Hoàng Anh tại `85acb95` và main tại `75dbc18`. Commit `2604620` xử lý các xung đột với main `36b63ba`; lượt hợp nhất tiếp theo giữ cả cập nhật mới `75dbc18` của nhóm.

## Kết quả xử lý xung đột

- Giữ project_members, quyền PM/Member/Viewer, dự án private và ràng buộc không gỡ/hạ quyền PM cuối cùng.
- Dùng chung khóa workspace trước khi sửa project/roster, giao việc hoặc thu hồi membership; kiểm lại quyền trong transaction, bỏ giao có audit và tăng version.
- Member cập nhật trạng thái/thứ tự/giờ còn lại của task được giao; PM duyệt Review → Done và mở lại. PATCH bắt buộc version, dữ liệu cũ trả 409 kèm bản mới.
- API board/My Tasks/detail và giao diện thống nhất quyền; không tạo task trực tiếp trong cột Done. Sửa biến profile của Calendar sau merge.
- Giữ cập nhật main về phiên đăng nhập, ngày giờ theo profile, tài liệu dài/TXT, thông báo/cursor, dữ liệu NUL, nhắc hạn dự án lưu trữ và request giao diện bất đồng bộ.
- Giữ quyền cộng tác bình luận/tải tệp của Member; tải lại quyền giao diện và thu hồi socket sau sửa roster/archive/restore.
- AI không giao task cho Project Viewer; khởi tạo remainingHours từ estimate. Task Done luôn giữ remainingHours bằng 0 khi chỉnh sửa.
- Giữ test của cả hai nhánh; sửa các fixture vốn giả định Owner/Admin được vượt quyền dự án, thêm hồi quy về quyền UI, Project Viewer/AI và task Done.

## Kiểm tra sau khi hợp nhất main mới nhất

| Lệnh | Kết quả |
| --- | --- |
| `npm test` | 172/172 đạt: 16 AIService + 124 backend (gồm migration) + 32 frontend; không skip |
| `npm run test:e2e` | Build đạt; 1/1 luồng trình duyệt đạt; không có pageerror |
| `git diff --check` | Đạt |

Dùng Windows/Microsoft Edge headless, PostgreSQL và uploads tạm. Log: [test](test-evidence/2026-10-28-merge-main-tests.txt), [build và E2E](test-evidence/2026-10-28-merge-main-e2e.txt).

Phạm vi xác nhận là xử lý xung đột và các ca kiểm tra trên. Các probe lỗi đã được nhóm ghi nhận trong [báo cáo Lộc](LOC_SPRINT1_READINESS_2026-10-28.md) không nằm trong test chuẩn và không được tính là đã sửa trong lượt merge này.
