# Demo local Sprint 3 của Lộc

Dùng môi trường demo riêng với dữ liệu seed; không dùng tài khoản người thật để thử khóa. Mật khẩu demo lấy từ README/seed hiện có. `npm run dev` mở frontend, API và AIService; không đặt khóa provider thật nếu chỉ kiểm quy tắc local.

## U022 — báo cáo và nguồn

1. Đăng nhập PM, tạo project và task A/B/C: A ở Done có thời điểm hoàn thành trong kỳ, B Review, C quá hạn. Thêm task con của A để thấy không cộng task cha/con hai lần.
2. Vào Trợ lý AI → Báo cáo tiến độ, chọn kỳ có A và tạo nháp. Expected: completed trong kỳ chỉ có A, Review không bị ghi thành Done; overdue hiện trạng gồm C nếu chưa Done.
3. Bấm mã task dưới phần Tóm tắt/Đã hoàn thành. Expected: mở đúng task và vẫn kiểm quyền. Ảnh test: [mở nguồn](evidence/loc-sprint3-report-source.png).
4. Chia sẻ báo cáo, mở lại A bằng workflow PM với remaining mới. Expected: report cũ giữ số liệu và generatedAt, cảnh báo nguồn thay đổi; report mới phản ánh hiện trạng.
5. Gỡ Member khỏi project rồi dùng phiên Member mở report/task trực tiếp. Expected: 404; không trả nội dung nhóm cũ.
6. Tạo hai việc chưa hoàn thành và đặt B phụ thuộc A. Trong báo cáo mới, mở lần lượt hai liên kết ở mục **Đang bị chặn** để đối chiếu việc B với nguyên nhân A. Bộ test API có thêm dữ liệu lịch sử chứa liên kết sai dự án.

## U026 — biên rủi ro

1. Tạo việc chưa Done quá hạn; dùng ngưỡng 0 và 1 ngày. Expected: đúng deadline chưa quá hạn; dưới một ngày không vượt ngưỡng một ngày.
2. Tạo dependency tới task quá hạn. Expected: cảnh báo chỉ rõ task bị chặn và blocker; khi blocker Done thì chain-risk biến mất.
3. Đặt capacity 0 và task lá còn 2 giờ có hạn trong tuần. Expected: cảnh báo quá tải; không hiện tỷ lệ 0% giả. Task không hạn/thiếu estimate được đếm riêng trên workload.
4. Xử lý cảnh báo với lý do. Expected: cùng sourceVersion giữ resolved; thay remaining/deadline/ngưỡng liên quan tạo cảnh báo mới. Không cần tạo báo cáo AI trước.
5. Đặt sức chứa 10 giờ, ngưỡng 80% và tạo hai việc lá đến hạn trong tuần còn lần lượt 9 giờ và 0 giờ. Mở cảnh báo để xem giải thích ngưỡng và kiểm tra liên kết đến việc còn 9 giờ.
6. Phân bổ task A cho Như (còn 0 giờ) và một người khác (còn 10 giờ); task B cho Như (còn 5 giờ), capacity Như 1 giờ. Expected: cảnh báo của Như là 5 giờ và chỉ liên kết B. Không lấy phần việc của người khác làm nguyên nhân quá tải của Như.
7. Đăng nhập Viewer: vẫn đọc được cảnh báo/nguồn, không có nút Diễn giải bằng AI hoặc Giao lại; gọi trực tiếp endpoint diễn giải nhận 403, không tăng usage. Project archived cũng không gọi AI được. Test có điều khiển kiểm thêm Member bị hạ quyền hoặc project archive khi response AI đang chờ: nhận 403 và không trả output.

## U027 — biên bản, sửa nháp, duyệt

1. PM mở Ghi chú họp, dán các dòng với tên đúng như danh sách thành viên:

```text
Như: mình sẽ viết tài liệu ngày 15/11/2026.
Cần ai đó kiểm thử API.
Lộc: viết API ngày 15/11/2026 hoặc 16/11/2026.
Lộc: không cần triển khai thanh toán, hủy công việc này.
```

2. Expected: mục thiếu người không tự gán; nhiều ngày để trống hạn; câu hủy không thành action; từng item có trích đoạn nguồn.
3. Chỉnh tên, người nhận, hạn rõ ràng; bỏ chọn mục không muốn tạo. Lưu sửa trước duyệt. Expected: PATCH có version, nguồn gốc không bị sửa theo title mới.
4. Mở hai tab cùng nháp. Tab A lưu sửa, tab B gửi phiên bản cũ: 409 và giữ nội dung đang nhập cho người dùng xử lý. Duyệt sau khi tải bản đúng, thử duyệt lại: không thêm task trùng; task có `ai_meeting` và trích nguồn.
5. Backend test đối chiếu sourceHash/sourceSpan, kể cả emoji và nguồn dài hơn 15.000 ký tự; không cần hiển thị offset kỹ thuật trong luồng người dùng.
6. Với thành viên Lộc và Như trong dự án, trích dòng “Lộc: gửi báo cáo cho Như”. Kiểm tra người phụ trách là Lộc. Đổi thành “Nhờ Như gửi báo cáo cho Lộc”. Giao diện nhắc trích lại. Sau khi trích lại, kiểm tra người phụ trách là Như rồi duyệt bản mới.

## U028 — quản trị và thu hồi

1. Mở hai trình duyệt/context, đăng nhập System Admin và Member demo. Member vào project để nhận realtime.
2. Admin tìm email, chọn Khóa, nhập lý do. Expected: danh sách đổi trạng thái; Member API trả 401, socket ngắt. [Ảnh khóa tài khoản](evidence/loc-sprint3-admin-lock.png).
3. Admin mở khóa. Expected: session cũ vẫn 401; Member đăng nhập lại mới sử dụng được; workspace/project role được giữ.
4. Kiểm nhật ký: action, target, actor, reason và thời điểm. System Admin không có project membership mở project riêng phải bị từ chối.
5. Mô phỏng lỗi tải users trong E2E: UI có lỗi và nút Thử lại. Mô phỏng lỗi gửi khóa: giữ lý do và cho thử lại, không báo thành công.
6. Ca HTTP có điều khiển trong suite backend giữ response AI, gọi lock/logout rồi mới nhả AI. Expected: 401, không tạo draft/report/conversation, không trả văn bản nguồn cũ, socket đã ngắt. Đây là kiểm thử concurrency, không giả mô phỏng bằng bấm chậm thủ công.

Kết quả người review/dùng thử thật phải ghi thêm tên hoặc mã người thử, ngày, build, expected/actual và lỗi gặp. Không dùng việc các bước đã được viết ra làm bằng chứng đã có người nghiệm thu.
## Bổ sung sau hợp nhất ngày 06/11/2026

- PM sửa dự án, chọn múi giờ báo cáo hợp lệ (ví dụ `America/New_York`). Mở báo cáo, chọn 08/03/2026 đến 08/03/2026. Request mới dùng `period_start=2026-03-08T05:00:00Z`, `period_end=2026-03-09T04:00:00Z` (23 giờ). Hai kỳ liền nhau không cùng đếm task đúng ranh giới. Báo cáo cũ giữ nguyên số liệu, kỳ và múi giờ snapshot.
- Với ngày tham chiếu 05/11/2026 trong test tự động, “thứ sáu tuần sau” là 13/11/2026. Khi demo trực tiếp, kết quả tương ứng với ngày đang chạy. “ngày 15/11/2026 hoặc ngày 16” phải để trống hạn.
- “Lộc: viết kiểm thử để người dùng không được tự cấp quyền admin” giữ action; “Lộc: sẽ không kiểm thử API nữa” không tạo action.
- Workload ghi rõ khi dùng giờ mặc định của thành viên. Capacity 0 có nghĩa không có giờ khả dụng. Nếu thiếu cả capacity tuần và mặc định, kết quả là chưa khai báo, không suy thành 0 hoặc 20.
- Hồ sơ cuối: [COMPLETION_2026-11-07.md](COMPLETION_2026-11-07.md).
- Lượt rà soát bổ sung toàn bộ 11 nhiệm vụ và sửa quyền/nguồn risk: [RECHECK_2026-11-07.md](RECHECK_2026-11-07.md).
