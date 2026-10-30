# Bàn giao code Sprint 1 của Lộc — 29/10/2026

Phạm vi: U003, U007, U009 theo workbook `DN26_CPL_Mock_Project_Nhom24 (1).xlsx`, Sprint 1 dòng 7/10/12 và Detail Plan dòng 19/28/34. Workbook dùng để đối chiếu yêu cầu, không phải lệnh tự sửa trạng thái nghiệm thu. Không chỉnh file Excel.

Nền tích hợp: `da5fc0a` của main, đã bao gồm phần phân quyền dự án và remainingHours của Hoàng Anh. Giữ lịch sử đóng góp; lượt này hoàn thiện phần còn thiếu và kiểm thử tích hợp trên nhánh Loc. Báo cáo này cập nhật trạng thái code U003/U007/U009 so với báo cáo ngày 28/10, không thay thế xác nhận của reviewer/mentor.

## Kết quả theo yêu cầu

| Mục | Kết quả triển khai và kiểm chứng |
| --- | --- |
| U003 đăng ký/xác minh | SMTP adapter bằng Nodemailer, mặc định Gmail 465/TLS; cấu hình qua biến môi trường. Có outbox tách biệt cho dev, production không chấp nhận outbox hoặc SMTP không TLS. Đăng ký/verify/resend được chạy với máy chủ SMTP thử nghiệm thực tế qua TCP; kiểm thử từ chối người nhận, sai auth và yêu cầu STARTTLS không được hỗ trợ. |
| U003 xử lý lỗi | Không báo email đã gửi khi SMTP đăng ký lỗi. Tài khoản giữ trạng thái chờ, UI cho gửi lại. Recovery API giữ thông báo chung dù SMTP lỗi để tránh tiết lộ tài khoản. Phản hồi 401 cũ từ request ẩn danh không xóa phiên vừa xác minh/đăng nhập. |
| U007 mời/phân quyền | Kiểm chứng create/accept/resend/revoke; token cũ sau resend không dùng được, sai email và token đã dùng bị chặn. Test quyền Owner/Admin/PM/Member/Viewer, giữ Owner cuối, thu hồi quyền API/socket/tệp/nguồn AI và bỏ gán công việc tiếp tục đạt trên nền main mới. Browser dùng hai tài khoản thực trong DB test để nhận lời mời, làm task và duyệt kết quả. |
| U009 giờ còn lại | Giữ migration/API/UI remainingHours đã có trên main; kiểm chứng 0, null, số thập phân, giới hạn và quyền cập nhật. Workload ưu tiên remainingHours khi có; chỉ suy ra estimate trừ spent khi trường này trống. |
| U009 xóa mềm | Migration mới thêm deleted_at và index. Xóa cha/con, gỡ phụ thuộc, tách tệp về thư viện dự án, tăng version và ghi audit cùng transaction. Task/bình luận vẫn tồn tại trong DB. Task đã xóa bị 404 khi truy cập/sửa, không còn trong board/calendar/my tasks/search/thống kê/workload/nguồn task và comment của AI/nhắc hạn/thông báo. Tệp giữ ở thư viện dự án theo hành vi trước đó, vẫn chịu ACL của dự án. |
| U009 realtime | Giữ draft và version ban đầu khi request nền trả chậm hoặc sai thứ tự. Save gặp 409 không tự tải đè draft. Hủy/Tải lại là thao tác chủ động; nội dung gõ thêm trong khi tải vẫn được giữ. Probe lỗi trước đây đã chuyển thành regression test chuẩn. |

## Bằng chứng chạy

| Lệnh | Kết quả | Bằng chứng |
| --- | --- | --- |
| `npm test` | 16 AIService + 129 backend + 35 frontend, tất cả đạt | [Log tổng](test-evidence/2026-10-29-loc-tests.txt) |
| `npm --prefix FrontEnd test` sau sửa race 401 | 36/36 đạt, gồm regression 401 mới | [Log frontend cuối](test-evidence/2026-10-29-loc-frontend.txt) |
| `npm run test:e2e` | Build production đạt; browser 2/2 đạt | [Log browser/build](test-evidence/2026-10-29-loc-e2e.txt) |

Tổng số ca chuẩn ở bản cuối: **181 = 16 + 129 + 36**, cộng **2 browser E2E**. Không cộng hai lượt frontend thành số test khác nhau. Không skip. Log có lỗi SMTP 503 chủ động tạo trong các ca kiểm tra lỗi; kết quả cuối là fail 0.

Backend dùng PostgreSQL nhúng tạm, migration từ DB cũ được kiểm tra với dữ liệu giữ nguyên. Có kiểm thử rollback toàn bộ xóa mềm nếu audit lỗi, cạnh tranh update/delete không làm sống lại task, và thu hồi truy cập. Browser dùng Edge headless, HTTP server/SMTP server cục bộ, dữ liệu/tệp test riêng, không truy cập DB triển khai hay gửi thư ngoài máy.

## Triển khai và giới hạn xác nhận

1. Cài dependency theo lockfile, generate Prisma và áp dụng migration mới trước khi chạy bản backend mới. Backend hiện tự chạy `prisma migrate deploy` khi khởi động. Trên Windows, dừng backend trước khi generate nếu Prisma engine đang bị khóa.
2. Cấu hình Gmail theo [README](../README.md). Người dùng đã chọn tự cấu hình Gmail sau. Chưa dùng credential Gmail, chưa gửi email Gmail thật và chưa xác nhận khả năng vào inbox/thư rác của provider.
3. Chưa chạy staging, chưa có xác nhận review chéo/SRS/demo/nghiệm thu của người thật. Không ghi toàn bộ Sprint 1 là đã nghiệm thu chỉ từ kết quả test code.
4. Hai lỗi probe biên bản AI trong báo cáo 28/10 thuộc sprint sau không được sửa trong phạm vi này; không tuyên bố toàn bộ sản phẩm không còn lỗi. Audit dependency backend còn ba cảnh báo mức high có sẵn ở body-parser/multer/zod, không phải dependency SMTP mới; xử lý nâng cấp là công việc riêng.

## Nội dung Daily Scrum đề xuất

**Đã làm:** Hoàn thiện code U003/U007/U009: tích hợp SMTP hỗ trợ Gmail; kiểm thử đăng ký/xác minh và mời/phân quyền; hoàn thiện giờ còn lại, xóa mềm và audit; sửa realtime/409 làm mất bản nháp. Kiểm thử 181 ca chuẩn và 2 luồng browser đều đạt.

**Tiếp theo:** Cấu hình Gmail App Password tại môi trường triển khai, kiểm tra nhận thư thật và phối hợp review/demo nghiệm thu.

**Vướng mắc:** Chưa cấu hình Gmail thật theo lựa chọn của người dùng; còn bước xác nhận nghiệm thu của nhóm.
