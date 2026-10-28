# Kiểm tra phần việc Lộc — 28/10/2026

## Kết luận

Phần backend/database đã có triển khai và kiểm thử đáng kể, dùng đúng PostgreSQL + Prisma theo Solution Design. Tuy nhiên chưa đủ căn cứ xác nhận toàn bộ phần việc của Lộc hoàn thành: phát hiện thêm 3 lỗi P2 có ca tái hiện, và còn các hạng mục nghiệm thu/vận hành chưa có bằng chứng đầy đủ.

Đây là review, chưa sửa mã ứng dụng. Các sửa đổi có sẵn trong working tree được giữ nguyên. Kết quả áp dụng cho working tree tại thời điểm kiểm tra, trên nền HEAD `36b63ba`, không mặc nhiên áp dụng cho bản trên GitHub hoặc tiến trình backend đang chạy. Không quy kết tác giả lỗi từ tên tài khoản demo hay tên nhánh.

## Nguồn và phạm vi

Đọc file `C:/Users/Lenovo/Downloads/DN26_CPL_Mock_Project_Nhom24.xlsx`, không sửa workbook:

- Overview!A8:F8: Lộc phụ trách Backend / Database, schema, nghiệp vụ, phân quyền, task và migration.
- Solution Design!A7:E7: PostgreSQL + Prisma, migrations, transaction, FK/unique constraints; pgvector cho RAG.
- Detail Plan: các dòng 8, 13, 18, 19, 25, 30, 43, 48, 63, 67, 85, 86, 89, 97, 101, 108, 112 giao Lộc thực hiện. Trong file này các dòng vẫn là Open, cột bằng chứng vẫn là placeholder; đây là trạng thái tài liệu kế hoạch, không tự chứng minh mã chưa được viết.
- Product Backlog giao Lộc làm chủ U003/U005/U007/U009/U013/U018/U028. Vai trò chủ story và người thực hiện/reviewer từng task cần được phân biệt.

Đối chiếu auth/session/reset/profile, workspace/project ACL và transaction, task/subtask/checklist/dependency/comment, metrics/risk, admin revoke, PostgreSQL/migrations, biên bản AI và giao diện chi tiết công việc. Các ghi chú và giới hạn từ review trước được đọc để tránh diễn giải lại lỗi đã sửa thành lỗi mới.

## Lỗi mới đã tái hiện

### 1. P2 — Realtime có thể xóa nội dung công việc đang nhập

Vị trí: `FrontEnd/src/components/TaskDetailModal.jsx:128–145`, liên quan luồng task và regression realtime U009/U020-T4.

Tình huống: chi tiết task đang mở, chưa chỉnh sửa; một sự kiện `task:changed` bắt đầu tải lại. Trong khi request đang chờ, người dùng gõ tiêu đề mới. Response trả về gọi `setForm(...)` và `setDirty(false)` vô điều kiện, thay thế nội dung vừa gõ. Kiểm tra `dirty` ở thời điểm nhận sự kiện không bảo vệ chỉnh sửa phát sinh sau đó.

Ca dùng React component thật với API trì hoãn và sự kiện socket được phát có kiểm soát: nhập `My unsaved edit`, response đến sau đổi lại thành `Original`. Đây là lỗi tích hợp giao diện liên quan phần task, không phải bằng chứng Lộc là người viết component.

Hướng sửa: kiểm tra trạng thái chỉnh sửa mới nhất khi áp dụng response, giữ form chưa lưu và báo dữ liệu server đã thay đổi; phân biệt tải tự động với thao tác Hủy/Tải lại có chủ ý. Chặn response tải cũ ghi đè trạng thái mới.

### 2. P2 — Câu hủy việc vẫn trở thành action item

Vị trí: `AIService/src/features/meeting.js:82–95`, liên quan U027-T1 và bộ ca phủ định U027-T3.

Đầu vào: `Lộc: Không cần triển khai API thanh toán nữa, hủy công việc này.`

Kết quả thực tế: `localMeeting` trả 1 item, gán cho Lộc, tiêu đề là câu hủy việc. Bộ lọc chỉ nhận động từ hành động và không xử lý phủ định/hủy. Backend tạo draft với `selected: true`, vì vậy mục này sẽ tạo task nếu người duyệt giữ lựa chọn mặc định.

Kỳ vọng: không coi một câu hủy rõ ràng là cam kết thực hiện mới. Hướng sửa cần xét ngữ cảnh để không loại nhầm câu như “không được quên triển khai”. Test này kiểm bộ trích nội bộ mặc định, không đánh giá chất lượng Claude.

### 3. P2 — Chấp nhận trích đoạn AI không có trong biên bản

Vị trí: `AIService/src/features/meeting.js:114–123`, liên quan source span U027-T1 và kiểm trích đoạn sai U027-T3.

Đầu vào biên bản chỉ có: `Lộc: Chỉ thảo luận giao diện hôm nay.` Provider giả lập trả mục triển khai thanh toán với excerpt `Lộc sẽ triển khai thanh toán ngày mai.`, người nhận hợp lệ và hạn hợp lệ về định dạng. `extractActions` chấp nhận toàn bộ kết quả dù excerpt và hạn không xuất hiện trong nguồn. Backend hiện lưu các item nhận được, không có bước đối chiếu excerpt với input.

Kỳ vọng: đối chiếu trích đoạn/source span với văn bản gốc, từ chối hoặc đánh dấu mục không được chứng thực; chỉ kiểm ID người nhận và định dạng ngày chưa đảm bảo thông tin có căn cứ. Ca kiểm thử chứng minh thiếu kiểm tra phản hồi provider, không khẳng định provider thật luôn trả sai. Task vẫn cần người dùng duyệt, nên không mô tả đây là tự động tạo task ngoài ý muốn mà không có bước duyệt.

## Kiểm chứng hôm nay

| Kiểm tra | Kết quả |
| --- | --- |
| `npm test` | 157/157 đạt: 16 AIService + 111 backend + 30 frontend; không skip |
| `npm run build` | Đạt |
| `git diff --check` | Đạt |
| Ca bổ sung frontend | 1/1 thất bại đúng kỳ vọng bảo toàn nội dung |
| Ca bổ sung AI | 2/2 thất bại đúng kỳ vọng phủ định và nguồn trích dẫn |

Lượt test đầu trong sandbox bị EACCES khi kết nối localhost. Đã chạy lại ngoài sandbox và hoàn tất 157 test. Backend dùng PostgreSQL nhúng tạm, upload tạm và AIService nội bộ; không dùng DB dev hay provider trả phí.

Log: `test-evidence/2026-10-28-review-tests.txt`, `test-evidence/2026-10-28-review-build.txt`, `test-evidence/2026-10-28-frontend-probes.txt`, `test-evidence/2026-10-28-ai-probes.txt`.

Hai file `.probe.js` là ca review chạy riêng, không nằm trong glob `*.test.js` của bộ test chuẩn. Chạy từ gốc dự án:

```powershell
node --import ./FrontEnd/test/helpers/register-jsx.js --test FrontEnd/test/review-2026-10-28.probe.js
node --test AIService/test/review-2026-10-28.probe.js
```

Chúng cố ý khẳng định hành vi đúng và hiện thất bại vì lỗi chưa được sửa. Không được cộng chúng vào số 157 test đạt.

## Phần đã có căn cứ hoạt động

- PostgreSQL: schema khai báo provider postgresql; `connectDb` dùng DATABASE_URL hoặc PostgreSQL nhúng; integration suite khởi tạo DB mới và áp dụng migrations thành công.
- Auth/session/profile: các ca verify/reset một lần, token reuse, revoke, nhiều phiên, whitelist profile và kiểm mật khẩu hiện qua.
- Membership/ACL: các ca Owner cuối, Viewer, archived, thu hồi project/workspace, API/socket/file/AI hiện qua.
- Task: các ca assignee, Review → Done, subtask một cấp, xác nhận xóa cha, phụ thuộc khác project/self-link/chu trình và xung đột hiện qua.
- Metrics/risk/admin: các ca deadline, capacity=0, thiếu estimate, project trống và khóa/revoke/audit hiện qua.

Các kết quả này xác nhận hành vi trong những ca đã chạy, không phải nghiệm thu toàn bộ yêu cầu hoặc xác nhận tác giả từng phần mã.

## Điểm còn thiếu bằng chứng nghiệm thu

- `BackEnd/src/services/mailer.js` chỉ ghi outbox và console, chưa gửi email thật. Đăng ký/reset/invite có thể demo qua hộp thư dev nhưng chưa hoàn tất luồng giao email khi triển khai production. Đây là giới hạn đã ghi nhận từ trước.
- U020-T4 yêu cầu log backup/restore dataset nhỏ và demo hai người. Báo cáo trước nêu chưa thực hiện; lượt này chưa tạo bằng chứng cho hai phần đó.
- Chưa xác nhận UAT bốn vai trò, rehearsal và review chéo của người thật cho U032/U035. Có seed và hướng dẫn kèm ảnh không đồng nghĩa đã nghiệm thu UAT.
- RAG hiện truy xuất theo từ khóa; thiếu pgvector theo Solution Design là giới hạn toàn dự án đã ghi trước, không quy thành lỗi riêng Lộc.
- Chưa chạy SMTP/OAuth/provider AI thật, load test, đa instance hoặc kiểm trực quan trình duyệt trong lượt này. Test giao diện mới dùng React renderer với API giả lập.
- Nhiều mốc trong Excel còn ở tháng 11–12/2026. Ghi “chưa nghiệm thu” không đồng nghĩa kết luận trễ hạn tại ngày 28/10/2026.

Ưu tiên tiếp theo: sửa và đưa 3 ca tái hiện vào bộ hồi quy chính, rồi bổ sung bằng chứng các đầu việc nghiệm thu còn thiếu. Không đánh dấu toàn bộ phần Lộc Done chỉ dựa trên README hoặc số test đạt.
