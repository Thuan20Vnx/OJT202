# Kết quả kiểm thử nhánh Loc — 23/10/2026

## Kết quả thực chạy

| Kiểm tra | Kết quả |
|---|---|
| `npm test` — AIService | 16/16 đạt, 0 thất bại |
| `npm test` — BackEnd | 95/95 đạt, 0 thất bại, 0 bỏ qua; khoảng 28,9 giây |
| `npm run build` | Thành công, 123 modules; Vite 6.4.5; chunk chính 459,31 kB, gzip 134,69 kB |
| `git diff --check` | Không lỗi whitespace; có thông báo chuẩn hóa LF/CRLF của Git trên Windows |
| `npm audit` đầy đủ cả dev/prod | BackEnd 0, FrontEnd 0, AIService 0 lỗ hổng được báo cáo |
| Node kiểm thử | v24.15.0 trên Windows |
| Branch | `Loc` |
| Database kiểm thử | PostgreSQL nhúng tạm thời; migrate từ database mới |
| Provider AI kiểm thử | AIService nội bộ và stub phản hồi provider sai, không gọi Claude thật |

Bộ backend ban đầu có 31 bài. Tổng các vòng trên nhánh Loc thêm 64 bài kiểm thử (37 ở vòng đầu, 27 ở vòng bổ sung), gồm test tích hợp nhiều request đồng thời và Socket.IO thật. Tổng số bài không tương đương số tiêu chí Excel đã nghiệm thu.

## Tái hiện trước sửa

Ba ca được chạy trực tiếp trên bản chưa sửa tương ứng và đều thất bại:

1. Một refresh token, 8 request đồng thời: **7 request thành công**, kỳ vọng 1.
2. Hạn mức AI 1/ngày, 5 request đồng thời: **5 request thành công**, kỳ vọng 1; sau sửa 4 request nhận 429.
3. Task vừa hết hạn trong hôm nay: My Tasks overdue **trả danh sách rỗng**, kỳ vọng có task đó.

Sau sửa, ba ca này và toàn bộ suite đều đạt. Vòng 23/10 tái hiện thêm: link verify thứ hai vẫn tạo phiên (200, kỳ vọng 400), và mật khẩu quá 72 byte vẫn đăng ký được (201, kỳ vọng 400). Hai ca đều đạt sau sửa. Cuối vòng tái hiện trực tiếp biên bản ISO thành năm 2015, 31/02 thành tháng 3, giới hạn 1 giờ ra 9 giờ, narrative lệch ngày trên host UTC; đều đã có ca hồi quy đạt.

Bằng chứng có thể đọc lại: [log npm test](test-evidence/2026-10-23-tests.log), [audit BackEnd](test-evidence/2026-10-23-audit-BackEnd.json), [audit FrontEnd](test-evidence/2026-10-23-audit-FrontEnd.json), [audit AIService](test-evidence/2026-10-23-audit-AIService.json). Log gồm hai lỗi cố ý gây ra (AI unavailable và rollback task quá dài); tổng cuối là 0 fail.

## Những nhóm đã kiểm

- Xác thực: đăng ký/xác minh, email duy nhất, mật khẩu yếu, token một lần, refresh/reuse, logout, reset, nhiều phiên, whitelist profile, CSRF.
- Quyền workspace/project: cách ly nhóm; Owner cuối kể cả đồng thời; Admin không sửa cấp cao; Viewer/archived; PM là Member; lời mời một lần, hết hạn, thu hồi và resend.
- Task: assignee trong project, không giao Viewer; tạo/chuyển Done bị kiểm quyền; Review là bước bắt buộc; version conflict; subtask một cấp; xóa cha cần xác nhận; checklist không tự duyệt cha.
- Đồng thời: giao/bỏ giao khi gỡ membership; hai dependency ngược chiều; AI apply song song; rollback task/audit khi lỗi ở giữa; refresh song song với revoke; hai System Admin khóa nhau.
- Thu hồi: API, phòng socket đang mở và join lại, download, AI, danh sách notification; Admin có quyền ngầm cũng phải rời phòng khi bị hạ role.
- Bình luận/tệp: Viewer không ghi; archived không xóa; không sửa comment người khác; nội dung HTML bị loại bỏ; upload lô sai không lưu một phần; download TXT bản mới; restore sai và lưu version cũ bị chặn.
- Số liệu: due_at chính xác, task không hạn/Done, ngưỡng 0/1 ngày, 0 capacity, thiếu estimate, làm tròn %, project trống; My Tasks/report/reminder nhất quán.
- AI: quyền PM ở plan/meeting/report/apply; mất quyền trong lúc chờ AI; nguồn bị xóa; quota tính cả pending; hỏi đồng thời không mất lịch sử; thiếu chứng cứ bị từ chối; dịch vụ AI lỗi không chặn CRUD.

## Các ca bổ sung 23/10

- Atomic verify cho hai link khác nhau, vô hiệu token cũ, giới hạn bcrypt 72 byte cả Unicode.
- Production từ chối seed demo kể cả gọi seed trực tiếp, từ chối JWT ngắn/default; client không giả IP bằng X-Forwarded-For ở cấu hình mặc định.
- Ghi nhớ true/false tạo đúng loại cookie, hạn DB 30 ngày/24 giờ; refresh không kéo dài quá expiresAt gốc.
- Deadline theo profile; giữ timestamp cụ thể; invalid date/offset/timezone bị chặn; DST ngày 23/25 giờ; tuần Thứ 2 qua biên năm; không phụ thuộc TZ máy.
- Báo cáo đúng cuối ngày; Sprint PATCH không đảo mốc; burndown giới hạn điểm ngay cả năm 1000–9999.
- Snapshot đổi estimate/xóa task phát hiện changed, nguồn mất không bấm được, lịch sử không bị viết lại; bản cũ unknown.
- AI risk đang chạy bị thu hồi quyền không trả nội dung; task/report đổi nguồn nhận 409; merge quy tắc đồng thời; resolve key giả bị chặn và có audit.
- Tham số phân trang âm, thập phân, Infinity, lặp hoặc quá lớn nhận 400.
- Biên bản: ISO, ngày không tồn tại, thiếu tháng, năm nhuận, profile và DST; HTTP tạo draft rồi duyệt task giữ đúng timestamp.
- Kế hoạch tổng 1 giờ, provider vượt giờ/ngày sai, không duyệt vượt hạn hoặc tổng giờ sau chỉnh sửa; không duyệt 0 việc; bản cũ input=null vẫn dùng được.
- AIService tăng từ 8 lên 16 bài; có stub output thiếu tiêu đề, estimate không hợp lệ, ngày sai và tên chứa regex.

## Kiểm tra giao diện trực tiếp

Đã dùng bản production build tại localhost trên database demo riêng:

| Vai trò / thao tác | Quan sát |
|---|---|
| Viewer — Trợ lý AI | Nút tạo kế hoạch bị khóa, có giải thích quyền |
| Viewer — Chi tiết task | Trường sửa bị khóa; không có ô gửi bình luận |
| Member — task Review | Hiện “Chờ PM, Owner hoặc Admin duyệt”; menu không có Hoàn thành |
| Owner đồng thời là PM — cùng task Review | Menu có Hoàn thành |
| Owner duyệt qua UI | Task TF-106 chuyển Hoàn thành; bảng tăng Done 6→7, Review 2→1; tổng tiến độ 33%→39% |

Vòng cuối: đăng nhập thành công sau thay đổi session; tạo báo cáo bằng lazy-loaded AI page; sửa task nguồn rồi mở lại báo cáo, banner báo nguồn đã thay đổi. Trước đó đã tạo task date-only qua UI, xác nhận nằm đúng ô lịch và chi tiết ghi 23:59; dashboard/icon font cục bộ hiển thị đúng.

Sau thay đổi cuối ở biên bản/kế hoạch, test tích hợp API và build đều đạt. Chưa lặp lại smoke test UI cho riêng thay đổi cuối: công cụ trình duyệt không khởi tạo được runtime (`failed to write kernel assets`), kể cả sau reset. Các ảnh vẫn là bằng chứng của vòng UI đã chạy trước đó.

Ảnh thật và hướng dẫn ở [LOC_REVIEW.md](LOC_REVIEW.md). Đây là smoke test UI, chưa phải UAT độc lập bốn vai trò hoặc kiểm thử toàn bộ trình duyệt.

## Các giới hạn phải giữ nguyên khi báo cáo

- 0 audit là kết quả cơ sở dữ liệu advisory tại thời điểm chạy, không chứng nhận không có lỗ hổng.
- Chưa chạy AI eval 40+10+20, provider thật, performance/load, backup/restore, SMTP và hạ tầng production.
- RAG chưa có embedding/pgvector. Chưa có UAT độc lập, kiểm đa instance hoặc phủ mọi trình duyệt.
- Test DB migrate từ database tạm mới; chưa chạy migration vào DB thật của người dùng.
- Không thay đổi trạng thái nghiệm thu Excel và không gán công lao mã nguồn cũ cho Lộc từ tên trong seed.

Chi tiết lỗi đã sửa, giới hạn, mapping nhiệm vụ Lộc và migration: [LOC_REVIEW.md](LOC_REVIEW.md).
