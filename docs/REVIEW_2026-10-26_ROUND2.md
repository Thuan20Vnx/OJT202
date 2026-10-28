# Rà soát tiếp — 26/10/2026, vòng 2

Tiếp nối [lượt trước](REVIEW_2026-10-26.md). Giữ nguyên các sửa đổi chưa commit của lượt trước; lần này tập trung vào Cài đặt AI, Lời mời, bảo mật tài khoản, tải tệp và phạm vi thông báo.

## Lỗi xác nhận và sửa

| Lỗi | Cách sửa và kiểm chứng |
| --- | --- |
| Cài đặt AI và Lời mời đọc `data.settings` / `data.invites` khi lần tải đầu lỗi, làm trang crash. | Hiển thị lỗi và nút Thử lại. Test API giả lập 503 rồi phục hồi; cả hai trang trở lại bình thường. |
| Bật/tắt tính năng hoặc realtime tải lại Cài đặt AI làm mất hạn mức và timeout đang nhập. | Tách dữ liệu đang sửa khỏi dữ liệu đã lưu; thay đổi toggle/resync không xóa phần chưa lưu. Chỉ làm sạch các trường số sau khi lưu thành công; lỗi giữ lại để thử lại. |
| Xóa trắng hạn mức rồi bấm lưu gửi `Number('') = 0`, vô tình chặn mọi lượt AI. | Kiểm tra ô trống, số nguyên và khoảng hợp lệ trước khi gửi. Hạn mức 0 do người dùng nhập vẫn được chấp nhận. |
| Lỗi nhật ký AI bị hiển thị như danh sách rỗng; lỗi xuất CSV không được xử lý. | Nhật ký có trạng thái tải/lỗi/Thử lại; xuất CSV chờ kết quả, khóa bấm lặp và báo lỗi trên màn hình. |
| Gửi lại/hủy lời mời lỗi thoát ra khỏi handler, không báo kết quả. | Xử lý lỗi, giữ lời mời và cho thử lại; không gửi thao tác trùng khi đang chờ. |
| Đổi mật khẩu thất bại với lỗi server/mạng không hiện gì vì `e.fields` là object rỗng nhưng vẫn truthy. | Phân biệt lỗi từng trường với lỗi chung; lỗi chung hiển thị trong phần đổi mật khẩu. |
| Tải phiên đăng nhập thất bại hiện danh sách trống; thu hồi phiên lỗi không được xử lý. | Có lỗi tải và Thử lại; lỗi thu hồi hiện trong phần bảo mật. Khóa thao tác thu hồi đang chạy. |
| Tải tệp chưa dùng chung xử lý phiên: lỗi mạng trả TypeError, hết phiên thật không phát sự kiện unauthorized. Đọc response JSON bị lỗi/đứt kết nối cũng trả lỗi thô. | Dùng chung bước xác thực/refresh cho API và download, chuẩn hóa lỗi đọc body thành ApiError. Test refresh thành công bảo toàn nội dung tệp; 503 không đăng xuất, 401 thật phát sự kiện hết phiên. |
| `read-all` bỏ qua workspace sai định dạng và đánh dấu toàn bộ tài khoản đã đọc. GET với bộ lọc workspace/project sai cũng bỏ qua bộ lọc. | Validate phạm vi trước truy vấn/cập nhật; dữ liệu sai nhận 400. Test xác nhận thông báo vẫn chưa đọc khi gửi workspace sai, và thao tác hợp lệ chỉ tác động workspace được chọn. Request không chỉ định workspace vẫn giữ hành vi toàn tài khoản. |
| Danh sách phiên trả `updatedAt` dưới tên `lastUsedAt`. | Trả đúng trường `lastUsedAt`; test chủ động đặt hai mốc khác nhau và đối chiếu response. |

Các trang cài đặt được gắn key theo workspace để form và trạng thái thao tác không đi theo khi chuyển workspace.

## Kết quả kiểm tra

- Trước sửa: **9 ca frontend mới thất bại** và **2 ca backend mới thất bại**. Đã sửa fixture kiểm thử Lời mời để cung cấp danh sách projects đúng với AppProvider rồi chạy lại trước khi sửa ứng dụng. Log: [frontend trước sửa](test-evidence/2026-10-26-round2-frontend-before.txt), [backend trước sửa](test-evidence/2026-10-26-round2-backend-before.txt).
- Sau sửa và bổ sung kiểm tra luồng thành công: `npm test` đạt **157/157**, không skip: **16 AIService + 111 backend + 30 frontend**. Lượt này thêm **14 ca**. [Log đầy đủ](test-evidence/2026-10-26-round2-after.txt).
- `npm run build` thành công. [Log build](test-evidence/2026-10-26-round2-build.txt).
- `git diff --check` đạt.

Backend dùng PostgreSQL nhúng và thư mục upload tạm. Test frontend dùng React thực với API được mô phỏng để kiểm soát lỗi, hồi phục và dữ liệu đang nhập. Không thay dependency trong vòng 2; không có migration DB.

## Phạm vi kết luận

Các lỗi và tình huống trên đã được kiểm chứng. Chưa kiểm trực quan trên trình duyệt, tải lớn, SMTP/OAuth thật hoặc provider AI bên ngoài trong lượt này. Không diễn giải test đạt thành bảo đảm toàn ứng dụng hết lỗi.

Frontend đã được build; backend đang chạy cần khởi động lại để nạp thay đổi. Chưa commit hoặc push; không sửa dữ liệu phát triển của người dùng.
