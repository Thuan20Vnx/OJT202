# Rà soát vòng 2 — 25/10/2026

Kiểm tra trên nền commit `6377444`, sau đợt sửa đầu tiên. Đợt này tập trung vào lỗi tải dữ liệu, phân trang thông báo, tùy chọn sự kiện và tệp TXT không hợp lệ. Báo cáo đi kèm commit sửa lỗi vòng 2; thứ tự cập nhật nhánh là `Loc` trước, sau đó `main`.

## Các lỗi đã xác nhận và sửa

| Mức ảnh hưởng | Lỗi trước sửa | Kết quả sau sửa |
| --- | --- | --- |
| P2 — hỏng màn hình | Nhật ký truy cập `data.items` khi lần tải đầu thất bại và `data` là null. | Hiển thị lỗi API và nút Thử lại; tải lại thành công hiển thị bảng. |
| P2 — xuất dữ liệu thất bại không được báo | Cửa sổ CSV đóng ngay khi bắt đầu download; promise bị từ chối không được xử lý. | Chờ download thành công mới đóng, báo lỗi trong cửa sổ, giữ lựa chọn để thử lại; khóa thao tác lặp khi đang xuất. Mở lại lấy khoảng ngày từ bộ lọc hiện tại. |
| P2 — không xem được lịch sử đầy đủ | Giao diện lấy tối đa 50 thông báo nhưng luôn báo đã xem hết. Phân trang chỉ bằng thời gian bỏ sót các mục cùng thời điểm. | Có nút Tải thêm, cursor kết hợp thời gian và ID, thứ tự ổn định. Kiểm tra quyền hiện tại trên mọi trang, chặn cursor/ngày sai bằng 400. Không ghép kết quả tải thêm cũ vào danh sách vừa đổi bộ lọc hoặc tải lại. |
| P2 — dữ liệu đầu vào gây 500 | TXT chỉ kiểm tra NUL trong 512 byte đầu; NUL ở phía sau lọt tới PostgreSQL và làm upload lỗi 500. | Quét toàn bộ tệp trước khi lưu, trả 400. Ca kiểm thử lô gồm một tệp hợp lệ và một tệp lỗi xác nhận không tạo document hay để lại tệp lưu dở. |
| P2 — bỏ qua tùy chọn người dùng | Tắt nhắc hạn vẫn tạo thông báo quá hạn vì không có cột tùy chọn `overdue`. | Cả `due_soon` và `overdue` dùng chung tùy chọn nhắc hạn, đúng mô tả trên giao diện. Bật lại vẫn gửi được. |
| P3 — mặc định không nhất quán | Người chưa có bản ghi cài đặt vẫn nhận thông báo bình luận dù mặc định trong schema là tắt. | Áp dụng mặc định ngay cả trước khi mở trang cài đặt; các thông báo giao việc vẫn hoạt động. |

Các sửa liên quan: tab Chưa đọc loại mục vừa đọc, tránh gửi lặp thao tác đánh dấu cùng thông báo; lỗi thao tác thông báo được báo bằng toast; đặt lại bộ lọc nhật ký quay về trang 1; không xuất khoảng ngày đảo ngược.

## Bằng chứng kiểm thử

- Trước sửa: 5 ca hồi quy mới thất bại đúng các kỳ vọng chức năng. Log: `test-evidence/2026-10-25-round2-before.txt`.
- Sau sửa: `npm test` thành công, **130/130**: AIService 16, BackEnd 107, FrontEnd 7. Không skip. Log: `test-evidence/2026-10-25-round2-after.txt`.
- Phân trang API: 61 thông báo cùng millisecond, trang đầu 50, trang sau 11; không trùng ID, không mất mục. Thu hồi quyền dự án rồi gọi lại cursor trả danh sách rỗng.
- `npm run build` thành công, 124 modules. Log: `test-evidence/2026-10-25-round2-build.txt`.
- `git diff --check` thành công.

## Kiểm tra giao diện thực tế

Dùng `node scripts/review-smoke.mjs --edge-cases`, PostgreSQL nhúng và thư mục upload tạm riêng, không dùng DB phát triển hay production. Cờ này tạo 61 thông báo và giả lập một lỗi HTTP 503 cho mỗi endpoint Nhật ký và CSV.

1. Trang Thông báo ban đầu hiển thị 50 mục và nút tải thêm; tải thêm hiển thị đủ 61 mục và mới báo đã xem hết.
2. Trong tab Chưa đọc, đọc một mục giảm tổng 61 xuống 60 và loại đúng mục đó; tải tiếp đủ 60 mục. Quay lại Tất cả vẫn xem đủ 61.
3. Nhật ký gặp 503 hiển thị thông báo lỗi với nút Thử lại, không rơi vào màn hình lỗi ứng dụng. Bấm Thử lại hiển thị 8 bản ghi.
4. CSV gặp 503 giữ nguyên cửa sổ, khoảng ngày và các cột, hiển thị “Không tải được tệp”. Thử lại tải được CSV có header và nội dung tiếng Việt; cửa sổ đóng sau thành công.

Ảnh kiểm chứng:

- `screenshots/2026-10-25-round2-activity-error.png`
- `screenshots/2026-10-25-round2-csv-error.png`
- `screenshots/2026-10-25-round2-activity-recovered.png`

## Phạm vi kết luận

Các ca hồi quy và luồng giao diện nêu trên đã qua. Đây không phải cam kết toàn bộ dự án không còn lỗi. Đợt này chưa kiểm thử tải lớn, đa trình duyệt, hệ thống email/OAuth bên ngoài hoặc cấu hình triển khai production.
