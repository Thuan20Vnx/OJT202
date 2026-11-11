# Rà soát bổ sung Sprint 2 — 02/11/2026

Baseline: `8d1f4fa3563bc66726d7df3905103e3d1e1ab249`. Rà soát theo yêu cầu kiểm tra kỹ thêm của người dùng, tập trung vào U013/checklist/subtask và U014/bình luận; giữ phạm vi Sprint 2 của Lộc.

## Lỗi đã tái hiện và sửa

| Tình huống | Trước sửa | Sau sửa và kiểm thử |
|---|---|---|
| Nhấn Enter checklist/subtask hai lần trước khi giao diện render lại | Gửi hai request; subtask có thể tạo trùng, checklist gặp xung đột thừa | Khóa ngay bằng ref, không chỉ dựa vào trạng thái render. Mỗi lần chỉ một request; giữ nội dung gõ tiếp trong lúc đang lưu. |
| Enter đang xác nhận ký tự bằng bộ gõ IME | Có thể tạo checklist khi người dùng chưa kết thúc gõ | Bỏ qua Enter khi `isComposing`; tương tự ô tạo subtask. |
| Đổi task trong khi request cũ chưa xong | Draft phụ đi theo task mới; phản hồi cũ có thể xóa draft mới hoặc kích hoạt tải lại task cũ | Reset draft theo task; kiểm scope của request trước khi cập nhật giao diện. Áp dụng cho checklist, subtask, lưu form, đổi trạng thái và phản hồi bình luận. |
| GET bình luận cũ đến sau sự kiện realtime | Hiện lại bình luận vừa ẩn, làm mất bình luận mới | Gộp các thay đổi diễn ra sau lúc bắt đầu GET. Giữ dấu xóa trong phiên modal; phản hồi POST/PATCH hoặc event đến muộn không phục hồi bình luận đã ẩn. Không có API phục hồi bình luận. |
| Có writer giữa lúc đọc task version và đọc checklist | Ghép version cũ với checklist mới | GET dùng transaction `RepeatableRead`, ACL và dữ liệu trong cùng snapshot. Test chủ động cho writer chen đúng giữa hai lượt đọc. |
| Thêm checklist bằng version cũ khi danh sách đã đủ 50 mục | Trả 400 thay vì thông báo xung đột 409 | Kiểm version trước; đọc/sửa checklist dưới cùng khóa workspace và transaction với ghi task/audit. Version hiện tại vượt 50 mục vẫn trả 400 và không ghi dở. |

Không sửa lại migration đã phát hành, không thay schema hoặc reset DB dev trong lượt này. Các test DB vẫn chạy PostgreSQL tạm độc lập. API giữ quyền PM/Member/Viewer và payload cũ.

## Bằng chứng

- Thêm **2 ca backend** trong suite `Lộc Sprint 2`, **6 ca frontend** có tiền tố `Sprint2 hardening` trong `FrontEnd/test/task-detail.test.js`.
- [Tái hiện backend trước sửa](evidence/2026-11-02-hardening-backend-before.txt): 2/2 fail ở assertion dự kiến.
- [Tái hiện checklist UI trước sửa](evidence/2026-11-02-hardening-ui-before.txt): 3/3 fail ở assertion dự kiến. Ca bình luận tải chậm và tạo trùng subtask cũng đã tái hiện fail riêng trước khi sửa.
- [Bộ test toàn hệ thống](evidence/2026-11-02-hardening-tests.txt): **285/285** = 194 backend + 70 frontend + 21 AIService, fail 0, skip 0; bao gồm migration nâng dữ liệu cũ.
- [Lint](evidence/2026-11-02-hardening-lint.txt): đạt.
- [E2E bản cuối](evidence/2026-11-02-hardening-e2e-final.txt): **9/9**, fail 0, skip 0; typecheck và build đạt. Chạy lại sau bổ sung chặn sự kiện bình luận đến muộn; log lượt trước cũng được giữ. Lỗi giả lập SMTP/audit là chủ đích của kiểm thử.
- Manifest tài liệu đã đối chiếu SHA-256 của **123 file source**, khớp toàn bộ. Git fetch không có commit mới ngoài baseline trên main/Loc trước khi bàn giao.

Kết luận: không còn ca thất bại trong các tình huống đã tái hiện và bộ hồi quy trên. Bản sửa được commit trên Loc rồi cập nhật main theo thứ tự người dùng đã yêu cầu; không force push.

Các test chứng minh những tình huống trên và các luồng hồi quy đã kiểm tra; không phải cam kết phần mềm tuyệt đối không còn lỗi ở mọi môi trường. Staging và xác nhận reviewer của nhóm vẫn chưa có trong lượt bàn giao local này.
