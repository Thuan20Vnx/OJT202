# Hoàng Anh — Sprint 2

Đối chiếu `TaskFlow_Nhom24_SuaLoiNgay.xlsx` do người dùng cung cấp, sheet `Detail Plan` và `Sprint 2`. SHA-256 workbook: `2CCB16AD3C60E81163B76424691A88F9B166B5CB5DC8AC6CB8282FB75C2C28C7`. Workbook được đọc, không sửa trạng thái hoặc ký nghiệm thu thay reviewer.

Nền triển khai là `origin/main` tại `a4add17`, cập nhật fast-forward vào `HAnh` trước khi sửa code. Commit triển khai `9c29bfa`; sau đó ghép `origin/main` tại `3bb0666` để giữ thêm 23 test của Hiệp. Source manifest khóa các file ứng dụng/Prisma được kiểm tra; các báo cáo cũ trong repo vẫn là bằng chứng lịch sử của từng lượt.

## Năm task thực hiện

| Task và dòng Excel | Kết quả code/kiểm thử |
| --- | --- |
| U011-T3 — dòng 39 | Test My Tasks với assignee/status/priority/due/search kết hợp, phân trang/trang rỗng, project private. API chỉ trả dữ liệu được phép đọc. Giữ các test UI debounce/reset/error trước đó của nhóm. |
| U015-T1 — dòng 49 | API tài liệu/tệp private; kiểm quyền trước nhận upload và sau khi khóa transaction; MIME/đuôi/chữ ký đầy đủ, TXT UTF-8, tối đa 10MB/tệp và 5 tệp/lô. PATCH bắt buộc version, revision/CAS không ghi đè bản cũ. Download qua proxy có kiểm membership và no-store. Tạo/sửa/xóa phát invalidation sau commit; nguồn RAG đọc trực tiếp không còn trả tài liệu đã xóa. |
| U016-T2 — dòng 53 | Notification center có loading/empty/error/retry, lọc/pagination, link task và tùy chọn sự kiện. Khóa thao tác lưu/read-all; badge dùng số từ server và đúng workspace. Đọc đồng bộ nhiều tab, preference khởi tạo đồng thời không lỗi unique. Các nút dùng được bằng bàn phím và trên mobile. Phạm vi kiểm chứng là thông báo trong ứng dụng. |
| U018-T1 — dòng 58 | Dependency cùng project, không self-link/cycle, transaction chung ngăn hai request tạo chu trình. Thêm/gỡ lặp không tăng version/audit. Blocked suy ra, không thêm trạng thái thứ năm. Khi blocker đổi trạng thái, board/detail tải lại; Calendar tải lại sau xóa. Gỡ dependency khi soft-delete có actor/entity/before/after. |
| U020-T2 — dòng 65 | Activity feed debounce, phân trang ổn định, mở chi tiết bằng bàn phím. Export giữ bộ lọc hiện tại và khoảng ngày, whitelist cột, cùng ACL, chống formula injection. Lỗi giữ modal để thử lại, không gửi lặp. Vượt 10.000 dòng trả lỗi yêu cầu thu hẹp lọc; không xuất thiếu âm thầm. |

Các thành phần chính: `BackEnd/src/routes/{documents,tasks,notifications,workspaces,capacity}.js`, `BackEnd/src/services/{metrics,capacity,notify}.js`, `FrontEnd/src/pages/{Notifications,Board,Calendar,Overview}.jsx`, `FrontEnd/src/pages/settings/Activity.jsx` và các component liên quan.

## Các phần được giao review

| Task được review | Kiểm tra kỹ thuật và sửa bổ sung |
| --- | --- |
| U013-T3 — dòng 45 | Kiểm tra subtask một cấp, quyền, không reparent/self-parent qua PATCH; soft-delete cả cây giữ tài liệu và có audit. UI luôn xem preview task/dependency/tệp trước xóa; hash impact kiểm lại trong transaction. Cây thay đổi trả 409 và cập nhật preview, chưa xóa dữ liệu. |
| U017-T3 — dòng 57 | API/socket kiểm thu hồi quyền, logout và reconnect đã có regression của nhóm. Thêm E2E mất mạng thật qua browser context, báo offline ngay và resync khi online. |
| U018-T2 — dòng 59 | Calendar tháng/tuần dùng timezone profile, dependency không có trạng thái riêng. Regression API self/cross-project/cycle và UI tải lại cờ Blocked khi blocker hoàn thành. |
| U019-T1 — dòng 61 | Sửa workload chỉ cộng task lá chưa Done/xóa, đến hạn trước cuối tuần, gồm overdue; tách thiếu estimate/deadline, không cộng project private khác. Thêm capacity theo workspace/user/week, không đổi mặc định các tuần khác, không chia cho 0; có CAS, audit và ràng buộc SQL. |
| U019-T2 — dòng 62 | Capacity editor lưu đúng tuần; giữ nội dung khi 409, yêu cầu tải lại giá trị mới trước khi lưu tiếp. Hiển thị thiếu dữ liệu và 0 giờ khả dụng rõ ràng. Capacity thay đổi làm nguồn report stale. |

Đây là review kỹ thuật có test/report để mentor và reviewer đối chiếu, không phải chữ ký nghiệm thu của người được phân công.

## Expected và actual sau sửa

| Ca kiểm tra | Expected | Actual |
| --- | --- | --- |
| Hai người lưu document cùng version | Một 200, một 409; giữ revision gốc | Đạt |
| Thiếu document version / chữ ký giả / TXT sai UTF-8 | 400; không lưu dở | Đạt |
| TXT đúng 10MB / vượt 1 byte | 201 và tải đủ byte / 400 | Đạt |
| 12 request khởi tạo prefs đồng thời | Tất cả 200, một bản ghi | Đạt |
| Read-all trên workspace | Chỉ thông báo đang có quyền; không đổi người khác/workspace khác | Đạt |
| Dependency lặp và hai cạnh ngược đồng thời | Lặp là no-op; không tạo chu trình | Đạt |
| Thêm task con sau preview xóa | 409; chưa xóa; xem lại cây mới | Đạt API và browser |
| Cha 50h + con 3h, có overdue/future/deleted/no-deadline | Tải = 3h; tách thiếu dữ liệu | Đạt |
| Capacity tuần hiện tại 0h | Không chia cho 0; tuần khác giữ mặc định | Đạt |
| Hai request capacity cùng version | Một 200, một 409, audit đúng lần thành công | Đạt |
| Ngày CSV đảo chiều / cột lạ / hơn 10.000 dòng | 400, không xuất thiếu | Đạt |
| CSV có ô bắt đầu bằng công thức | Escape; không chứa project private ngoài quyền | Đạt |
| Hai tab, offline/online, preview xóa và CSV download | Đồng bộ DB; không pageerror; tải tệp thật | Đạt browser |

## API và migration

- `GET/PATCH /api/workspaces/:wsId/members/:userId/capacity/:week`: week là thứ Hai `YYYY-MM-DD`; PATCH `{hours, version}`. Version 0 tạo override, các lần sau dùng version hiện tại; 409 trả bản mới. Owner quản mọi membership, Admin chỉ quản Member/Viewer.
- `GET /api/tasks/:id/deletion-preview`: PM xem task cha/con, số cạnh dependency, số tệp giữ lại, impactToken. UI DELETE dùng `?confirm=true&impact=...`; token cũ trả `409 DELETE_CHANGED`. Giữ tương thích lời gọi DELETE cũ của nhóm.
- `PATCH /api/documents/:id` bắt buộc `version` kể cả đổi tên/restore. Caller hiện có và contract đã cập nhật.
- Migration `20261030090000_weekly_capacity` tạo bảng có FK membership, khóa workspace/user/week, CHECK thứ Hai, giờ 0–80 và version dương. Chưa có override dùng `Membership.weeklyHours`; không backfill/đổi dữ liệu mặc định cũ.
- [OpenAPI](design/openapi.json), [ERD](design/ERD.md), [SRS](design/SRS.md), [manifest](design/source-manifest.json): 86 path, 111 operation, 24 model. Generator: `node scripts/generate-contract-docs.mjs`.

## Validation và bằng chứng

| Kiểm tra | Kết quả |
| --- | --- |
| `npm test` sau ghép main/Hiệp | 240/240: 16 AIService + 167 backend + 57 frontend; không skip |
| `npm run test:e2e` | 6/6 kịch bản Edge; không JavaScript pageerror |
| `npm --prefix FrontEnd run lint` | 0 lỗi, 0 cảnh báo |
| `npm --prefix FrontEnd run typecheck` | Đạt |
| Production build | Đạt; entry khoảng 475KB, không cảnh báo chunk >500KB |
| `npm audit` cho root, BackEnd, FrontEnd, AIService | 0 vulnerability trong cả bốn lockfile tại thời điểm kiểm tra |
| `git diff --check` và kiểm manifest/contract | Đạt |

Thêm 13 test API và 5 test component cho phạm vi này, cùng một luồng E2E Sprint 2; giữ các bộ test cũ và 23 test mới của Hiệp. Test dùng PostgreSQL/uploads tạm, HTTP API/AI nội bộ và SMTP sandbox; không dùng DB dev hoặc email thật. Log có các lỗi 503/audit-failure được cố ý tiêm trong ca hồi quy, với assertion kiểm tra rollback/phục hồi.

Logs: [suite tích hợp](test-evidence/2026-10-30-hoang-anh-sprint2-tests.txt), [build/E2E](test-evidence/2026-10-30-hoang-anh-sprint2-e2e.txt), [lint](test-evidence/2026-10-30-hoang-anh-sprint2-lint.txt), [typecheck](test-evidence/2026-10-30-hoang-anh-sprint2-typecheck.txt), [audit](test-evidence/2026-10-30-hoang-anh-sprint2-audit.json).

Ảnh từ browser: [thông báo desktop](screenshots/2026-10-30-hoang-anh-notifications.png), [mobile 390px](screenshots/2026-10-30-hoang-anh-notifications-mobile.png), [capacity tuần](screenshots/2026-10-30-hoang-anh-weekly-capacity.png), [preview cây thay đổi](screenshots/2026-10-30-hoang-anh-delete-preview.png), [activity/CSV](screenshots/2026-10-30-hoang-anh-activity.png).

## Dependency và cách chạy

Đã cập nhật body-parser 2.4.0, multer 2.5.0 (minimum `^2.5.0`) và Zod 4.6.7 cho backend/AI. Chuyển error/record API theo [hướng dẫn Zod 4](https://zod.dev/v4/changelog), tách defaults create khỏi project PATCH để không xóa roster khi sửa một trường. Bản vá Zod đối chiếu [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5); bộ hồi quy giữ contract và nghiệp vụ cũ.

```powershell
npm ci
npm run install:all
npm run dev
# Web http://localhost:5173 ; API :4000 ; AI :5000
```

Backend tự chạy migrations khi khởi động. Dừng backend cũ trước khi cài dependency/generate Prisma trên Windows. Thông số môi trường xem [INSTALL](design/INSTALL.md). Kết quả local xác nhận các luồng đã kiểm tra; việc triển khai thật và nghiệm thu của mentor vẫn là bước riêng.
