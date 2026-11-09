# Sprint 3 — Nguyễn Bảo Lộc

> Mới nhất 09/11: [bàn giao kỹ thuật, bộ chạy 70 ca U025 và công cụ chấm](COMPLETION_2026-11-09.md). Các mô tả “chưa chạy 70 ca” dưới đây là lịch sử ngày 08/11; nghiệm thu độc lập vẫn pending.

> Hồ sơ dưới đây là lịch sử ngày 05/11. Bản hợp nhất và sửa lỗi, chốt ngày 07/11, được ghi tại [COMPLETION_2026-11-07.md](COMPLETION_2026-11-07.md). Contract báo cáo mới dùng end exclusive; các mô tả inclusive bên dưới chỉ áp dụng bản cũ.

> Cập nhật U025-T0 ngày 08/11: [artifact phát triển 40+10+20, rubric/chấm đôi và dữ liệu cần người giữ đề cung cấp](U025_T0_2026-11-08.md). Đã kiểm cấu trúc/hash; chưa chạy bộ ca, chưa có bộ kín hoặc điểm người chấm, chưa đóng task.

Bàn giao mã nguồn local ngày 05/11/2026 trên nhánh `Loc`, nền Git `516c38c`. Phạm vi theo yêu cầu người dùng: hoàn thiện mã nguồn và kiểm thử Sprint 3 của Lộc; Excel dùng làm tài liệu đối chiếu, không sửa trạng thái kế hoạch hay ký nghiệm thu thay thành viên.

Nguồn phân công: `D:/Downloads/DN26_CPL_Mock_Project_Nhom24.xlsx`, sheet **Detail Plan**, các dòng bên dưới; quy tắc và cách đánh giá từ **Process!B250:B270**. Sprint 3 trong kế hoạch là 16–29/11/2026; ngày bàn giao này là ngày thực hiện kỹ thuật, không phải khẳng định sprint đã tổ chức/xong nghiệm thu.

## 1. Phạm vi và truy vết

| Task / dòng Detail Plan | Vai trò Lộc | Kết quả kỹ thuật | Reviewer kế hoạch |
|---|---|---|---|
| U022-T3 / 103 | Thực hiện | 20 dataset báo cáo cố định, mở nguồn qua HTTP/UI, snapshot sau reopen, thu hồi quyền, provider trả sai số hoàn thành | Nguyễn Hữu Tấn Đạt |
| U026-T3 / 116 | Thực hiện | 20 ca biên luật rủi ro; rule/source/snapshot; dùng thêm regression sourceVersion/dismiss/cycle có sẵn | Hoàng Thị Hải Như |
| U027-T1 / 117 | Thực hiện, Should | Biên bản đầy đủ 30.000 ký tự, nguồn có hash và vị trí, người/hạn mơ hồ để trống, chung CAS/apply với planner | Nguyễn Hữu Tấn Đạt |
| U028-T1 / 120 | Thực hiện, PIC U028, Should | Admin API kiểm lại phiên; khóa/force logout chặn API, socket và AI đang chạy; audit nguyên tử; sửa xử lý lỗi UI liên quan | Nguyễn Khoa Hiệp |
| U023-T3 / 106 | Review kỹ thuật | 429/500/503 upstream, không ghi secret vào response/log, CRUD độc lập; regression quota đồng thời/timeout có sẵn | Lộc xác nhận độc lập khi nghiệm thu |
| U024-T2 / 108 | Review kỹ thuật | Regression UI giữ draft, retry, quyền; E2E report → nguồn và admin → khóa/mở; toàn bộ E2E cộng tác | Lộc |
| U025-T0 / 113 | Review phương pháp | Đối chiếu protocol hiện có: chưa có bộ nghiệm thu kín 70 ca có version/hash/đáp án trong checkout; chưa thể ký đạt gate này | Lộc / Hiệp chuẩn bị bộ kín |
| U026-T1 / 114 | Review kỹ thuật | Luật DB chạy độc lập AI report, version ngưỡng, snapshot theo nguồn; không gọi đây là ML | Lộc |
| U026-T2 / 115 | Review kỹ thuật | Lý do xử lý, link task, sourceVersion, nguồn đổi thì mở lại; E2E Hoàng Anh Sprint 3 có sẵn | Lộc |
| U027-T3 / 119 | Review kỹ thuật | 22 ghi chú có kỳ vọng cố định, kiểm tra provider trích thiếu ngữ cảnh, nguồn lặp và duyệt đồng thời | Lộc |
| U028-T3 / 122 | Review kỹ thuật | Chặn tự cấp quyền, khóa Owner giữ membership, không đọc project riêng, unlock không hồi sinh phiên; audit rollback | Lộc |

U027/U028 được đánh dấu Should chưa vào baseline trong Excel, dù mã nguồn đã có các luồng này. Đợt này hoàn thiện kỹ thuật các luồng đang có theo yêu cầu; không thay quyết định nhận Should, giờ thực tế hoặc trạng thái Excel. PIC không đồng nghĩa tác giả toàn bộ story.

## 2. Thay đổi nghiệp vụ

### Báo cáo U022

- `stats.done` đếm task cấp cao đang Done, có `completedAt` thuộc kỳ; Review, task mở lại và task xóa mềm không được tính hoàn thành. `doneTotal/totalTasks` là hiện trạng toàn dự án, không cộng task con lần hai.
- `overdue/blocked` là hiện trạng tại `generatedAt`, không tuyên bố tái dựng backlog lịch sử. `stats` và `generatedAt` không bị ghi lại khi chỉnh phần chữ hoặc khi nguồn đổi.
- Tóm tắt định lượng do backend dựng từ chính các chỉ tiêu DB. Provider trả “đã hoàn thành 9999 việc” không thể thay tóm tắt hoặc số liệu. Đề xuất AI vẫn có nhãn và cần PM xem xét; chưa chứng minh chất lượng nhận định của nhà cung cấp thật.
- Citation của tóm tắt bao gồm task trong mẫu số; nguồn rủi ro dùng cho đề xuất cũng có trong `sourceTasks`. Mỗi lần mở report/task vẫn kiểm ACL; sau revoke nhận 404. Task xóa được bỏ khỏi link, snapshot vẫn giữ nguyên và báo nguồn thay đổi/thiếu.
- Giữ contract hiện có: ngày `from/to` bao gồm hai ngày theo `Asia/Ho_Chi_Minh`, `to` ở cuối ngày đến mili giây. Timestamp có offset giữ nguyên instant. Đây tương đương khoảng `[đầu ngày, đầu ngày kế tiếp)` trên độ chính xác mili giây của hệ thống; API chưa chuyển sang `period_end` exclusive hoặc timezone riêng mỗi project. Không đổi contract âm thầm.

Mã: `BackEnd/src/services/ai/report.js`, `BackEnd/src/routes/ai.js`, `BackEnd/src/services/ai/contracts.js`.

Khi mở mục **Đang bị chặn**, PM có thể mở cả công việc bị chặn và công việc đang chặn nó, kể cả khi nguyên nhân là một việc con. Liên kết công việc được đối chiếu với dự án sở hữu từng bản ghi. Ca tích hợp cố tình lưu một liên kết sang dự án khác rồi kiểm tra kết quả tổng quan, nội dung gửi AI, nguồn hỏi đáp, chi tiết công việc, báo cáo đã lưu và danh sách báo cáo. Phần **Đang chậm** hiển thị số ngày 24 giờ đã qua trọn vẹn. Ví dụ, trễ 47 giờ 59 phút hiển thị 1 ngày.

### Rủi ro U026

- Overdue: `now > dueDate` và đủ `overdueDays`; đúng deadline không quá hạn. Dependency blocked-risk hiện theo luật “bị chặn bởi việc quá hạn chưa Done”, khác với cờ blocked của task khi bất kỳ dependency chưa Done.
- Overload: tải task lá chưa Done/xóa, có hạn trước cuối tuần, so với capacity. `remainingHours=0` là số 0 thật; thiếu estimate được đếm riêng. Capacity tuần không có bản ghi dùng `membership.weeklyHours` và ghi nguồn `default`; trường này bắt buộc, mặc định schema 20 giờ. Capacity tuần/null không bị tự biến thành 0. Bộ test K17 kiểm rõ chính sách hiện có này, không giả có nullable capacity trong DB.
- Bằng đúng ngưỡng không quá tải; capacity 0 còn việc thì quá tải, tỷ lệ không xác định. Task cha có con không cộng trùng vào tải.
- Mỗi cảnh báo có rule, task nguồn, snapshot, version ngưỡng và sourceVersion; không cần AI để sinh luật. Regression có sẵn kiểm dismiss, nguồn đổi, chu trình và API quyền; đợt này thêm 20 fixture độc lập có expected cố định.

Khi còn 9 giờ việc và có 10 giờ khả dụng, ngưỡng 80% tạo cảnh báo dù người nhận vẫn còn 1 giờ khả dụng. Phần giải thích nêu cả ba số và liên kết đến những việc đóng góp giờ. Việc còn 0 giờ hoặc thiếu ước lượng vẫn xuất hiện trong bảng tải nếu thuộc kỳ. Mã tính tải nằm trong `BackEnd/src/services/metrics.js`. Route dashboard kiểm lại phiên khi ghi xử lý cảnh báo và trước khi trả diễn giải AI.

### Ghi chú họp U027

1. PM dự án đang hoạt động gửi tiêu đề và biên bản. Danh sách gợi ý người nhận loại tài khoản khóa, workspace Viewer và project Viewer.
2. Dùng toàn bộ văn bản tối đa 30.000 ký tự theo API; bỏ cắt ngầm ở ký tự 15.000 khi gọi provider.
3. Tên trùng hoặc nhiều người được nhắc không tự chọn người đầu tiên. Có nhiều ngày/thứ/ngày tương đối thì hạn để trống để PM xác nhận. Câu hủy/phủ định không tạo action.
4. Mỗi item có excerpt nguyên văn và `sourceSpan={start,end}` theo vị trí UTF-16, zero-based, khoảng `[start,end)`, trên `draft.input.text` đã trim. `input.sourceHash` là SHA-256 UTF-8 của nguồn; `spanEncoding=utf-16` giải thích đơn vị vị trí. Emoji được kiểm thử.
5. PATCH chỉ cho sửa thuộc tính công việc/chọn/xóa mục; không cho sửa excerpt/sourceSpan/nguồn. Trước approve kiểm lại hash và excerpt. Nháp cũ chưa có hash/span vẫn kiểm excerpt trong nguồn gốc.
6. Duyệt dùng chung version CAS và transaction workspace của planner: task, sequence, audit và trạng thái nháp commit cùng nhau. Hai lần approve đồng thời chỉ tạo một task mỗi item. Task lưu `source=ai_meeting`, trích biên bản trong mô tả và `aiDraftItem` để truy lại nháp.
7. Trước commit kiểm lại phiên và quyền PM; người nhận không còn hợp lệ sẽ không được gán theo contract apply hiện có. Không gửi task trước khi duyệt.
8. Với “Lộc: gửi báo cáo cho Như”, Lộc là người làm. Nếu chỉ có “Gửi báo cáo cho Như”, ô người phụ trách để PM chọn. Ca “Lộc: Hoàng Anh sẽ viết API” giao đúng Hoàng Anh theo danh sách thành viên.
9. Với hai dòng giống nhau, bộ trích local lưu riêng vị trí từng dòng, kể cả sau emoji và xuống dòng Windows. Phản hồi provider có trích đoạn trùng nhiều vị trí bị từ chối. Nếu provider chỉ trích phần hành động của một việc đã hủy, cả dòng gốc được dùng để phát hiện phủ định.
10. Khi PM sửa tiêu đề hoặc nội dung biên bản, giao diện chuyển nháp cũ sang chỉ xem. PM có thể trích lại để có nháp mới hoặc khôi phục văn bản để tiếp tục duyệt nháp cũ. Có ca giao diện sửa ngay khi yêu cầu trích đang chờ trả về.

Mã: `AIService/src/features/meeting.js`, `BackEnd/src/services/ai/contracts.js`, `BackEnd/src/routes/ai.js`. Không cần migration: sourceSpan/input metadata dùng JSONB hiện có.

### Admin và thu hồi U028

- `requireAuth` kiểm user/session ở mỗi request; System Admin không thay project membership. Không có API tự nâng quyền qua profile hoặc lock payload.
- Admin mutation khóa các hàng user theo thứ tự ổn định, kiểm lại actor và session, rồi cập nhật user/session/audit trong cùng transaction. Lỗi audit rollback trạng thái khóa và thu hồi phiên.
- Lock/force logout thu hồi toàn bộ session và disconnect socket sau commit. Unlock chỉ mở tài khoản; cookie/refresh cũ vẫn vô hiệu, người dùng phải đăng nhập lại. Khóa Owner giữ workspace membership, không tự chuyển Owner hoặc cấp quyền đọc project cho System Admin.
- AI planner/meeting/report/Q&A/risk kiểm lại phiên sau thời gian chờ, bên trong transaction với user lock, cùng thứ tự với admin revoke. Thử nghiệm giữ AI response, khóa/logout rồi nhả response: 401, không trả nguồn cũ, không tạo draft/report/conversation, socket đã ngắt.
- Trang admin có lỗi/thử lại cho users/workspaces/audit/stats, trạng thái rỗng, không gọi admin API khi user thường. Chặn gửi lặp; modal khóa giữ lý do khi lỗi, không đóng trong lúc gửi và reset theo người được chọn.
- Hai yêu cầu khóa đồng thời với cùng tài khoản dẫn tới một lần chuyển trạng thái và một dòng audit. Gửi lại yêu cầu khi tài khoản đang khóa giữ lý do và thời điểm khóa đầu tiên. Mở khóa nhiều lần cũng chỉ ghi một lần chuyển trạng thái.

Mã: `BackEnd/src/middleware/auth.js`, `BackEnd/src/routes/admin.js`, `FrontEnd/src/pages/Admin.jsx`.

### Log AI U023 được review

Không ghi nguyên văn error/detail/model upstream vào lỗi DB hoặc console. Gateway lưu mã lỗi phân loại/HTTP status và latency; AIService không trả raw SDK error có thể chứa header/key/prompt. Upstream 429/500/503 trở thành lỗi tính năng AI 503, CRUD vẫn hoạt động; quota workspace riêng vẫn là 429. Chính sách retry giữ nguyên: timeout tối đa một retry, không tự retry mọi 5xx.

## 3. Kiểm thử và bằng chứng

**Bản bổ sung ngày 05/11/2026** đạt 394/394 ca trong cùng một lượt chạy, gồm 49 AIService, 255 backend và 90 frontend. Cả ba bộ có 0 lỗi và 0 ca bị bỏ qua. [Log đầy đủ](evidence/2026-11-05-followup-tests.txt). TypeScript và Vite build thành công. [Log build](evidence/2026-11-05-followup-build.txt). ESLint frontend trả mã thoát 0. [Log lint](evidence/2026-11-05-followup-lint.txt).

Edge headless đạt **10/10 E2E**, gồm sửa biên bản khi nháp đang mở, khôi phục nội dung rồi duyệt đúng số việc. Lượt đầu bộc lộ lỗi tìm ô nhập theo nhãn khi ô đã có nội dung. Sau khi gắn nhãn truy cập cố định, frontend được chạy lại 90/90, build, lint và cả 10 E2E đều đạt. [Log E2E cuối](evidence/2026-11-05-followup-e2e.txt) · [Log frontend cuối](evidence/2026-11-05-followup-frontend.txt) · [SHA-256 mã nguồn và log](evidence/manifest.json).

Các log dưới đây ghi lại đợt bàn giao đầu. Mỗi đợt chạy dùng database thử nghiệm riêng.

| Phạm vi | Bộ kiểm thử | Kết quả |
|---|---|---|
| Toàn hệ thống | [npm test](evidence/2026-11-05-tests.txt) | 377/377 = 38 AIService + 250 backend + 89 frontend |
| AIService sau ca tên lồng nhau cuối | [AIService final](evidence/2026-11-05-ai-final.txt) | 39/39, fail 0, skip 0 |
| Regression trình duyệt | [E2E toàn bộ](evidence/2026-11-05-e2e.txt) | 10/10, fail 0, skip 0 |
| Report mở nguồn và admin UI | [E2E focused final](evidence/2026-11-05-e2e-focused.txt) | 1/1; ảnh tắt animation đã xem kiểm tra |
| Socket và AI đang chờ | [Security sau bổ sung assertion socket](evidence/2026-11-05-security-final.txt) | 14/14, fail 0, skip 0 |
| API meeting sau parser cuối | [Meeting final](evidence/2026-11-05-meeting-final.txt) | 12/12, fail 0, skip 0 |
| Build + strict TypeScript | [Build](evidence/2026-11-05-build.txt) | Đạt |
| Frontend lint | [Lint](evidence/2026-11-05-lint.txt) | Đạt |

Test mới đặt tại `AIService/test/loc-sprint3.test.js`, `BackEnd/test/helpers/loc-sprint3.js` (đăng ký từ `api.test.js`), `BackEnd/test/ai-contracts.test.js`, `FrontEnd/test/loc-sprint3.test.js`, scenario Lộc Sprint 3 trong `test/e2e/sprint1.test.mjs`.

- R01–R20: rỗng, todo/in-progress/Review, Done sát hai biên kỳ, xóa, cha/con, reopen, quá hạn tại generatedAt, deadline chính xác, tương lai, blocker Done/xóa, mixed và Done thiếu timestamp.
- K01–K20: không hạn, Done/xóa, đúng deadline, trễ 1 ms, ngưỡng một ngày, tắt luật, dependency, capacity 0/đúng ngưỡng/vượt/thiếu estimate/default, task lá và biên 24 giờ.
- M01–M15: rõ người/hạn, thiếu người, trùng tên, nhiều người, nhiều ngày/thứ, phủ định/tạm dừng, ngày sai/thiếu tháng, không hạn, người ngoài, giao rõ, ngày tương đối mơ hồ, năm nhuận. Hai ca provider bổ sung kiểm biên bản dài và tên/hạn không có căn cứ; thêm ca tên ngắn nằm trong tên dài nhưng xuất hiện riêng phải tính là hai người.
- M16–M22 kiểm tra tên ghép, người nhận báo cáo, gửi hộ, câu dừng việc, đại từ “mình” khi có thành viên tên Minh và phủ định nằm trong tiêu chí của một việc vẫn cần thực hiện.
- Các fault injection (schema, upstream, audit) chủ động gây lỗi và assert rollback/503, không phải lỗi chưa xử lý khi test đạt. Log trước sửa contract giữ tại `2026-11-05-contract-before.txt`; log focused đầu tiên có failure giả lập audit do harness chưa intercept transaction, đã sửa harness và retest trong toàn bộ suite/final security.

Các suite dùng PostgreSQL/uploads tạm và AI local hoặc HTTP fixture, không dùng DB dev, không gọi provider trả phí. E2E dùng Microsoft Edge headless. Sandbox Windows không chạy được pg_ctl nên các suite tích hợp chạy ngoài sandbox, vẫn giữ database tạm riêng.

## 4. Gate còn cần người phụ trách

| Hạng mục | Trạng thái thực tế |
|---|---|
| Reviewer xác nhận 4 task trực tiếp của Lộc | Chưa có chữ ký/ngày xác nhận từ Đạt, Như, Hiệp |
| U025-T0 bộ kín 40 có đáp án + 10 ngoài nguồn + 20 ACL/injection | Chưa có artifact kín kèm hash và đáp án trong checkout. Chỉ thấy protocol `docs/validation/NHU_EVALUATION_UAT.md` |
| Hai người chấm độc lập / ≥90% nhận định có nguồn / meeting precision ≥85% | Chưa chạy đánh giá độc lập với provider thật; regression phát triển không thay thế các chỉ số này |
| Demo 3 người, staging, CI remote | Chưa có bằng chứng của lượt này |
| Commit/push/merge | Thay đổi nằm ở working tree `Loc`; lượt này không commit/push/merge |

Hướng dẫn review U025-T0: Hiệp giữ bộ nghiệm thu ở nơi chỉ người chấm truy cập; lưu version/hash/đáp án trước chỉnh prompt. Bảng metadata chia sẻ chỉ chứa ID, loại ca, hash, rubric và người giữ đề; không gửi đáp án vào tập phát triển. Chạy trên build/model/prompt version cố định, giữ output và cả ca lỗi, hai người chấm trước đối soát. Việc Lộc rà soát quy trình không được ghi thành kết quả chạy bộ kín. Tham khảo [protocol đánh giá](../validation/NHU_EVALUATION_UAT.md).

## 5. Chạy lại

Từ thư mục gốc repository:

```powershell
npm test
npm run build
npm --prefix FrontEnd run lint
node --test --test-concurrency=1 test/e2e/sprint1.test.mjs
```

Chạy nhanh phần mới:

```powershell
node --test AIService/test/loc-sprint3.test.js BackEnd/test/ai-contracts.test.js
node --test --test-name-pattern="Sprint 3" BackEnd/test/api.test.js
node --test --test-name-pattern="báo cáo mở nguồn thật" test/e2e/sprint1.test.mjs
```

OpenAPI và source manifest đã sinh lại bằng `node scripts/generate-contract-docs.mjs`. [Kịch bản demo và expected](DEMO.md).
