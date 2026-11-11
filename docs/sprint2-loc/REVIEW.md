# Sprint 2 — Nguyễn Bảo Lộc

**Cập nhật mới nhất 04/11/2026:** đã chạy lại toàn bộ kiểm tra trước khi đẩy nhánh `Loc`, sau đợt điều tra HTTP 400 ở E2E Lộc Sprint 2. Các đợt trước: [rà soát bình luận, bản nháp và giờ còn lại](REVIEW_2026-11-03.md), [phụ thuộc, subtask và phản hồi chậm](FOLLOWUP_2026-11-03.md). Các mốc cũ được giữ để truy vết.

**Mốc lịch sử 03/11/2026:** 299/299 test, 9/9 E2E; lint, typecheck và build đạt. Kết quả chạy lại ngày 04/11 được ghi riêng bên dưới. Bàn giao local, chưa có nghiệm thu staging hoặc xác nhận độc lập của reviewer.

## Kiểm tra trước khi đẩy Loc — 04/11/2026

Theo yêu cầu đưa code lên nhánh Lộc, đợt này bao gồm cả bốn file source đã có thay đổi trong workspace: snapshot task/checklist nhất quán và trả đúng version của mutation; giữ form khi tải task lỗi, vô hiệu hóa request sau khi mất quyền; khóa gửi lặp và hiển thị lỗi gửi lại email reset. Giữ kiểm tra hồi quy mã project `LSP2`/`LSP`. Sinh lại OpenAPI/source manifest từ code đang bàn giao.

| Kiểm tra | Kết quả | Bằng chứng |
|---|---|---|
| `npm test` | **299/299** = 21 AIService + 194 backend + 84 frontend; fail 0, skip 0 | [Log test trước push](evidence/2026-11-04-push-tests.txt) |
| `npm run test:e2e` | **9/9**, fail 0, skip 0; typecheck và production build đạt | [Log E2E trước push](evidence/2026-11-04-push-e2e.txt) |
| `npm --prefix FrontEnd run lint` | Đạt | [Log lint trước push](evidence/2026-11-04-push-lint.txt) |

Đã fetch GitHub trước bàn giao: `origin/Loc` ở `b7c972b`, `origin/main` đã tiến tới `a3bcde0` qua 4 commit mới. Kết quả trên áp dụng cho code Loc trước khi ghép main; chưa chứng minh bản tích hợp với main mới nhất. Không reset dữ liệu dev, không force push.

### Kết quả đẩy Loc và kiểm tra main

Đã đẩy commit [`1128cd7`](https://github.com/Thuan20Vnx/OJT202/commit/1128cd7) lên `origin/Loc`. Kiểm tra `git merge-tree --write-tree origin/main Loc` với main `a3bcde0` trả exit code **1**, có xung đột nội dung ở:

- `BackEnd/src/routes/tasks.js`: main thêm contributors và daily-update counts vào `enrich`; Loc truyền transaction để snapshot nhất quán. Khi giải xung đột cần giữ cả dữ liệu mới của main lẫn transaction của Loc.
- `docs/design/openapi.json` và `docs/design/source-manifest.json`: cần sinh lại từ source sau khi giải xung đột.

`TaskDetailModal.jsx` và E2E được Git ghép tự động, nhưng chưa chạy kiểm thử trên bản tích hợp. **Chưa thể ghép tự động lên main ở trạng thái này**; cần giải ba xung đột, sinh lại tài liệu và chạy bộ kiểm tra trên bản ghép trước khi đưa lên main. Lượt này chỉ dùng merge-tree để kiểm tra, không đổi local/remote main, không tạo merge đang dang dở. Xem [log kiểm tra ghép](evidence/2026-11-04-main-merge-check.txt). CI remote chưa được xác nhận; kết quả pass phía trên là kiểm thử local.

## Đối chiếu lỗi tạo project — 04/11/2026

- Log [02/11 trước sửa](evidence/2026-11-02-e2e.txt) ghi `400 !== 201` tại bước tạo project. Nguyên nhân là fixture dùng mã dự án chứa chữ số, trái contract `keyPrefix` trong `BackEnd/src/routes/projects.js`: `/^[A-Z]{2,5}$/`, lỗi trường `keyPrefix` là `Mã dự án gồm 2–5 chữ cái`. Số sprint có thể nằm trong tên dự án, không nằm trong mã.
- Đối chiếu `BackEnd/src/seed.js`: Mai Anh là workspace owner, Như là workspace member. POST tự thêm người tạo làm PM; `members: [seed.users.nhu.id]` hợp lệ. `/api/v1` và `/api` dùng chung router. Không có căn cứ sửa seed, quyền hoặc nới validation API.
- Checkout bắt đầu lượt này ở `b7c972b`; fixture đã dùng `LSP` và assertion đã hiển thị response body từ commit `8d1f4fa`. [Chạy riêng ca Lộc trước thay đổi lần này](evidence/2026-11-04-e2e-before.txt) đạt **1/1**. Vì vậy lỗi 400 lịch sử không còn tái hiện với fixture hiện tại.
- Bổ sung kiểm tra hồi quy trong chính scenario Lộc: gửi `LSP2` với cùng owner/member, xác nhận **400 và lỗi đúng trường `keyPrefix`**; gửi `LSP`, vẫn yêu cầu **201**, rồi tiếp tục toàn bộ assertion giao diện hiện có. Không đổi kỳ vọng thành 400 cho bước tạo project hợp lệ.

Lượt chạy trong sandbox bị `EACCES` khi kết nối PostgreSQL localhost trước khi gọi API; chạy lại ngoài sandbox với PostgreSQL/uploads tạm riêng. Các kết quả bên dưới là chạy local, không dùng DB dev. Workspace có thay đổi chưa commit từ trước ở `BackEnd/src/db.js`, `BackEnd/src/routes/tasks.js`, `FrontEnd/src/components/TaskDetailModal.jsx`, `FrontEnd/src/pages/auth/ForgotPassword.jsx`; lượt này giữ nguyên các thay đổi đó.

| Kiểm tra ngày 04/11 | Kết quả | Bằng chứng |
|---|---|---|
| E2E Lộc Sprint 2 sau bổ sung hồi quy | **1/1**, fail 0, skip 0; `LSP2` → 400 đúng trường, `LSP` → 201; toàn bộ luồng tìm mô tả/checklist/ẩn bình luận/phụ thuộc và giữ draft đạt | [Log E2E](evidence/2026-11-04-e2e-loc.txt), [ảnh checklist sau reload](evidence/2026-11-04-loc-sprint2-checklist.png) |
| Typecheck backend/frontend + build frontend | Đạt (`npm run build`) | [Log build](evidence/2026-11-04-build.txt) |

Lệnh chạy riêng ca liên quan: `node --test --test-concurrency=1 --test-name-pattern="Lộc Sprint 2" test/e2e/sprint1.test.mjs`. Đợt điều tra ban đầu chỉ chạy ca này; đợt chuẩn bị đẩy Loc sau đó đã chạy toàn bộ kiểm tra như bảng phía trên.

**Mốc rà soát bổ sung 02/11:** xem [các lỗi đã tái hiện và sửa](HARDENING.md). Bộ test khi đó tăng lên 285 ca; số liệu 277 ca phía dưới là mốc bàn giao ban đầu và được giữ để truy vết.

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
