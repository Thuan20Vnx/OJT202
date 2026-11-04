# Bốn mốc ngày của công việc

Ngày cập nhật: 30/10/2026. Áp dụng cho task và subtask, form tạo và chi tiết, API, CSV tổng quan và nguồn Q&A.

| Trường hiển thị | Trường API/DB | Quyền sửa |
| --- | --- | --- |
| Ngày bắt đầu kế hoạch | plannedStartDate | PM |
| Ngày kết thúc kế hoạch | dueDate | PM |
| Ngày bắt đầu thực tế | actualStartDate | PM hoặc người được giao task chưa Done |
| Ngày kết thúc thực tế | actualEndDate | PM hoặc người được giao task chưa Done |

Không thêm trường plannedEndDate trùng lặp: dueDate tiếp tục là kết thúc kế hoạch để lịch, nhắc hạn, overdue và rủi ro dùng cùng một dữ liệu. Không bắt buộc có đủ ngày ngay khi tạo; ngày chưa xác định để trống.

Khi chuyển sang In progress, ghi actualStartDate nếu chưa có và request không cung cấp trường này. Khi PM duyệt Done, ghi actualEndDate nếu chưa có, giữ ngày thực tế đã được nhập trước. completedAt vẫn là thời điểm PM duyệt để lịch sử/số liệu báo cáo giữ nghĩa cũ. Mở lại Done xóa actualEndDate tự động, giữ actualStartDate; hoàn thành lại sẽ có ngày kết thúc mới. Nhập hoặc sửa actualEndDate không tự duyệt Done.

Backend kiểm ngày hợp lệ, khoảng kế hoạch và khoảng thực tế riêng; kết thúc không trước bắt đầu nếu cả hai đã biết. Chặn ngày thực tế sau ngày hiện tại theo timezone hồ sơ; cho phép kế hoạch tương lai và ngày thực tế sớm/trễ kế hoạch. Ngày chỉ nhập YYYY-MM-DD: bắt đầu là đầu ngày, kết thúc là hết ngày theo timezone người nhập. Timestamp có timezone được giữ nguyên. Không so sánh plan với actual như một ràng buộc vì thực tế có thể sớm hoặc trễ kế hoạch.

PATCH tiếp tục bắt buộc version và kiểm quyền trong transaction; giữ nội dung form nếu lỗi/409. Viewer, người không được giao và dự án archived không được sửa ngày thực tế. Các thay đổi ngày được ghi activity; database có CHECK thứ tự hai khoảng để bảo vệ cả ghi trực tiếp.

Migration `20261030090000_task_timeline` chỉ thêm ba cột, giữ dueDate cũ. Task Done cũ có completedAt được dùng làm mốc kết thúc đã ghi nhận ban đầu; PM có thể hiệu chỉnh nếu ngày thực tế khác ngày duyệt. Không đoán ngày bắt đầu lịch sử. Migration không xóa hoặc reset dữ liệu.

Kiểm chứng:

- `BackEnd/test/task-dates.test.js`: timezone/giữ timestamp, cập nhật một đầu khoảng, actual tương lai, ghi lần đầu/Done/reopen.
- `BackEnd/test/api.test.js`, nhóm “Bốn mốc ngày công việc”: create/read/update, quyền PM/assignee, 409, audit/CSV, ngày sai và tự ghi khi Kanban/Done/reopen.
- `BackEnd/test/migration.test.js`: nâng schema cũ, giữ dueDate và chỉ backfill actualEndDate từ completedAt khi task Done.
- `FrontEnd/test/nhu-sprint1.test.js`: đủ bốn ô, payload PM và payload Member không gửi ngày kế hoạch.
- Browser E2E “Bốn ngày task”: tạo đủ ngày, mở chi tiết, sửa/lưu/reload và kiểm giá trị còn nguyên.

Log chạy tại `docs/test-evidence/2026-10-30-task-dates-{backend,frontend,e2e}.txt`. Tài liệu API/ERD và source hashes tái sinh bằng `node scripts/generate-contract-docs.mjs`.

Kết quả: backend **137/137**, frontend **54/54**, Edge E2E **6/6** đạt; không skip. Build và typecheck đạt; ESLint 0 lỗi, 4 cảnh báo unused directive cũ. Migration được kiểm cả trên DB tạm mô phỏng schema cũ và đã áp dụng khi khởi động backend local. Frontend/API local phản hồi bình thường. [Ảnh giao diện 4 ngày](screenshots/2026-10-30-task-four-dates.png).
