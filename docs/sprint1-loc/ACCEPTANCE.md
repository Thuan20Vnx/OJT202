# Sprint 1 — kịch bản demo và biên bản nghiệm thu local

Ngày soạn 01/11/2026. Tình trạng: đã chuẩn bị kịch bản và bằng chứng tự động; buổi demo/review của nhóm chưa được ghi nhận. Không có người tham dự hoặc chữ ký được điền thay.

## Chuẩn bị và chạy lại

Tại thư mục gốc repository, dùng Node.js >=24.15.0 và cài đúng lockfile:

```powershell
npm ci
npm --prefix BackEnd ci
npm --prefix AIService ci
npm --prefix FrontEnd ci
npm run typecheck
npm test
npm run test:e2e
```

Windows E2E mặc định dùng Edge đã cài. Máy CI/Linux cần cài Chromium cho Playwright theo `.github/workflows/ci.yml`. E2E tự tạo/xóa DB, SMTP và upload tạm, không cần .env thật. Lưu log chạy, hash code và ảnh cùng một đợt kiểm tra. CI của repo có bước upload ảnh nhưng kết quả CI remote cần được xem riêng.

Nếu demo tương tác, theo phần Chạy nhanh trong README và dùng môi trường development riêng. SMTP outbox là hộp thư giả lập, phải nói rõ khi demo. Không seed tài khoản demo công khai vào môi trường production.

## Kịch bản trình bày khoảng 5 phút

Đây là kế hoạch trình bày, không phải thời lượng đã đo của một buổi demo.

| Thời gian dự kiến | Thao tác | Kết quả mong đợi |
|---|---|---|
| 0:00–1:00 | Đăng ký email test, xác minh bằng SMTP sandbox, tạo workspace/project | Chưa xác minh không đăng nhập được; creator là Owner workspace và PM project |
| 1:00–2:00 | Mời tài khoản thứ hai, nhận lời mời; PM thêm vào project | Đúng email mới nhận được; lời mời một lần; có project membership mới đọc task |
| 2:00–3:00 | PM tạo task, nhập AC/estimate, giao Member; Member cập nhật remaining rồi gửi Review | Member không sửa assignee/estimate, không tự Done; dữ liệu được lưu |
| 3:00–4:00 | PM duyệt Done, mở lại; dùng hai cửa sổ tạo xung đột khi sửa | completedAt/remaining đúng; version cũ trả 409; draft chưa lưu được giữ |
| 4:00–5:00 | Xóa task thử; thử Viewer/archived và gỡ membership | Xóa mềm giữ lịch sử, biến mất khỏi view; thao tác trái quyền bị chặn, truy cập bị thu hồi |

Chỉ dùng dữ liệu thử có thể xóa. Các trường hợp cạnh tranh và rollback được minh họa bằng log tự động; không cần giả lập thao tác tay đã diễn ra.

## Phiếu kiểm tra của người nhận

Điền Actual, bằng chứng và người kiểm sau khi thực sự thực hiện. Log tự động nằm ở REVIEW; bảng này dành cho lần nghiệm thu của nhóm.

| ID | Ca kiểm tra / expected | Actual của nhóm | Bằng chứng / người kiểm |
|---|---|---|---|
| A01 | Register/verify/resend thành công; link cũ không đăng nhập lại được | Chưa chạy | Chưa ghi nhận |
| A02 | SMTP lỗi hiển thị chờ xác minh, cho gửi lại; không báo đã gửi thành công | Chưa chạy | Chưa ghi nhận |
| A03 | Logout chặn token cũ; Viewer không ghi | Chưa chạy | Chưa ghi nhận |
| A04 | Invite sai email/hết hạn/thu hồi không nhận được; giữ Owner cuối | Chưa chạy | Chưa ghi nhận |
| A05 | PM giao task đúng người; Member cập nhật remaining và gửi Review; PM duyệt Done | Chưa chạy | Chưa ghi nhận |
| A06 | Xung đột version không ghi đè draft; xóa mềm giữ lịch sử | Chưa chạy | Chưa ghi nhận |
| A07 | Project private/archived và thành viên bị gỡ không còn quyền trái phép | Chưa chạy | Chưa ghi nhận |
| A08 | Trang Thành viên giải thích đúng quyền workspace/project; xem ở desktop/mobile | Chưa chạy | Chưa ghi nhận |
| A09 | `/api/v1` đăng nhập/refresh/logout đúng cookie; ACL và CSRF giữ nguyên | Chưa chạy | Chưa ghi nhận |
| A10 | AC văn bản nhiều dòng tạo/sửa/đọc được; migration giữ tiêu chí cũ | Chưa chạy | Chưa ghi nhận |
| A11 | Typecheck strict, build và test chạy được từ lockfile với Node >=24.15 | Chưa chạy | Chưa ghi nhận |

## Biên bản duyệt SRS và phạm vi

| Nội dung | Ghi nhận |
|---|---|
| Ngày/giờ buổi review | Chưa tổ chức/ghi nhận |
| Build hash và môi trường | Điền khi thực hiện |
| Người tham dự | Chưa ghi nhận |
| Người trình bày | Chưa ghi nhận |
| TypeScript cho bootstrap/routing/layout | Đã triển khai; reviewer kiểm phạm vi trong TYPESCRIPT.md |
| Prefix API | Đã dùng `/api/v1`, giữ alias `/api`; reviewer kiểm A09 |
| Tiêu chí nghiệm thu dạng text | Đã triển khai API/UI/migration; reviewer kiểm A10 |
| Phạm vi yêu cầu bổ sung từ ảnh góp ý | Theo bảng SRS mục 5; nhóm chưa duyệt kế hoạch triển khai mới |
| PO Trần Hoàng Anh duyệt U001-T3 | Chưa xác nhận |
| Lộc xác nhận 6 nhiệm vụ review | Chưa xác nhận |
| Thuận/Đạt/Hoàng Anh/Hiệp xác nhận task tương ứng của Lộc | Chưa xác nhận |
| Kết luận nghiệm thu nhóm và việc cần sửa | Chưa ghi nhận |

Không chuyển task thành Done chỉ vì bảng này đã được tạo. Chốt kết luận sau khi người có trách nhiệm đánh giá bằng chứng và xử lý sai khác yêu cầu.

## Khi nhóm có staging

Người dùng xác nhận chưa có staging và chọn bàn giao local trước. Checklist dưới đây dùng cho đợt tiếp theo:

1. Ghi URL HTTPS và build hash; chuẩn bị database/upload riêng, tài khoản thử và backup trước migration.
2. Cài dependency/migration, build frontend; cấu hình production, secret, AI service key và SMTP TLS theo README. Không sao chép secret vào biên bản.
3. Kiểm tra nhận thư provider thật với hộp thư do người thử quản lý; phân biệt thư gửi được với việc vào inbox/spam. Việc gửi mail thật cần người dùng cho phép trước khi thực hiện.
4. Chạy A01–A11 trên URL thật; ghi Actual, ảnh/log và người kiểm. Thử reload route, cookie/session qua HTTPS và thu hồi quyền đang mở socket.
5. Nhóm xác nhận kết quả, sai khác/known issues và phạm vi được chấp nhận trước khi cập nhật trạng thái Excel.
