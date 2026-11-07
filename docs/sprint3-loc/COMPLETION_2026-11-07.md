# Hoàn thiện kỹ thuật Sprint 3 của Lộc — chốt 07/11/2026

**Đã sửa các lỗi được phát hiện, hợp nhất main và hoàn tất kiểm thử kỹ thuật local.** Bản cuối đạt 469/469 test, 13/13 E2E và 5/5 ca tái hiện lỗi của lượt review. Đây là hồ sơ bàn giao mã để nhóm review; chưa thay thế nghiệm thu độc lập, CI remote hoặc xác nhận triển khai thật.

Đợt sửa và kiểm thử chạy ngày 06/11; hồ sơ được chốt ngày 07/11 theo Asia/Saigon. Giữ tên thư mục bằng chứng `completion-2026-11-06` đúng đợt chạy, không đổi ngày log. Bảng Excel gốc không bị chỉnh trạng thái hoặc tên reviewer.

## Bản bàn giao

- Nhánh: `Loc`.
- Bản trước tích hợp đã được bảo toàn tại commit `be7692e`.
- Commit mã đã kiểm thử: **`3857d7377a0ede27b3f745319cfc7d670f41aeb5`**.
- Đã hợp nhất `origin/main` tại `8654d8fa3a811f0a347606099a0d3deb44ece8eb`, giữ toàn bộ lịch sử main.
- Source SHA-256 (`sha256-lf-v1`): `37f446c9d1992ccbb0e216635fa1a8687378149f9d882b589600483f642b1410`.
- Prompt SHA-256: `8cfd6b9adb4d3f9eb1a3c37e2c8eea77dc8ac74430c6d2fcec69dae23317804b`.
- Lượt đánh giá bắt đầu từ working tree sạch, Node `v24.15.0`. Commit hồ sơ sau đó chỉ bổ sung tài liệu/bằng chứng, không thay mã đã test. Chưa push hoặc triển khai remote trong đợt này.
- [Manifest bằng chứng](evidence/completion-2026-11-06/manifest.json) lưu SHA-256 từng log, ảnh và kết quả. File văn bản được chuẩn hóa LF khi tính hash để kiểm chứng ổn định trên Windows/Linux; ảnh tính theo byte gốc.

## Xử lý xung đột

| File | Kết quả ghép |
|---|---|
| `BackEnd/src/routes/tasks.js` | Giữ `RepeatableRead` và `db/tx` của Lộc; thêm contributor, daily-update count và `canComment` từ main. Truy vấn bổ sung dùng cùng transaction. |
| `BackEnd/src/services/ai/gateway.js` | Giữ log lỗi đã che nội dung nhạy cảm cùng telemetry từng attempt, token/provider và thời gian kết thúc. Latency thống nhất `performance.now()`, không trộn với `Date.now()`. Metadata model/provider của attempt lỗi không lưu chuỗi upstream tùy ý. |
| `test/e2e/sprint1.test.mjs` | Giữ scenario Lộc, nhóm delivery, bốn ngày công việc và Sprint 4; tổng cộng 13 E2E. Selector cuộn cũ trùng sau tích hợp được thay bằng `scrollIntoViewIfNeeded` trên ô tên công việc. |
| `docs/design/openapi.json`, `source-manifest.json` | Sinh lại từ source/generator đã ghép. ERD cũng sinh lại với migration mới; chuẩn hóa newline của schema, không đổi nghiệp vụ. |

Không còn unmerged entry hoặc conflict marker trong mã chạy. `git diff --check` đạt. Log conflict cũ trong hồ sơ review được giữ làm lịch sử, không phải conflict đang tồn tại.

## Sửa lỗi nghiệp vụ

### U022: kỳ báo cáo và snapshot

- API chuẩn nhận `period_start/period_end` dạng **[start,end)**. Task hoàn thành đúng `period_end` thuộc kỳ tiếp theo. Ca hai kỳ liền nhau trước sửa là `[1,1]`, sau sửa là **`[0,1]`**.
- Thêm `Project.timezone`, mặc định `Asia/Ho_Chi_Minh`; PM đang có quyền quản lý có thể sửa múi giờ hợp lệ. API từ chối timezone giả và người không có quyền.
- Giao diện vẫn chọn “Từ ngày / Đến ngày” bao gồm toàn bộ ngày cuối, nhưng chuyển request sang nửa đêm ngày kế tiếp theo lịch của dự án. Đã kiểm ngày DST 23 và 25 giờ.
- Alias `from/to` với ngày thuần giữ cách nhập cũ. Khi `to` là timestamp thì là biên exclusive. Không cho trộn hai cặp trường trong một request. OpenAPI nêu rõ hợp đồng này.
- Báo cáo mới lưu `timezone` và `periodConvention=exclusive-end`. Migration đánh dấu báo cáo có trước là `legacy-inclusive`, giữ nguyên stats/from/to/generatedAt và không tự gán timezone lịch sử chưa biết.
- Khi đổi timezone dự án, snapshot cũ vẫn giữ kỳ và timezone đã lưu, báo nguồn đã thay đổi. Nếu timezone đổi trong lúc tạo báo cáo, yêu cầu bị từ chối để tạo lại.
- 20 fixture report đã được sửa kỳ vọng đúng end exclusive. Có thêm ca API, frontend và kiểm nâng cấp database thật.

### U027: phủ định và hạn

- Giữ action trong “viết kiểm thử để người dùng không được tự cấp quyền admin”.
- Không sinh action cho “sẽ không kiểm thử API nữa”.
- “Thứ sáu tuần sau” tính theo tuần lịch bắt đầu thứ Hai, không lấy thứ sáu gần nhất của tuần hiện tại.
- “15/11/2026 hoặc ngày 16” để trống hạn; không đoán từ một phần câu. Khoảng tương đối chưa hỗ trợ cũng để trống.
- Kiểm cả nhánh local và phản hồi provider, biên Chủ nhật/cuối năm; vẫn giữ hash/span nguồn, tên mơ hồ và duyệt một lần.

### U026: capacity

- Dùng capacity tuần nếu đã khai báo; nếu không, dùng `membership.weeklyHours` đã cấu hình. Schema hiện có default 20 giờ, UI nay ghi rõ đang dùng mặc định của thành viên.
- Nếu thiếu cả hai nguồn, trả `available=null`, `capacitySource=missing`, tỷ lệ chưa xác định; không tạo mẫu số giả hoặc kết luận quá tải.
- Số 0 là giá trị thật, không bị thay thành default. Không khẳng định default 20 giờ là số giờ đã được người dùng đo/xác nhận thực tế.

## Kết quả xác nhận cuối

| Kiểm tra | Kết quả | Bằng chứng |
|---|---|---|
| Toàn bộ `npm test` | **469/469**, fail 0, skip 0: 15 validation +59 AIService +300 backend +95 frontend | [tests.txt](evidence/completion-2026-11-06/tests.txt) |
| Typecheck + Vite build | Đạt | [build.txt](evidence/completion-2026-11-06/build.txt) |
| ESLint frontend | Đạt | [lint.txt](evidence/completion-2026-11-06/lint.txt) |
| Edge headless E2E | **13/13**, fail 0, skip 0 | [e2e.txt](evidence/completion-2026-11-06/e2e.txt) |
| Chạy nguyên vẹn 5 ca từng phát hiện lỗi | **5/5**, không đổi expected để làm xanh | [review-probes.txt](evidence/completion-2026-11-06/review-probes.txt) |
| Migration nâng dữ liệu cũ | Đạt; giữ nguyên nội dung/số liệu/thời điểm report lịch sử | Trong full suite; [retest riêng](evidence/completion-2026-11-06/migration-retest.txt) |
| AI development local | **24/24** ca; 30 request/feature, không lỗi HTTP/mạng trong 120 request benchmark | [Báo cáo](evidence/completion-2026-11-06/ai-evaluation.md), [input/output và hash](evidence/completion-2026-11-06/ai-run.json) |
| Production-mode smoke local | **17/17** checks, `productionVerified=false` | [local-production-smoke.json](evidence/completion-2026-11-06/local-production-smoke.json) |

Các kiểm tra dùng database/uploads tạm riêng, không dùng dữ liệu dev và không gọi provider trả phí. p95 local của planner/report/Q&A/risk lần lượt khoảng 35/62/60/59 ms; chỉ phản ánh provider nội bộ qua loopback, **không** là benchmark nhà cung cấp thật hoặc tải 50 người dùng.

Build có cảnh báo chunk JavaScript chính khoảng 533 kB chưa nén (163 kB gzip), không làm build thất bại. Typecheck áp dụng cấu hình JS/TS hỗn hợp hiện có, không có nghĩa toàn bộ JavaScript cũ đã được chuyển sang strict TypeScript.

Lượt đầu sau hợp nhất có hai lỗi test: fixture migration chưa tạo report lịch sử, selector cuộn E2E trùng. Đã sửa fixture/selector, giữ assertions nghiệp vụ, chạy retest và toàn bộ suite cuối. Giữ log `*-first.txt` để truy vết. Các dòng simulated audit/SMTP/storage error trong log cuối là fault injection đã được assert, tổng suite không có failure.

Ảnh E2E mới: [mở nguồn báo cáo](evidence/completion-2026-11-06/report-source.png), [khóa tài khoản](evidence/completion-2026-11-06/admin-lock.png).

## Trạng thái nhiệm vụ của Lộc

| Task | Bàn giao kỹ thuật | Reviewer / phần người thật còn cần |
|---|---|---|
| U022-T3 | Đã sửa F1, đủ fixture và hồi quy nguồn/quyền/biên kỳ | Nguyễn Hữu Tấn Đạt review; cần chấm >=90% nhận định có nguồn theo rubric |
| U026-T3 | 20 ca luật đạt; bổ sung policy capacity và test missing/0/default | Như xác nhận |
| U027-T1 | Đã sửa F2/F3, giữ source/hash/span và apply transaction | Nguyễn Hữu Tấn Đạt review nếu nhóm nhận Should |
| U028-T1 | Lock/unlock/logout, deny, revoke, audit và E2E đạt sau merge | Hiệp review nếu nhóm nhận Should |
| U023-T3 (review) | Fault 429/5xx, redaction, quota/timeout và telemetry sau merge đạt | Lộc xác nhận review của mình |
| U024-T2 (review) | UI/API/E2E trên bản hợp nhất đạt | Lộc xác nhận; demo/feedback người thật thuộc nghiệm thu nhóm |
| U025-T0 (review) | Protocol và công cụ version/hash/đóng băng/chấm đã có, đã chạy thử development | **Chưa thể đóng** khi chưa có bằng chứng bộ kín do Hiệp giữ trước tinh chỉnh |
| U026-T1/T2 (review) | Rule/source/snapshot, dismiss/reopen và E2E đạt | Lộc xác nhận review |
| U027-T3 (review) | Đã bổ sung ca còn thiếu vào suite chính; cả 4 lỗi review đã hết | Lộc review; precision độc lập nếu chọn Should |
| U028-T3 (review) | Quyền admin, khóa Owner, session/socket và rollback đạt | Lộc xác nhận review |

Các reviewer trong bảng là người được phân công, chưa phải xác nhận đã nghiệm thu. Không có chữ ký nào được tạo thay thành viên.

U027/U028 vẫn được ghi Should trong Excel; triển khai và kiểm thử kỹ thuật không tự sửa quyết định nhận vào baseline. Nếu nhóm không chọn, ghi Không áp dụng ở nghiệm thu, không ghi 0 điểm. Nếu chọn, sử dụng các kết quả kỹ thuật và chấm thêm theo rubric.

## Bàn giao và chạy lại

Trên máy mới dùng Node >=24.15.0, giữ cả lockfile/shared/migrations và cài từ repository root:

```powershell
npm ci
npm --prefix BackEnd ci
npm --prefix AIService ci
npm --prefix FrontEnd ci
npm test
npm run build
npm --prefix FrontEnd run lint
node --test --test-concurrency=1 test/e2e/sprint1.test.mjs
```

Backend áp dụng migration `20261106090000_report_period_timezone` khi khởi động/kết nối DB. Không dùng `migrate reset` với dữ liệu thật. Bản đã được thử nâng cấp trên database tạm chứa báo cáo cũ. Hướng dẫn chạy ứng dụng ở [INSTALL](../design/INSTALL.md), demo từng tính năng ở [DEMO](DEMO.md).

Nhóm cần chốt ba phần ngoài kiểm thử kỹ thuật local:

1. Người phụ trách xác nhận task/review và lựa chọn Should; chạy demo với người thật, lưu feedback gắn commit mã.
2. Hiệp cung cấp metadata và quyền truy cập phù hợp cho bộ kín 70 ca (40 đáp án +10 ngoài nguồn +20 quyền/injection), version/hash khóa trước chỉnh prompt. Hai người chấm lưu điểm gốc và đối soát; không tái sử dụng development pack này để công bố nghiệm thu độc lập. Công cụ và schema có trong [runbook đánh giá](../validation/SPRINT4_RUNBOOK.md).
3. Nếu yêu cầu nộp gồm CI/staging/production: push/PR, CI remote và xác nhận trên môi trường thật. Các kiểm tra local không được gán thành kết quả triển khai remote.

[scores.json](evidence/completion-2026-11-06/scores.json) và [uat-input.json](evidence/completion-2026-11-06/uat-input.json) là mẫu gắn đúng build/output để người phụ trách tiếp tục, không chứa điểm hoặc người dùng giả. [Release readiness](evidence/completion-2026-11-06/release-readiness.json) giữ pending cho các gate nghiệm thu/vận hành chưa có bằng chứng; không tự đánh dấu toàn dự án ready-for-final từ kết quả của phần Lộc.
