# Lộc — kiểm tra Sprint 1 và khả năng đưa vào main

Ngày kiểm tra: 28/10/2026. Nguồn yêu cầu: file người dùng cung cấp `DN26_CPL_Mock_Project_Nhom24 (1).xlsx`. Đây là bản khác với workbook được dùng trong báo cáo review trước. Không sửa trạng thái trong Excel.

## Kết luận

Đã có phần lớn code nền tảng và kiểm thử cho các story Lộc phụ trách, nhưng **chưa đủ điều kiện xác nhận hoàn thành toàn bộ Sprint 1** theo file mới. Có thể lưu và đẩy bản hiện tại lên nhánh phát triển `Loc` để nhóm review. Chưa đề nghị đưa toàn bộ bản này vào `main` vì vẫn tái hiện lỗi mất nội dung task đang nhập và còn yêu cầu chưa triển khai.

Việc có code và test không chứng minh người nào đã tự thực hiện hay review. Báo cáo đối chiếu sản phẩm với phân công, không quy tác giả theo tên nhánh.

## Phân công và bằng chứng

Sheet `Sprint 1` giao Nguyễn Bảo Lộc phụ trách ba story ở các dòng 7, 10, 12; cả ba vẫn ghi Open. `Detail Plan` tách người thực hiện và reviewer, nên không xem chủ story là người viết tất cả task.

| Hạng mục | Code/bằng chứng hiện có | Phần chưa đủ |
| --- | --- | --- |
| U003 — đăng ký và xác minh email (`Sprint 1!B7:H7`) | `BackEnd/src/routes/auth.js`, schema User/Token; test email lowercase unique, xác minh một lần, vô hiệu token cũ và phiên | `BackEnd/src/services/mailer.js` chỉ lưu outbox và console; chưa có SMTP adapter/gửi email thật theo `Detail Plan!D19`. Task này do Thuận thực hiện, Lộc review. |
| U007 — lời mời và quyền (`Sprint 1!B10:H10`, `Detail Plan!B28:F28`) | Invite create/accept/revoke/resend, hash token, expiresAt/revokedAt, kiểm email nhận, chặn Owner cuối; khóa transaction, bỏ giao task và thu hồi quyền; có test đồng thời và API/socket/file/AI | Các ca đã kiểm đạt; chưa có bằng chứng review chéo/nghiệm thu thật để chuyển story sang Done. |
| U009 — tạo/giao task (`Sprint 1!B12:H12`, `Detail Plan!B34:F34`) | CRUD, acceptanceCriteria, assignee, estimateHours, tenant/project ACL, version và audit cùng transaction trong `BackEnd/src/routes/tasks.js` | Không có trường/API `remaining_hours`/`remainingHours`; `spentHours` là giờ đã làm, không phải giờ còn lại. DELETE dùng `tx.task.deleteMany`, chưa có soft-delete theo kế hoạch. Giao diện còn lỗi realtime ghi đè nội dung chưa lưu. |
| U001-T3 — review SRS/phạm vi (`Detail Plan!B14:F14`) | Có README và báo cáo kỹ thuật | Chưa tìm thấy SRS đã review, bảng truy vết và biên bản duyệt tương ứng trong repo; PDF demo trong seed không thay thế bằng chứng này. |
| U004-T3 — test phiên (`Detail Plan!B24:F24`) | Test token reuse, logout, nhiều phiên, refresh/revoke đồng thời và chống giả IP né rate limit | Có bằng chứng tự động trong log hiện tại; chưa xác nhận review chéo của người được phân công. |
| U008-T3 — test quyền/dự án lưu trữ (`Detail Plan!B33:F33`) | Test Member/Viewer, dự án archived chỉ đọc và kiểm lại quyền sau khi lấy khóa | Có bằng chứng tự động cho các ca đã chạy; không suy ra mọi tiêu chí mới của U008 đều hoàn tất. |

Các nhiệm vụ Lộc làm reviewer trong Sprint 1 còn nằm ở `Detail Plan` dòng 17, 19, 27, 30, 31, 32. Chưa có bằng chứng xác nhận review của người thật cho các dòng này. Chưa kiểm chứng staging/demo và biên bản nghiệm thu Sprint 1 (`Detail Plan` dòng 40, 42).

## Kiểm tra bản chuẩn bị push

Nền Git trước khi đóng gói: `36b63ba` trên cả `origin/main` và `origin/Loc`, sau khi fetch GitHub. Các sửa đổi có sẵn được chuyển từ working tree trên `main` sang `Loc` mà không bỏ thay đổi. Bản đóng gói gồm sửa lỗi backend, xử lý request/lỗi giao diện và test/báo cáo đã có trong working tree; phạm vi có cả tính năng ngoài Sprint 1. Lượt này không thay đổi logic ứng dụng.

| Kiểm tra | Kết quả | Log |
| --- | --- | --- |
| `npm test` | 157/157 đạt: 16 AIService + 111 backend + 30 frontend, không skip | `test-evidence/2026-10-28-sprint1-push-tests.txt` |
| `npm run build` | Đạt | `test-evidence/2026-10-28-sprint1-push-build.txt` |
| `git diff --check` | Đạt trước khi đóng gói | Git local |
| Probe frontend chạy riêng | 1/1 thất bại: realtime đổi `My unsaved edit` về `Original` | `test-evidence/2026-10-28-sprint1-frontend-probes.txt` |
| Probe AI chạy riêng | 2/2 thất bại: câu hủy vẫn sinh action; excerpt không có trong nguồn vẫn được chấp nhận | `test-evidence/2026-10-28-sprint1-ai-probes.txt` |

Hai file `.probe.js` được giữ nguyên là ca tái hiện lỗi, không nằm trong glob test chuẩn. Không cộng chúng vào 157 ca đạt. Hai lỗi AI thuộc tính năng biên bản ở sprint sau, nhưng vẫn tồn tại trong bản code đầy đủ đang chuẩn bị push.

Lần chạy test đầu bị sandbox chặn kết nối localhost (EACCES). Kết quả ở trên là lượt chạy lại thành công ngoài sandbox, dùng PostgreSQL nhúng tạm và AIService nội bộ, không dùng DB dev hoặc provider trả phí. Không chạy browser E2E/staging, SMTP hay provider AI thật trong lượt này.

## Điều kiện đưa vào main

1. Sửa lỗi realtime ghi đè bản nháp task, đưa ca tái hiện vào test chuẩn.
2. Bổ sung `remaining_hours` và soft-delete với migration/API/test phù hợp, hoặc có quyết định thay đổi yêu cầu được nhóm chấp thuận.
3. Hoàn thiện SMTP adapter/mail sandbox và kiểm chứng register/verify/invite khi nghiệm thu U003/U007.
4. Nếu đưa cả code AI hiện tại vào main, xử lý hai lỗi biên bản đã tái hiện; nếu chỉ bàn giao Sprint 1, xác định rõ phần code sẽ tích hợp.
5. Bổ sung bằng chứng SRS, review chéo, staging và demo theo kế hoạch mới.

Khả năng hợp nhất Git và mức hoàn thành yêu cầu là hai kết quả khác nhau. `origin/main` là tổ tiên của bản Loc chuẩn bị push nên không cần giải quyết xung đột tại thời điểm kiểm tra; điều này không có nghĩa bản build đã đủ điều kiện nghiệm thu. Phải fetch lại nếu main thay đổi trước khi tích hợp.
