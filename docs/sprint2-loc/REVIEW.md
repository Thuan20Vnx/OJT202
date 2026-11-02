# Sprint 2 — Nguyễn Bảo Lộc

Ngày đối chiếu: 02/11/2026. Baseline trước triển khai: `396bb28aed1895d10f95705e9958b699bf8c8475` trên nhánh `Loc`, đã chứa code mới từ main của nhóm.

Nguồn phân công: **DN26_CPL_Mock_Project_Nhom24 (1).xlsx** do người dùng cung cấp, SHA-256 `7FDC04FAEAF146EE068A3397288C6A1203CE27AAA611AC59E0B1706444BCC371`. Các dòng dưới đây thuộc sheet **Detail Plan** của đúng workbook này. File Excel giữ nguyên; trạng thái Open trong workbook không được tự đổi thành xác nhận nghiệm thu của nhóm.

## Phạm vi trực tiếp

| Dòng | Task của Lộc | Kết quả triển khai/đối chiếu | Người review theo Excel |
|---|---|---|---|
| 55 | U005-T1 — forgot/reset, PATCH /me whitelist | Giữ API đã có; bổ sung kiểm chứng SMTP reset, token hết hạn/sai mục đích/chỉ dùng một lần khi gửi đồng thời, thu hồi toàn bộ access/refresh sessions; chặn role/email/isLocked và tên quá dài qua profile. | Thuận |
| 58 | U011-T1 — query filter, search tên/mô tả, index | Thêm search mô tả vào My Tasks, board và tìm kiếm workspace. Bổ sung GET `/tasks`, `/me/tasks` có workspace bắt buộc; dùng chung handler với route cũ. Kiểm dữ liệu bộ lọc, sắp xếp có ID để phân trang ổn định, chỉ đọc dự án có quyền và task chưa xóa. Thêm index project/status/due và workspace/assignee/due. | Thuận |
| 61 | U013-T1 — parent_task_id, checklist_items | Đổi cột cha sang `parent_task_id`; chuyển JSON cũ sang bảng `checklist_items`, giữ nội dung/thứ tự/trạng thái. Thêm API checklist, giữ payload checklist của client cũ; ID ổn định cho client mới, CAS version và audit cùng transaction. Subtask tối đa một cấp/cùng dự án, không đổi cha qua PATCH, không tự duyệt cha khi checklist xong. | Hiệp |
| 66 | U014-T3 — XSS/quyền/mention | Thêm test XSS, sửa/xóa bình luận người khác, mention ngoài dự án/tài khoản khóa. Qua review, bổ sung PM ẩn bình luận có audit, soft-delete; loại bình luận ẩn khỏi danh sách, số đếm và nguồn AI đang đọc. PM không được sửa nội dung thay tác giả. | Thuận |
| 81 | U019-T3 — dataset tải công việc | Dataset riêng đối chiếu giờ còn lại của task lá, capacity 0, null khác 0, thiếu hạn/estimate, quá hạn, biên cuối tuần, Done, task xóa và project private. Kết quả mong đợi cố định 5 giờ = 3 giờ task con + 2 giờ quá hạn. | Hiệp |

## Phần Lộc được giao review

| Dòng | Task/người thực hiện | Cách kiểm chứng kỹ thuật |
|---|---|---|
| 57 | U005-T3 / Hiệp | Ca API mới kiểm phản hồi email tồn tại/không tồn tại giống nhau, token hết hạn, gán role, tên 81 ký tự. |
| 59 | U011-T2 / Như | Giữ UI My Tasks/debounce/list đã ghép; E2E tìm đúng task bằng từ chỉ xuất hiện trong mô tả, đồng thời chạy lại scenario filter/pagination 10.000 task. |
| 64 | U014-T1 / Thuận | ACL author/Member/PM/ngoài project, XSS, mention, thu hồi quyền; rollback khi ghi audit thất bại. |
| 65 | U014-T2 / Như | E2E hiện có kiểm mention picker, gửi lỗi giữ nội dung và gửi lại; scenario mới kiểm PM ẩn bình luận và reload. |
| 72 | U016-T3 / Thuận | Job chạy lại không trùng, đổi hạn tạo thông báo mới, timestamp offset được chuẩn hóa, Done và người rời nhóm không nhận nhắc hạn. |

Sheet **Sprint 2** ghi Lộc là PIC ở U005 (F5), U013 (F7), U018 (F12). U018 không đồng nghĩa toàn bộ task do Lộc code: Detail Plan 76 giao dependency cho **Hoàng Anh**, 77 giao Calendar cho **Đạt**, 78 giao test cho **Thuận**. Giữ triển khai đã có và chạy lại regression dependency/cycle/Blocked/calendar. Việc review kỹ thuật tự động này chưa thay thế xác nhận của reviewer trong nhóm.

## Hợp đồng tích hợp

Base API `/api/v1`; `/api` vẫn là alias. Xem [OpenAPI](../design/openapi.json) và [ERD](../design/ERD.md).

- `GET /tasks?workspace=<uuid>` và `GET /me/tasks?workspace=<uuid>`: mặc định việc giao cho mình, loại Done nếu không yêu cầu; filter assignee/status/priority/project/due/search, page/limit. Route `/workspaces/:wsId/my-tasks` còn hoạt động. Board vẫn trả task gốc trong dự án.
- `GET /tasks/:id/checklist` trả `{items, version}`. Mỗi item `{_id, text, done}`. `POST /tasks/:id/checklist` nhận `{version, text, done?}`; `PATCH /checklist/:id` nhận `{version, text?, done?}`; `DELETE /checklist/:id?version=N`. Các mutation trả `{task}`. Tối đa 50 mục, text 1–300 ký tự; stale trả 409. Chỉ PM dự án đang hoạt động được sửa nội dung; Member/Viewer có quyền đọc được xem.
- `PATCH /tasks/:id` vẫn nhận cả mảng checklist. Gửi `_id` để giữ danh tính mục; không gửi ID vẫn tương thích client cũ. ID thuộc task khác hoặc lặp bị từ chối; lỗi rollback cả task version/checklist/audit.
- `DELETE /comments/:id`: tác giả xóa của mình; PM được ẩn của người khác. Cả hai giữ bản ghi lịch sử với `deleted_at`. Không có endpoint phục hồi. Dự án lưu trữ/Viewer không được ghi; người ngoài project nhận 404 theo quy ước giấu tài nguyên của hệ thống.
- UI checklist giữ nội dung nhập khi lưu lỗi; thêm/chọn/xóa giữ ID. Label tìm kiếm và quyền ẩn bình luận có VI/EN.

## Chạy và nâng dữ liệu local

Sau pull, dừng backend đang chạy trước khi generate Prisma trên Windows:

```powershell
node BackEnd/node_modules/prisma/build/index.js generate --schema BackEnd/prisma/schema.prisma
npm run dev
```

Backend tự chạy migration `20261102090000_sprint2_checklist_search`. Migration chạy trong một transaction: đổi tên cột/index/FK cha, chuyển JSON checklist sang bảng có FK, bỏ cột JSON, thêm index deadline và comments.deleted_at. Không dùng reset DB. Với DB có dữ liệu cần giữ, sao lưu trước khi nâng; không chạy lại backend cũ trên schema mới. Khôi phục phiên bản cũ cần khôi phục backup DB tương ứng.

DB dev chưa được thay đổi trong các kiểm thử: API/migration/E2E đều dùng PostgreSQL tạm riêng. SMTP sandbox kiểm việc nhận email trong máy; không phải nghiệm chứng nhà cung cấp email thật.

## Kiểm chứng và bàn giao

| Kiểm tra | Kết quả | Bằng chứng |
|---|---|---|
| Test AIService/backend/frontend | **277/277** = 21 AIService + 192 backend + 64 frontend; fail 0, skip 0 | [Log toàn bộ](evidence/2026-11-02-tests.txt) |
| Migration nâng dữ liệu cũ | Đạt; giữ checklist text/done/order và liên kết cha; có chỉ mục mới | Nằm trong log backend ở trên, ca `migration nâng dữ liệu project cũ...` |
| Lint frontend | Đạt | [Log lint](evidence/2026-11-02-lint.txt) |
| Typecheck + build | Đạt | [Log build/E2E](evidence/2026-11-02-e2e-final.txt) |
| E2E trình duyệt | **9/9**, fail 0, skip 0 | [Log cuối](evidence/2026-11-02-e2e-final.txt) |

Suite **Lộc Sprint 2** thêm 8 ca tích hợp trong `BackEnd/test/api.test.js`; E2E thêm scenario tìm mô tả, retry checklist, giữ dữ liệu sau reload và PM ẩn bình luận trong `test/e2e/sprint1.test.mjs`. Chạy lại toàn bộ test của nhóm, không bỏ qua test cũ. Các log lỗi SMTP/audit chủ đích là phần kiểm chứng rollback, không phải test fail; đọc tổng kết mỗi suite.

Các lượt E2E trước được giữ để truy vết: lần đầu fixture dùng mã dự án có chữ số, trái validation; lượt tiếp theo dùng `check()` đòi checkbox đổi ngay trong khi UI chờ server; lượt sau cố bấm lại task dù URL `?task=` đã khôi phục modal sau reload. Đã sửa kịch bản theo contract và cơ chế giao diện thực tế; không đổi nghiệp vụ hoặc bỏ assertion để né lỗi. Log cuối là căn cứ nghiệm chứng sau sửa kịch bản.

Xem [kịch bản demo local](DEMO.md) và [ảnh checklist sau reload](evidence/loc-sprint2-checklist.png) để reviewer thao tác lại. Ảnh được chụp bởi E2E trên build thật và đã kiểm tra trực quan; checklist 1/1 nhưng task vẫn Cần làm. Git đã được fetch trước bàn giao; tại thời điểm kiểm tra, origin/main và origin/Loc cùng ở baseline `396bb28`, chưa có code remote mới cần ghép.

Kết luận kỹ thuật local: 5 nhiệm vụ trực tiếp đã có triển khai/kiểm thử tương ứng, 5 mục review được đối chiếu bằng kiểm thử và báo cáo. Thay đổi được chuẩn bị trên Loc trước; chỉ cập nhật main sau khi bộ kiểm tra cuối đạt. Không dùng force push.

Chưa có staging theo xác nhận của người dùng. Bản bàn giao hướng tới local; chưa có xác nhận review của Thuận/Hiệp, nghiệm thu người dùng hoặc kết quả CI remote trong báo cáo này. Không ký thay, không đổi trạng thái workbook và không mở rộng sang đa người nhận, ngày plan/actual, issue/effort hoặc booking họp ngoài baseline Sprint 2.
