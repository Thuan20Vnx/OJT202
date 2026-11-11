# Hoàng Anh — Sprint 4: code và minh chứng (03/11/2026)

Đã cập nhật nhánh `HAnh` từ `main` tại `b7c972bc7e657a1d2f3b612fb7fff8571634bdce` trước triển khai. Bàn giao phần code, công cụ và kiểm chứng kỹ thuật theo yêu cầu “chưa có dữ liệu thật, làm code trước”. Không tự ghi các công việc cần người/URL thật là Done.

Nguồn: `D:/Downloads/TaskFlow_Nhom24_SuaLoiNgay.xlsx`, sheet `Detail Plan` dòng 92–115 và `AI & Evaluation` dòng 5–16. SHA-256 workbook `2CCB16AD3C60E81163B76424691A88F9B166B5CB5DC8AC6CB8282FB75C2C28C7`; không sửa workbook.

## Phần trực tiếp phụ trách

| Task | Phần code hoàn thiện | Phần cần nghiệm thu thực tế |
| --- | --- | --- |
| U029-T3, dòng 94 | Runner planner/report/Q&A/risk qua API HTTP; version/hash pack, source/prompt/data và môi trường; output từng ca; 30 request/feature giữ cả lỗi; lưu đầy đủ hai bộ điểm độc lập, điểm từng task, bất đồng và adjudication. Report gắn hash output, thay output phải chấm lại. | Bộ đề nghiệm thu kín, hai người chấm và baseline 6 người chưa có. |
| U032-T3, dòng 103 | Tính đúng 6×5=30, chống trùng/bỏ ca/lệch build, assisted không tính thành công; thiếu dữ liệu giữ rate=null; balanced crossover, median thời gian/chất lượng/lỗi; retest độc lập mới nhất điều khiển blocker. | Chưa có 30 lượt người thật; không tạo giả participant hoặc tỷ lệ thành công. |
| U033-T2, dòng 105 | Probe HTTPS/build/origin/cookie/reload/assets/API; sửa asset thiếu trả 404, HTML no-store và CSP/Origin production. Cookie Secure/HttpOnly/SameSite/path được kiểm, token không đi vào report. | Smoke local đạt; chưa có URL production và tài khoản test riêng. |
| U034-T3, dòng 109 | Copy snapshot source vào thư mục tạm, npm ci cả bốn package, build/typecheck và test công cụ; log/hash và cleanup path an toàn. | Tự động cài sạch đạt; còn cần một thành viên khác cài và đối chiếu chức năng thật. |
| U035-T1, dòng 110 | Demo DB/uploads tạm, >=2 workspace/3 project/50 task, role PM/Member/Viewer; reset bằng stop/restart; chế độ quota/offline; protocol 10–12 phút chỉ dùng Must. | Chưa ghi nhận buổi diễn tập hai người hoặc bản ghi dự phòng. |
| U036-T3, dòng 115 | Gate theo từng evidence file/SHA-256/build; kiểm điểm AI/UAT/bảo mật/50VU-10k/restore/HTTPS/cài độc lập/demo; chặn tag final nếu thiếu hoặc không đạt; known issues cần phân loại. | Giữ trạng thái pending, không tạo tag final khi chưa đủ bằng chứng. |

Các task được giao review: U029-T1/T2 (dòng 92/93), U032-T1/T2 (101/102), U033-T3 (106), U035-T3 (112), U036-T1/T2 (113/114). Đã đối chiếu protocol của Như, phân công/acceptance Excel và bổ sung kiểm tra máy đọc được. Không ký thay reviewer hoặc coi công cụ tự động là người dùng UAT.

## Sửa trực tiếp trong ứng dụng

- `AiCall`: thêm queuedAt/finishedAt/provider/attempts/usageComplete. Đo từ trước chờ workspace lock, giữ từng attempt và token null nếu timeout không trả usage. Lỗi lưu log không bị tính nhầm thành attempt provider thứ hai. Quota/disabled không gọi provider, usage bằng 0 được xác định rõ.
- API thống kê AI có p50/p95/sample count gồm các call đã kết thúc, cả lỗi/retry; log legacy thiếu timestamp không được giả thành mẫu mới. UI hiển thị token đã biết với dấu ≥ khi chưa đầy đủ, p95 và số mẫu. Không tính phí từ token chưa rõ.
- CSV log AI ghi provider/queue/finish/attempt count/usage completeness, private/no-store; vượt 10.000 bản ghi báo lỗi thay vì cắt âm thầm. Giữ quyền Owner/Admin và chống formula injection.
- Production: Origin sai bị chặn trước xử lý body; CSP cho source/realtime origin phù hợp; HTML reload không cache, hashed assets immutable, asset mất/đường dẫn tệp mất trả 404 thay vì HTML 200. Health liveness trả build từ RELEASE_SHA/RELEASE_SOURCE_HASH, chưa cấu hình thì null.
- Thêm regression cho timing queue, timeout/retry/unknown token, cookie cả `/api` và `/api/v1`, CSP/cache/asset/origin, UI token/p95, CSV và mobile. CI được cấu hình chạy development smoke riêng, không upload bộ đề kín; kết quả trong báo cáo này được chạy local.
- Cập nhật ESLint 10 + minimatch >=11.0.1 sau advisory mới; lint/typecheck/build/test và audit được kiểm lại. Không hạ compiler/linter để bỏ qua lỗi.

Migration: [20261103090000_ai_evaluation_telemetry](../BackEnd/prisma/migrations/20261103090000_ai_evaluation_telemetry/migration.sql). Không reset DB; log legacy giữ timestamp không rõ và usageComplete=false. Backend tự migrate trước phục vụ; generate Prisma sau pull. Cấu hình mẫu có RELEASE_SHA/RELEASE_SOURCE_HASH.

## Kết quả kỹ thuật đã chạy

| Kiểm tra | Kết quả thực đo |
| --- | --- |
| Application regression | AIService 21/21, backend 199/199, frontend 85/85; bổ sung 1 regression API biên CSV sau rà soát: **306 ca đều qua**, không skip/fail/cancel. |
| Validation tool regression cuối | **15/15**, gồm LF/CRLF, output tampering, giữ điểm gốc, missing data, denominator, retest, gate đủ/thiếu và HTTP production không hợp lệ. |
| Browser E2E | **10/10**, không pageerror; có screenshot desktop/mobile và tải CSV thật. |
| Lint / typecheck / production build | Qua, không lỗi/cảnh báo lint; entry khoảng 488.35 kB, không cảnh báo chunk >500 kB. |
| Cài sạch snapshot cuối | 6 bước npm ci×4, build/typecheck, validation tests đều qua trong thư mục tạm; chưa phải xác nhận bởi thành viên độc lập. |
| npm audit root/BackEnd/AIService/FrontEnd | Cả bốn đều 0 vulnerabilities tại thời điểm kiểm tra. |
| Development evaluation | **24/24** ca kỹ thuật, 120 request benchmark, 131 logical call AI có log; provider local. |
| Local production smoke | **17/17** checks; productionVerified=false vì là loopback. |
| Grade/UAT/release không có dữ liệu người thật | Trả pending đúng; chất lượng/lợi ích/rate UAT chưa có giữ null; release exit 2, không cho final. |
| Contract/hash/link | 90 paths, 117 operationId không trùng, 124 raw source hashes đúng; source identity chuẩn hóa LF, link báo cáo và 4 lockfile khớp. |

Lượt `npm test` đầy đủ đã chạy 14 validation tests + 305 application tests. Sau rà soát cuối bổ sung test chuẩn hóa source Windows/Linux, chạy lại bộ validation 15/15, thêm kiểm tra snapshot CSV trên 10.000 log và cài sạch trên source hash cuối. Các lỗi AI/SMTP/audit được in trong log là fault injection có assertion, không phải bỏ qua test lỗi.

### Benchmark local, không phải latency mô hình trả phí

| Feature | Request | Lỗi HTTP/mạng | p95 (ms) |
| --- | ---: | ---: | ---: |
| Planner | 30 | 0 | 145.29 |
| Report | 30 | 0 | 212.76 |
| Q&A | 30 | 0 | 135.91 |
| Risk explanation | 30 | 0 | 180.89 |

Đo HTTP toàn request, concurrency 1, provider nội bộ, cấu hình CPU/RAM/Node/network/cache trong raw report. Không dùng các số này để công bố chất lượng Anthropic hoặc đạt U031 50 user/10.000 task. Không loại request lỗi khỏi công thức p95. Chi phí chưa xác định, không khai có tiết kiệm tiền hoặc thời gian người dùng khi chưa có baseline.

Source hash cuối: `c89293c97667e18afd091f88acad57cb9e014b7c1eb88ada98d11dada079603b` (`sha256-lf-v1`). Hash chuẩn hóa CRLF/LF cho source UTF-8, giữ bytes fixture binary; không chuẩn hóa output AI/bằng chứng. Run được đo trước commit nên dirty=true được giữ nguyên trong log; không sửa ngược metadata để giả là final. Cài sạch và benchmark cuối có cùng source hash.

## Bằng chứng và thao tác tiếp theo

- [Test ứng dụng/toàn bộ lượt chạy](test-evidence/2026-11-03-hoang-anh-sprint4-tests.txt), [15 validation regression cuối](test-evidence/2026-11-03-hoang-anh-sprint4-validation-tests.txt), [biên CSV trên 10.000 log](test-evidence/2026-11-03-hoang-anh-sprint4-export-boundary.txt), [E2E/build](test-evidence/2026-11-03-hoang-anh-sprint4-e2e.txt), [lint](test-evidence/2026-11-03-hoang-anh-sprint4-lint.txt), [typecheck](test-evidence/2026-11-03-hoang-anh-sprint4-typecheck.txt), [audit](test-evidence/2026-11-03-hoang-anh-sprint4-audit.json).
- [Cài sạch với log từng bước](test-evidence/2026-11-03-hoang-anh-sprint4-clean-install.json), [raw evaluation/output/attempts](test-evidence/2026-11-03-hoang-anh-sprint4-ai-run.json), [smoke local](test-evidence/2026-11-03-hoang-anh-sprint4-smoke-local.json), [UAT pending](test-evidence/2026-11-03-hoang-anh-sprint4-uat.json), [grade pending](test-evidence/2026-11-03-hoang-anh-sprint4-ai-quality.json), [gate pending](test-evidence/2026-11-03-hoang-anh-sprint4-release-readiness.json).
- [Ảnh desktop](screenshots/2026-11-03-hoang-anh-sprint4-ai-desktop.png), [ảnh mobile](screenshots/2026-11-03-hoang-anh-sprint4-ai-mobile.png), [OpenAPI](design/openapi.json), [ERD](design/ERD.md), [manifest source ứng dụng](design/source-manifest.json).
- [Lệnh chạy và schema input đầy đủ](validation/SPRINT4_RUNBOOK.md), [đối chiếu Asana/Jira-Rovo/Linear và advisory](validation/SPRINT4_RESEARCH.md).

Known issues kỹ thuật phát hiện trong phạm vi thay đổi đã có hồi quy và không còn lỗi ở các lượt kiểm tra trên. Các gate chưa đủ bằng chứng không được phân loại nhầm là “đã đạt”: bộ kín/hai người chấm/baseline/UAT, URL HTTPS thật, security report theo build, 50VU/10k/restore, cài độc lập và rehearsal còn phải nghiệm thu. Không tạo tag final hoặc đổi workbook sang Done.
