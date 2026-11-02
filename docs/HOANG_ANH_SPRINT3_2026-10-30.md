# Hoàng Anh — Sprint 3 (30/10/2026)

Triển khai trên `HAnh`, bắt đầu từ `origin/main` tại `de5b6b8` (đã chứa Sprint 2), bàn giao lên `main` theo yêu cầu. Đây là báo cáo phần code và kiểm chứng kỹ thuật, không tự xác nhận nghiệm thu thay mentor hoặc người dùng.

Nguồn phân công: `D:/Downloads/TaskFlow_Nhom24_SuaLoiNgay.xlsx`, SHA-256 `2CCB16AD3C60E81163B76424691A88F9B166B5CB5DC8AC6CB8282FB75C2C28C7`. Workbook gốc giữ nguyên. Sheet `Detail Plan`: dòng 68, 70–72, 79, 83, 87; sheet `Sprint 3`: dòng 5, 10, 11.

## Phần trực tiếp triển khai

| Task trong Excel | Kết quả code và kiểm chứng |
| --- | --- |
| **U021-T1, dòng 68 — Must, được chọn** | Hoàn thiện planner dùng gateway chung. Kết quả AI phải có 5–15 mục với title/description/AC/estimate hợp lệ; chặn JSON lỗi, NUL, thiếu AC, ước lượng sai/vượt ngân sách và ngày do AI tự đặt/vượt hạn. Chỉ tạo nháp, chưa tạo task hoặc thông báo. Người nhận mặc định trống; PM chọn thủ công. |
| **U021-T1 — sửa/chọn/duyệt** | `AiDraft.version` bắt buộc khi sửa/duyệt/hủy. Khóa workspace và đọc lại quyền; tab cũ nhận `409 AI_DRAFT_CHANGED`. Không âm thầm bỏ qua key sai/trùng hoặc cho sửa excerpt nguồn. Assignee phải có quyền làm việc ở cả workspace và project. Khi duyệt kiểm tổng giờ, hạn và số người đã chọn; AC/remainingHours được lưu vào task. |
| **U021-T1 — apply một lần** | Duyệt và audit cùng transaction, unique `(project, aiDraftItem)`. Năm request duyệt đồng thời tạo đúng một bộ task, một audit duyệt và một thông báo cho mỗi assignment thật. Retry sau approved trả lại kết quả, không tăng version hoặc tạo task lại. Audit lỗi rollback cả task, sequence, trạng thái nháp và không gửi thông báo. |
| **U026-T1, dòng 83 — Must, được chọn** | Giữ bộ quy tắc xác định overdue/blocked/overload, không dùng ML, không phụ thuộc AI report. Kiểm biên mili giây/ngưỡng ngày, so sánh tải bằng số thực trước làm tròn, remainingHours, capacity bằng 0, task Done/xóa và dependency. Blocked vẫn là cờ suy ra; không thêm trạng thái thứ năm. |
| **U026-T1 — nguồn và xử lý** | Mỗi alert có `sourceVersion`, snapshot đầu vào, thời điểm tính, phiên bản engine/ngưỡng và task nguồn. `Project.riskRulesVersion` tăng khi ngưỡng thực sự đổi. Xử lý cần đúng phiên bản nguồn và lý do 3–1000 ký tự; kiểm lại ACL/nguồn trong transaction, ghi snapshot/lý do và audit. Request lặp không nhân audit. Nguồn liên quan/ngưỡng/capacity đổi thì alert được xét lại; sửa task không liên quan không tự mở lại alert. |
| **U026 — giao diện tích hợp** | Modal nhập lý do, xử lý loading/error/409, giữ lý do khi lỗi. Lịch sử hiển thị lý do và dấu hiệu nguồn đã đổi. Mở lại kiểm `sourceVersion`, tránh tab cũ xóa lần xử lý mới. Task/dependency/board realtime làm mới alert; diễn giải AI gắn với phiên bản nguồn, không thay quyết định quy tắc. Đổi project không nhận phản hồi muộn của project trước. |
| **U027-T2, dòng 87 — Should, chưa được chọn** | Hoàn thiện luồng ghi chú họp đã có: xem/sửa/chọn action items, chọn người/hạn thủ công, dùng chung version và quyền với planner, chỉ tạo task sau duyệt. Sửa lỗi nguồn kèm theo: excerpt provider phải có nguyên văn trong biên bản; người/hạn không chứng minh được để trống; câu hủy/phủ định không tạo action. Hai review probe cũ đã chuyển thành regression chạy trong CI. Đây là bổ sung kỹ thuật, không đổi trạng thái Should/chưa chọn trong Excel. |

Không nhận công của các task giao cho thành viên khác: gateway U023, UI planner/risk, report và Q&A đã có trước được tái sử dụng và sửa phần tích hợp cần thiết.

## Phần được giao review

| Task review | Kết quả kỹ thuật / giới hạn nghiệm thu |
| --- | --- |
| **U021-T3, dòng 70** | Bổ sung kiểm thử provider JSON/schema lỗi, dữ liệu thiếu, giới hạn, quyền, tab cũ và duyệt đồng thời. Giữ hồi quy gateway timeout/retry/quota và CRUD khi AI lỗi. |
| **U022-T1, dòng 71** | Số liệu vẫn do DB tính, AI chỉ diễn giải. Bổ sung `AiReport.generatedAt` để ghi thời điểm chốt snapshot; overview/risk dùng cùng thời điểm này. Fingerprint nguồn report bổ sung các lần xử lý risk; nếu risk thay đổi trong lúc AI chạy thì trả 409 và chưa lưu report. Report đã lưu giữ nguyên stats/generatedAt, báo nguồn thay đổi khi cần. |
| **U022-T2, dòng 72** | Hiển thị thời điểm chốt số liệu; sửa thông báo quyền cho đúng PM. Giữ các kiểm thử editor không mất nội dung khi lỗi, lịch sử/source links và quyền đọc lại. |
| **U024-T3, dòng 79** | Regression collaboration/planner/report/Q&A, ACL bị thu hồi, nguồn thay đổi và fallback lỗi AI được chạy tự động. **Chưa có demo/phiếu phản hồi của 3 người thật; không ghi là đã nghiệm thu phần này.** |

Review tự động và tự rà code không thay thế việc review độc lập theo người được phân công trong workbook. AIService nội bộ và provider giả lập kiểm chứng contract/lỗi; chưa dùng kết quả này để công bố chất lượng của mô hình Anthropic trả phí hoặc điểm đánh giá người dùng.

## API và thay đổi contract

Base `/api`; cookie và header chống CSRF giữ theo contract hiện có.

| Endpoint | Contract cần lưu ý |
| --- | --- |
| `POST /projects/:projectId/ai/plan` | PM active; trả nháp 5–15 mục đủ AC/estimate, `version=1`, chưa tạo task. |
| `PATCH /ai/drafts/:id` | Chủ nháp đồng thời là PM; `{ version, items?, removeKeys? }`. Thành công tăng version; stale 409; validation 400. |
| `POST /ai/drafts/:id/approve` | `{ version }` bắt buộc; check quyền/membership/giới hạn lúc apply. Trả `{ ok, created, draft }`; approved retry idempotent. |
| `POST /ai/drafts/:id/discard` | `{ version }` bắt buộc khi nháp còn mở; không hủy nháp đã approved. |
| `GET /projects/:projectId/risks` | `open` có sourceVersion/snapshot/generatedAt; `resolved` có reason/sourceVersion/snapshot/current; có rulesVersion/engineVersion. |
| `POST /projects/:projectId/risks/resolve` | PM/Member active; `{ key, sourceVersion, reason }`. Server lấy title thật. Nguồn cũ 409, reason sai 400, quyền sai 403/404. |
| `DELETE /projects/:projectId/risks/resolve` | Query `key` và `sourceVersion` bắt buộc; không mở nhầm lần xử lý mới ở tab khác. |
| `POST /projects/:projectId/risks/explain` | AI chỉ diễn giải alert đang tồn tại; kiểm lại nguồn/ACL sau AI; response kèm sourceVersion. |
| `POST /projects/:projectId/ai/reports` | Snapshot tại generatedAt, kiểm nguồn gồm risk resolution; source đổi trong lúc gọi AI trả 409. |

Client tích hợp ngoài frontend của repo cần cập nhật body/query mới. [OpenAPI](design/openapi.json), [ERD](design/ERD.md), [manifest SHA-256 source](design/source-manifest.json) được sinh lại từ source: 86 paths, 111 operations, 24 models, 114 source hashes.

## Migration và cách chạy sau khi pull

Migration mới: [20261030100000_sprint3_draft_risk_versions](../BackEnd/prisma/migrations/20261030100000_sprint3_draft_risk_versions/migration.sql).

- Thêm `ai_drafts.version` mặc định 1, có CHECK dương; thêm `projects.riskRulesVersion` mặc định 1.
- Thêm `risk_resolutions.source_version/reason/snapshot`. Bản ghi cũ thiếu nguồn/lý do vẫn được giữ nhưng không che alert hiện tại.
- Thêm `ai_reports.generatedAt` nullable. Report cũ giữ null vì không có thời điểm snapshot đáng tin cậy; report mới lưu mốc thật, không sửa khi chỉnh nội dung.
- Không reset database, không xóa task hoặc dữ liệu người dùng.

Dừng backend trước khi generate Prisma trên Windows, sau đó chạy tại repository root:

```powershell
npm install
npm run install:all
npm run dev
```

Backend tự chạy `prisma migrate deploy` trước khi phục vụ. Tiếp tục sử dụng `.env` và cấu hình database/SMTP hiện tại. Trong quy trình triển khai khóa dependency có thể dùng `npm ci` riêng tại root, BackEnd, AIService, FrontEnd thay cho install.

## Kiểm chứng bàn giao

Kết quả cuối được lưu trong các tệp bằng chứng dưới đây. Các dòng lỗi giả lập AI/SMTP/audit trong log là fault injection có assertion, không được tính là test pass nếu handler không trả kết quả mong đợi.

| Kiểm tra | Kết quả |
| --- | --- |
| `npm test` | **263/263**: AIService 21, backend 179, frontend 63; không fail/skip/cancel. |
| `npm run test:e2e` | 7/7, không pageerror; Edge headless, PostgreSQL tạm, AIService nội bộ chạy HTTP thật. |
| `npm --prefix FrontEnd run lint` | Không lỗi/cảnh báo. |
| `npm --prefix FrontEnd run typecheck` | Qua. |
| Production build | Qua; entry khoảng 478.54 kB, không cảnh báo chunk lớn hơn 500 kB. |
| `npm audit` root/BackEnd/FrontEnd/AIService | 0 vulnerabilities trong cả bốn package tại thời điểm chạy. |
| OpenAPI/manifest/link và `git diff --check` | Qua: 86 paths / 111 operationId không trùng, 114 hash nguồn đúng, link báo cáo tồn tại. |

Bằng chứng: [unit/integration/UI](test-evidence/2026-10-30-hoang-anh-sprint3-tests.txt), [E2E đầy đủ và build](test-evidence/2026-10-30-hoang-anh-sprint3-e2e.txt), [E2E Sprint 3 và ảnh cuối](test-evidence/2026-10-30-hoang-anh-sprint3-e2e-focused.txt), [lint](test-evidence/2026-10-30-hoang-anh-sprint3-lint.txt), [typecheck](test-evidence/2026-10-30-hoang-anh-sprint3-typecheck.txt), [audit](test-evidence/2026-10-30-hoang-anh-sprint3-audit.json).

Ảnh giao diện: [planner](screenshots/2026-10-30-hoang-anh-sprint3-planner.png), [risk desktop](screenshots/2026-10-30-hoang-anh-sprint3-risks.png), [risk mobile](screenshots/2026-10-30-hoang-anh-sprint3-risks-mobile.png), [biên bản họp](screenshots/2026-10-30-hoang-anh-sprint3-meeting.png).

Các ca mới đáng chú ý: hai tab nhận 409 và giữ nội dung; năm request approve đồng thời; lỗi audit rollback sequence/task/draft; giới hạn số người; schema AI lỗi không tạo dữ liệu; overdue đúng biên mili giây; capacity bằng 0; dismiss thiếu lý do/sai nguồn; nguồn không liên quan không mở lại; nguồn liên quan/ngưỡng đổi mở lại; reopen tab cũ không xóa lần xử lý mới; report bị invalidate bởi risk resolution và giữ nguyên snapshot; phản hồi UI muộn không ghi nhầm project.

Để review với mentor: nhập mục tiêu ở `/ai/planner`, sửa/chọn/người nhận rồi duyệt; mở `/risks`, xem nguồn và nhập lý do xử lý, sau đó sửa task để thấy alert xét lại; mở `/ai/report` để xem snapshot; luồng Should ghi chú họp tại `/ai/meeting`. Những kiểm thử đã chạy không chứng minh hệ thống không thể còn lỗi trong mọi môi trường hoặc mọi dữ liệu.
