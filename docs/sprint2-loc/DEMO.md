# Demo local Sprint 2 của Lộc

Chạy tại thư mục repo theo [hướng dẫn bàn giao](REVIEW.md#chạy-và-nâng-dữ-liệu-local). Dùng DB demo riêng hoặc dự án thử nghiệm. Các thao tác dưới đây thay đổi dữ liệu của tài khoản/dự án được chọn.

1. **U005 — reset và profile:** tạo tài khoản thử, xác minh email qua `/dev/outbox` ở chế độ local. Đăng nhập bằng hai trình duyệt; mở Quên mật khẩu và đặt lại từ link email. Cả hai phiên cũ phải yêu cầu đăng nhập lại, link cũ không dùng lần hai. Đăng nhập với mật khẩu mới; sửa tên/chức danh/múi giờ/ngôn ngữ ở hồ sơ. Quyền workspace/project không đổi khi sửa hồ sơ.
2. **U011 — tìm mô tả:** PM tạo task có mô tả chứa `nghiemthuloc`, tên không chứa từ đó; giao cho tài khoản đang dùng. Vào My Tasks, tìm `nghiemthuloc`, kết hợp trạng thái/ưu tiên/ngày. Task khớp phải hiện. Người ngoài dự án không thấy task qua tìm kiếm; xóa mềm task thì task biến mất khỏi kết quả.
3. **U013 — checklist và subtask:** trong chi tiết task, PM thêm hai mục checklist và một task con. Đánh dấu một mục rồi tải lại: nội dung và dấu chọn còn nguyên, tiến độ checklist đổi nhưng task cha không tự Done. Dùng Member/Viewer để kiểm chỉ xem checklist, không sửa nội dung. Mở hai tab cùng task và thử gửi phiên bản cũ: API trả 409 để tải lại, không ghi đè.
4. **U014 — bình luận:** Member bình luận và sửa của mình. Member khác không có quyền sửa/xóa bình luận này. PM có nút **Ẩn bình luận vi phạm** nhưng không có quyền sửa thay tác giả. Sau khi ẩn và tải lại, bình luận không còn trong thread; activity có tác giả hành động và ID bình luận. Mention chỉ chọn người trong dự án; HTML không được thực thi.
5. **U019 — workload:** xem dataset kiểm thử trong `BackEnd/test/api.test.js`, suite **Lộc Sprint 2**, ca **U019-T3**. Expected: task cha 100 giờ không cộng vì có task con còn 3 giờ; task quá hạn còn 2 giờ được cộng; Done/xóa/ngoài tuần không cộng. Tổng 5 giờ với capacity 0 phải thể hiện quá tải và tỷ lệ không xác định, không ghi 0% giả. Thiếu deadline và estimate có số lượng riêng; remainingHours bằng 0 vẫn là 0.
6. **Review U016/U018:** job nhắc hạn chạy lại không tạo bản sao; đổi hạn tạo nhắc theo hạn mới; Done/người rời nhóm không nhận. Calendar và dependency dùng triển khai của nhóm: cấm self-link, khác project và chu trình; Blocked là cờ, không có trạng thái thứ năm.

Kiểm tra bổ sung sau đợt rà soát ngày 03/11/2026:

1. **Lỗi tải bình luận:** mở task có một dependency, nhập draft bình luận. Trong DevTools bật Request blocking cho URL `/api/v1/tasks/<id>/comments`, rồi gỡ dependency để task tải lại. Phải thấy lỗi ngay vùng bình luận; draft và phần task vẫn còn. Tắt block, nhập một draft tên task rồi bấm **Thử lại** tại lỗi comments: cả hai draft phải được giữ. Nếu muốn kiểm HTTP 503 giống bằng chứng, chạy E2E vì Request blocking chỉ mô phỏng lỗi kết nối.
2. **Xóa/ẩn khi mạng chậm:** chọn chế độ Slow 3G, bấm Xóa hoặc Ẩn liên tiếp. Network chỉ có một DELETE cho cùng ID khi request còn chờ; nút disabled. Khi request lỗi, bình luận vẫn còn và cho thử lại.
3. **Sửa rồi chuyển editor:** trên hai bình luận của mình, lưu A khi mạng chậm, bấm Hủy và sửa B. Khi A hoàn tất, draft B còn nguyên. Thử thêm hủy rồi mở lại chính A: bản nháp mới cũng được giữ.
4. **Giờ còn lại:** Member được giao việc lưu giá trị ở A trong lúc mạng chậm; chuyển sang B và lưu tiếp. Phản hồi A không mở khóa nút B. Kiểm riêng `0` là đã hết giờ còn lại, ô trống là chưa ước lượng.
5. **Thu hồi quyền:** dùng tài khoản PM khác gỡ người đang mở task khỏi dự án. Người bị gỡ không tiếp tục thấy composer hoặc nội dung riêng tư; phản hồi đang chờ không phục hồi dữ liệu cũ.

Các bước này là hướng dẫn reviewer thao tác lại, không phải xác nhận đã có người nghiệm thu thủ công. Tắt Request blocking/throttling sau kiểm tra. Chi tiết lỗi và log trong [báo cáo rà soát](REVIEW_2026-11-03.md).

Chạy toàn bộ bằng chứng tự động:

```powershell
npm --prefix FrontEnd run lint
npm test
npm run test:e2e
```

E2E dùng Edge headless trên Windows, tự build và tạo PostgreSQL tạm; không cần dev server đang chạy. Các ảnh được ghi tại `.data/e2e/`. Test SMTP nhận thư bằng sandbox local. Người review ghi commit, môi trường, kết quả thực tế và issue nếu có; tài liệu này không thay xác nhận nghiệm thu của Thuận/Hiệp hoặc staging.
