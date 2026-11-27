# Thử TaskFlow với nhóm sinh viên và giảng viên

Thời lượng khoảng 15 phút. Mời một sinh viên đóng vai PM, một sinh viên nhận việc và một giảng viên theo dõi. Người quan sát ghi thời gian, chỗ phải gợi ý và kết quả thực tế của từng bước.

Chạy phiên demo có cơ sở dữ liệu riêng bằng `npm run demo:sprint4` và mở URL được in trong terminal. Dùng hồ sơ trình duyệt riêng cho Mai Anh, Như và Khánh Linh. Xem tài khoản, cách dừng và thời hạn phiên ở [runbook demo](SPRINT4_RUNBOOK.md#u035-demo-1012-phút-và-reset). Chọn workspace **Sprint 4 - isolated validation**, vào **Cài đặt Workspace → Thành viên** và đặt Khánh Linh làm **Giảng viên** nếu tài khoản đang là Viewer.

| Bước | Người thử và việc cần làm | Kết quả mong đợi |
| --- | --- | --- |
| 1 | PM tạo một dự án thử, thêm Như. Vào **Tiến độ & lịch → Sprint & Backlog**, tạo và bắt đầu Sprint có ngày bắt đầu, ngày kết thúc. Tạo một việc giao Như với ước lượng 5 giờ. | Sprint hiện **Đang chạy**. Công việc mới có tên Như và nằm trong Sprint. |
| 2 | Như mở việc, vào **Tiến độ & cộng tác → Nhật ký hằng ngày**. Ghi 2 giờ đã làm, 3 giờ còn lại, tiến độ 40% và mô tả ngắn rồi lưu. | Tải lại vẫn thấy nhật ký và 2 giờ đã ghi. |
| 3 | Giảng viên vào **Các nhóm hướng dẫn → Đóng góp** của dự án thử. Chọn Sprint và xuất CSV. | Bảng và CSV ghi 2 giờ cho Như, tính đúng một công việc. Giảng viên xem được công việc và có thể bình luận. |
| 4 | Giảng viên chọn dự án khác từ thanh bên khi vẫn ở **Đóng góp**. | Trang giữ nguyên, hiển thị tên dự án mới và bộ lọc trở về **Toàn dự án**. |
| 5 | PM mở **Báo cáo**, chọn kỳ có ngày làm việc, tạo bản nháp và chọn **Xuất tệp**. Thử thêm **In / Lưu PDF**. | Mở được tệp văn bản tải về. Bản xem trước khi in hiển thị đúng báo cáo và tên dự án. |

Mỗi người thực hiện trước khi được hướng dẫn. Nếu gặp lỗi, ghi bước và thao tác vừa làm, thông báo trên màn hình, thời gian bị vướng, và ảnh chụp nếu cần. Dùng bảng dưới để ghi kết quả thực tế.

| Bước | Vai trò | Thời gian | Kết quả | Chỗ bị vướng hoặc cần gợi ý |
| --- | --- | --- | --- | --- |
| | | | Đạt / Không đạt | |

Cuối buổi, hỏi mỗi người điều gì mất nhiều công nhất và màn hình nào khiến họ không biết bước tiếp theo. Ghi ngày thử và phiên bản TaskFlow vào biên bản để nhóm có thể chạy lại sau khi sửa.
