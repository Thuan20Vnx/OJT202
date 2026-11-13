# Sprint 4 — chạy đánh giá, UAT và kiểm tra bàn giao

Các công cụ này phục vụ U029-T3, U032-T3, U033-T2, U034-T3, U035-T1 và U036-T3 của Hoàng Anh. Kết quả kỹ thuật không tự trở thành nghiệm thu người dùng.

## Cài và chạy

Node >=24.15.0. Từ root repo:

```powershell
npm ci
npm --prefix BackEnd ci
npm --prefix AIService ci
npm --prefix FrontEnd ci
npm --prefix mcp ci
npm run build
npm test
npm run test:e2e
npm run validate:local -- --out .data/validation/my-run-01
```

`validate:local` tạo PostgreSQL và uploads tạm, chạy AIService/API thật qua HTTP loopback, dùng provider nội bộ, rồi kiểm cấu hình production ở local. Không đọc `DATABASE_URL` hoặc reset DB phát triển/production. Kết thúc sẽ đóng server và dọn thư mục tạm có prefix riêng. Không chạy hai phiên demo/evaluation trong cùng Node process bằng cách import module thủ công.

Mỗi thư mục run chỉ được ghi một lần. Nếu trùng tên, dùng `--out` khác. `.data/` nằm ngoài Git; không commit bộ đề kín, output hoặc định danh người tham gia thật.

## U029: đo AI và chuẩn bị chấm độc lập

`validation/development-pack.mjs` là bộ **phát triển công khai**, có các ca planner/ACL/report/Q&A/risk và dữ liệu rỗng, Done, không hạn, capacity, cha/con, reopen. Không dùng kết quả bộ này để công bố độ chính xác nghiệm thu kín.

```powershell
npm run validate:ai -- --samples 30 --out .data/validation/ai-dev-01
```

Output:

`sourceHash`/`promptHash` dùng thuật toán `sha256-lf-v1`: chuẩn hóa CRLF thành LF cho source UTF-8, giữ bytes của fixture binary. Do đó checkout Windows/Linux cùng nội dung không bị kết luận nhầm là hai build; không chuẩn hóa hoặc sửa output AI hay file bằng chứng.

- `ai-run.json`: input/output nguyên bản, kết quả từng check, bộ đề/hash, dataset/hash/clock, Git revision, sourceHash, promptHash, model/provider và môi trường.
- `report.md`: bảng tử/mẫu kỹ thuật, p50/p95, lỗi và các phần chưa có kết quả.
- `scores.json`: bắt đầu với reviewer/rating/adjudication rỗng; `runHash` đóng băng toàn bộ output.
- `uat-input.json`/`uat.json`: mẫu dữ liệu máy đọc được và trạng thái chưa nghiệm thu, không có người dùng giả.
- `release-readiness.json`: các gate chưa có bằng chứng giữ `pending`.

30 request/feature được đo từ trước fetch đến sau đọc/parse response, gồm queue trong API, retrieval và retry. Giữ cả lỗi/timeout trong mẫu. Concurrency mặc định 1; đây không phải benchmark U031 với 50 user ảo. Gateway lưu `queuedAt`, `finishedAt`, từng attempt, provider/model và token đã biết/chưa biết. Retry tối đa một lần như hợp đồng hiện có. Unknown usage không có nghĩa là không bị tính tiền; chưa có bảng giá thì `cost=null`.

### Bộ nghiệm thu giữ kín

Người phụ trách bộ đề chuẩn bị JSON cùng schema với development pack, `split="acceptance"`, `version`, `fixtureVersion="taskflow-evaluation-fixture-v2"`, `frozenAt`, `frozenBy`; mỗi case có `id`, `feature`, `group`, `actor`, `method`, `path`, `body`, `expectedStatus`, `checks`, và `scenario` nếu cần. Scenario hỗ trợ: standard, empty, done, no-deadline, available-capacity, no-dependency, parent-child, blocker-done, reopened. Mỗi case reset precondition của 4 task trước khi chạy, không sửa prompt từ đáp án kín.

Các group bắt buộc: planner-schema=20, report-metrics=20, qa-answer=40, qa-refusal=10, qa-security=20, risk-rules=20. Bộ câu hỏi phải có chất lượng/độc lập thực tế; đủ số lượng không chứng minh đã đủ nội dung kiểm thử. Kiểm biên mili giây, cycle, thu hồi quyền giữa request và các lỗi kỹ thuật khác còn nằm trong regression backend/browser.

Giữ đề bên ngoài source được track hoặc trong `.data/`, đóng băng hash trước chỉnh prompt. Hash là SHA-256 JSON canonical của pack bằng hàm `hash` trong `scripts/validation/core.mjs`; không phải hash theo định dạng whitespace của file. Khi chạy phải truyền lại commitment đã đóng băng:

```powershell
npm run validate:ai -- --pack D:/private/acceptance-v1.json --expected-pack-hash <canonical-sha256> --out .data/validation/acceptance-01
```

Provider mặc định là local. Muốn đo Anthropic thật phải chủ động cung cấp key qua môi trường, giới hạn billing ở nhà cung cấp và truyền cả `--provider configured --max-paid-requests N`. N tối đa 10.000 và phải đủ số logical request đã lên kế hoạch; một logical request có thể có hai attempt bị tính phí. Không có giới hạn tiền tự động nếu chưa cung cấp đơn giá/hạn mức billing. Không dùng kết quả local làm kết quả của mô hình trả phí.

### Hai người chấm và đối soát

Giữ nguyên run/output, không sửa `runId`, `runHash`, `packHash`, `build`. Ghi `operator`, hai reviewer độc lập; mỗi `ratings` row có `caseId`, `reviewer`, `reason`, `criteria`:

- Mọi case: `correct` và `noLeak` là boolean.
- Planner thành công: `constraintsRespected`, `tasks` cùng số lượng/thứ tự task được sinh. Mỗi task có 5 boolean: scope, title, description, AC kiểm được, estimate có lý do.
- Report: `supported`/`total` nhận định đã được liệt kê theo rubric; không loại nhận định sai khỏi mẫu số.
- Q&A có đáp án: `supported`/`total` citation; total phải bằng toàn bộ citation được trả. Câu cần nguồn mà không có citation không tính là đúng.
- Khi khác điểm: giữ cả hai rating gốc; thêm `adjudications` theo case với người thứ ba khác hai người chấm và operator, criteria cuối và reason. Không tự chọn điểm cao hơn.

```powershell
npm run validate:uat -- --input .data/validation/acceptance-01/uat-input.json --out .data/validation/uat-scored-01
npm run validate:grades -- --run .data/validation/acceptance-01/ai-run.json --input .data/validation/acceptance-01/scores.json --uat .data/validation/uat-scored-01/uat.json --out .data/validation/graded-01
```

Hash output thay đổi, reviewer trùng, điểm thiếu, thiếu adjudication hoặc bộ phát triển không được nâng thành nghiệm thu. Các ngưỡng lấy từ Excel: schema >=18/20; task dùng được >=80%; report metrics 20/20, nhận định có nguồn >=90%; Q&A đúng >=32/40, refusal >=9/10, citation >=90%, quyền/injection 20/20 không rò rỉ; risk 20/20. Bất kỳ rò rỉ nào cũng không được giấu bằng tỷ lệ trung bình.

## U032: dữ liệu UAT và đối chứng

Trong `uat-input.json`, mỗi participant: id P01–P06, `relationship` external/developer, `experience`, `order` manual-first/ai-first. Công khai quan hệ với nhóm; không tự tạo người thử.

Mỗi trial: `participant`, `scenario` S1–S5, `build` đúng snapshot, `success`, `assisted`, `durationMs>0`, `errors` nguyên không âm, `observer` khác participant, `actual`, `issueIds`. Đúng 6×5=30 tổ hợp không trùng. Assisted không được tính thành hoàn thành không trợ giúp. Kết quả thiếu giữ rate=null và mẫu số kế hoạch 30; >=27/30 mới đạt mục tiêu.

5 kịch bản theo [protocol của Như](NHU_EVALUATION_UAT.md): S1 tạo/giao/tìm việc; S2 Member Review, PM Done/reopen; S3 comment/mention/tài liệu; S4 AI preview/sửa/duyệt/report; S5 Q&A/citation/thiếu nguồn/quyền.

`comparisons`: mỗi người một cặp `manualMs`, `aiMs`, `manualErrors`, `aiErrors`, `manualQuality`/`aiQuality` 0..1, `rubricVersion`, `manualDataset`, `aiDataset`, `build`. Ba người manual A trước/AI B sau, ba người AI A trước/manual B sau. Cùng rubric; báo hai median, mục tiêu giảm thời gian >=30% và không giảm chất lượng/tăng median lỗi. Thiếu cặp hoặc lệch thiết kế không tính lợi ích.

`issues`: id, severity critical/high/medium/low, reportedBy, description. `retests`: issueId, reviewer độc lập với reportedBy, build, passed, notes, testedAt có timezone. Lần retest mới nhất điều khiển trạng thái; lỗi critical/high chưa retest đạt sẽ chặn. Nếu sửa sang build mới, phải ghi đúng build và chạy lại phần nghiệm thu bị ảnh hưởng; không gán nhãn build cũ cho số đo mới.

## U033: smoke trên URL thật

Production cần HTTPS, secrets/SMTP/database riêng, `SEED_DEMO=false`, proxy/origin đúng README. Không dùng mật khẩu demo public trên production. Đặt `RELEASE_SHA`, `RELEASE_SOURCE_HASH` từ identity của build đã triển khai:

```powershell
node scripts/validate-sprint4.mjs identity
# Cấu hình RELEASE_SHA/RELEASE_SOURCE_HASH ở môi trường triển khai theo kết quả trên.
# Cung cấp SMOKE_EMAIL/SMOKE_PASSWORD cho một tài khoản kiểm thử được cấp quyền.
npm run validate:smoke -- --url https://your-origin.example --out .data/validation/production-01
```

Probe kiểm health/build, API private/alias không trả SPA, reload HTML, cache, CSP, JS/CSS MIME/cache, asset mất 404, Origin/preflight và cookie Secure/HttpOnly/SameSite/path. Login/logout chỉ dùng tài khoản test được chủ động cung cấp; không sửa task. Không ghi password/cookie/token vào report. Thiếu tài khoản thì phần cookie pending. HTTPS/build sai hoặc checks lỗi thì không đạt. Local-production luôn `productionVerified=false`, không được dùng làm U033 đã đạt. Health đơn thuần là liveness; login/logout còn kiểm đường đi có DB, không thay restore/backup proof.

## U034: cài sạch

```powershell
npm run validate:install -- --out .data/validation/install-01
```

Copy snapshot source vào thư mục tạm đã kiểm path, bỏ `.env`, node_modules/dist/.data; chạy npm ci ở bốn package, build/typecheck và test công cụ. Lưu log/hash, dọn thư mục tạm. Đây là phép thử tự động. Task “một thành viên khác cài theo README” vẫn cần người thật xác nhận và đối chiếu chức năng; không đổi log tự động thành chữ ký của người khác.

## U035: demo 10–12 phút và reset

```powershell
npm run demo:sprint4 -- --out .data/validation/demo-01
# Tạo phiên khác để diễn tập lỗi (không trộn vào run nghiệm thu):
npm run demo:sprint4 -- --failure quota --out .data/validation/demo-quota-01
npm run demo:sprint4 -- --failure offline --out .data/validation/demo-offline-01
```

Mở URL loopback được in ra, chọn workspace `Sprint 4 - isolated validation` và project `Evaluation fixture v1`. Dùng hai trình duyệt/profiles cho Mai Anh (PM) và Như (Member), password demo từ seed; Viewer Khánh Linh chỉ đọc. Dataset có >=2 workspace, >=3 project, >=50 task; đây là dữ liệu demo, không phải người dùng UAT. Gõ `stop` hoặc Ctrl+C để dừng/reset; phiên tự đóng sau 30 phút. Restart luôn tạo database tạm mới. Không có lệnh reset production.

| Phút | Nội dung |
| --- | --- |
| 0–2 | Nêu mục tiêu/phạm vi, hai vai trò, dữ liệu demo và build. |
| 2–4 | Giao việc, hai người cộng tác/comment; Member không tự duyệt Done. |
| 4–7 | Planner preview: sửa/chọn/người nhận, chưa tạo task trước duyệt, approve lặp không tạo trùng. |
| 7–9 | Risk có nguồn/lý do, sửa nguồn để xét lại; report giữ số liệu snapshot. |
| 9–11 | Q&A mở citation và hỏi ngoài nguồn để từ chối; chỉ trình bày lợi ích nếu có U029/U032 thật. |
| 11–12 | Nêu lỗi/quota/mất mạng, CRUD vẫn dùng được; bản ghi dự phòng phải có nhãn và build, không giả là live. |

Không dùng meeting/admin nâng cao chưa chọn Should để thay tiêu chí Must.

## U036: gate trước final

```powershell
npm run validate:release -- --out .data/validation/readiness-01
```

Không có input sẽ tạo report pending, exit code 2. Khi đã có bằng chứng thật, manifest `schemaVersion=1` có `build`, `operator`, `knownIssues`, `evidence`. Mỗi evidence U029..U035 là `{ "path": "relative/report.json", "sha256": "SHA-256 raw bytes" }`; CLI kiểm file/hash rồi mới đánh giá, không tin một cờ passed rời rạc.

Gate yêu cầu: U029 điểm kín/2 người chấm/đối chứng/latency đủ; U030 đủ nhóm bảo mật và không critical/high; U031 50 user/10.000 task, p95 đọc <800ms và restore; U032 30 lượt; U033 HTTPS thật; U034 thành viên độc lập; U035 hai người cộng tác/10–12 phút/nguồn/bản ghi có nhãn. Tất cả cùng revision/sourceHash, working tree hiện tại sạch, known issues phân loại. Thiếu gate giữ pending, không tạo tag final tự động. Exit 0=đạt đủ gate, 1=lỗi/không đạt, 2=chưa đủ điều kiện release. Không commit secret, đáp án kín hay dữ liệu định danh người thử.
