# Hoàn thiện kỹ thuật Sprint 3 của Lộc — 09/11/2026

Phạm vi đã được người dùng chốt: **hoàn thiện kỹ thuật trước**, vì chưa có bộ đề kín U025 hoặc kết quả review/chấm của Đạt, Như, Hiệp. Hồ sơ này không ký thay reviewer, không đổi trạng thái Excel và không biến kết quả development thành nghiệm thu độc lập.

## Phần bổ sung

- Tạo adapter `scripts/validation/u025-run.mjs` chạy nguyên bộ **70 ca đã công bố ngày 08/11** qua HTTP API và AIService thật, PostgreSQL tạm riêng. Giữ nguyên pack, dataset và đáp án; không giảm expected để làm test đạt. Mỗi ca reset dữ liệu, quyền và hội thoại; ngày ứng dụng cố định 08/11/2026 để kiểm hạn. Không đọc/ghi Supabase, không dùng uploads thật, không gọi provider trả phí.
- Lưu đủ request/response, ánh xạ ID, snapshot nguồn, quyền trước/sau, truy vấn SQL không chứa bound credential, request gửi AI, nhật ký AI, citation và kết quả mở nguồn bằng đúng actor. S08/S09/S11 dùng barrier sau khi thu thập nguồn: thu hồi quyền/khóa tài khoản/sửa nguồn trước khi AI trả về. S18 có trace HTTP và chặn egress ngoài loopback; S19 kiểm trace SQL; S20 gây lỗi retrieval có chủ đích và kiểm không gọi AI/lưu câu trả lời giả.
- Sửa AI nội bộ bỏ mất mô tả/tiêu chí nghiệm thu khi cắt sau năm câu. Dữ kiện task được gửi bằng cấu trúc rõ ràng; đọc đúng người phụ trách, trạng thái, hạn, blocker, mô tả và tiêu chí.
- Câu hỏi tổng hợp dùng toàn bộ task đã lọc quyền, không lấy top-4 tìm kiếm để tính tổng. Hỗ trợ bộ lọc trạng thái, người phụ trách, chưa giao, thiếu hạn và quá hạn. Không trộn task xóa/ngoài dự án vào nguồn.
- Tìm nguồn theo mã công việc và tên tài liệu, giữ đủ đoạn có nhiều dữ kiện. Thiếu task hoặc thiếu chủ đề như ngân sách, số đăng ký thực tế, điện thoại, doanh thu, p95 thì từ chối; không lấy sức chứa/mục tiêu/file kết quả làm số đo thực tế.
- Nguồn dạng task, tài liệu và bình luận không được dùng làm chỉ dẫn. Bổ sung loại bỏ các chỉ dẫn vai trò nhận diện được khỏi phần trích của bộ quy tắc; prompt provider dùng JSON để chuỗi XML/nhãn nguồn không phá cấu trúc. Đây là lớp bổ sung, không thay kiểm quyền backend và không chứng minh chống mọi prompt injection với provider thật.
- Thêm `u025-grade.mjs`: biểu mẫu gắn đúng run/hash, kiểm toàn vẹn output, hai reviewer khác nhau/khác operator, đối soát bởi người thứ ba. Tính citation trên cả A/O/S, phân biệt độ phủ chấm đôi và đồng thuận; kết quả thiếu điểm luôn pending. Không điền tên/điểm/chữ ký giả. Bộ công cụ này chỉ chấm development; không bỏ gate acceptance 130 ca của hệ thống chung.

## Bằng chứng

Kết quả xác nhận cuối và nhận diện source được lưu trong thư mục [evidence/completion-2026-11-09](evidence/completion-2026-11-09). Xem `verification.json` và các log đi kèm để biết số lượng, trạng thái và lệnh thực chạy. Gói ZIP U025 chứa toàn bộ bằng chứng từng ca và biểu mẫu chấm còn trống, không chỉ bảng tổng kết.

| Kiểm tra trên bản cuối | Kết quả | Bằng chứng |
|---|---|---|
| Toàn bộ test | **503/503**, fail 0, skip 0: validation 21 + AIService 72 + backend 314 + frontend 96 | [tests.txt](evidence/completion-2026-11-09/tests.txt) |
| 70 tình huống U025 qua HTTP | **70/70 kiểm tra kỹ thuật**, 40 câu có nguồn +10 ngoài nguồn +20 bảo mật | [run.json](evidence/completion-2026-11-09/u025-run.json), [toàn bộ output và biểu mẫu chấm](evidence/completion-2026-11-09/u025-development-run.zip) |
| E2E Edge headless | **13/13**, fail 0, skip 0 | [e2e.txt](evidence/completion-2026-11-09/e2e.txt) |
| TypeScript và production build | Đạt; còn cảnh báo bundle chính >500 kB | [build.txt](evidence/completion-2026-11-09/build.txt) |
| ESLint frontend | Đạt | [lint.txt](evidence/completion-2026-11-09/lint.txt) |
| Nhận diện mã và toàn vẹn | Source hash của checkout khớp run U025 cuối; 152/152 hash source thiết kế khớp; `git diff --check` đạt | [verification.json](evidence/completion-2026-11-09/verification.json), [manifest.json](evidence/completion-2026-11-09/manifest.json) |

Nền Git `ec87c7a`, working tree có thay đổi chưa commit. Source hash LF chuẩn hóa: `8fad7136e75c5382aa758a2b93213af7822ac1083c55cde66a2083bebe333618`. Không dùng riêng hash HEAD để nhận diện bản code đã kiểm thử.

Lần chạy baseline U025 ghi 29/70 đạt và 41 ca không đạt. Trong đó S09 là lỗi **adapter** dùng lý do khóa tài khoản không thuộc enum, đã sửa về `Khác`; 40 ca còn lại bộc lộ các sai khác câu trả lời/nguồn nêu trên. Không quy cả 41 ca thành 41 lỗi sản phẩm. Lần xác nhận sau sửa chạy lại toàn bộ, không ghép các ca tốt từ nhiều lượt.

Các assertion tự động đối chiếu dữ kiện cố định, quyền và luồng HTTP. **70/70 kiểm tra kỹ thuật không có nghĩa chất lượng AI được hai người chấm 100%**, cũng không thay bộ kín. Bản mẫu chấm hiện có coverage=0, các chỉ số chất lượng/citation theo người chấm còn null. Dòng lỗi retrieval/SMTP/audit cố ý trong log là fault injection; đọc kết quả cuối suite để phân biệt lỗi thật.

## Chạy lại

Từ root `OJT202`, Node >=24.15.0, đã cài dependency:

```powershell
npm run validate:u025
npm test
npm run build
npm --prefix FrontEnd run lint
node --test --test-concurrency=1 test/e2e/sprint1.test.mjs
```

`validate:u025` tự tạo run mới trong `.data/validation/u025-<timestamp>`. Để đặt tên riêng dùng `npm run validate:u025 -- --out .data/validation/ten-run-moi`. Không dùng lại tên đã có `run-started.json`: bằng chứng không được ghi đè. Không cần tắt dev server, vì fixture dùng cổng ngẫu nhiên.

Chuẩn bị biểu mẫu chấm từ **đúng run** vừa chạy:

```powershell
npm run grade:u025 -- --run .data/validation/ten-run-moi/run.json --out .data/validation/ten-run-moi/grading
```

Sau khi hai reviewer tự điền và nộp bản chấm độc lập, tổng hợp:

```powershell
npm run grade:u025 -- --run .data/validation/ten-run-moi/run.json --grader1 .data/validation/ten-run-moi/grading/grader-1.json --grader2 .data/validation/ten-run-moi/grading/grader-2.json --adjudication .data/validation/ten-run-moi/grading/adjudication.json --out .data/validation/ten-run-moi/grades-summary.json
```

Chưa có điểm hoặc còn bất đồng trả exit 1 và `pending`, đây là hành vi đúng. Không sửa template gốc ngày 08/11. Không điền dữ liệu giả để đổi exit code. Rubric và quy trình người giữ đề ở [u025-t0/RUBRIC.md](u025-t0/RUBRIC.md), [CUSTODIAN_HANDOFF.md](u025-t0/CUSTODIAN_HANDOFF.md).

## Trạng thái 11 nhiệm vụ

| Nhiệm vụ | Bàn giao kỹ thuật | Nghiệm thu còn cần |
|---|---|---|
| U022-T3 | 20 snapshot và hồi quy kỳ báo cáo/nguồn/quyền, UI mở nguồn | Đạt review, chấm >=90% nhận định có nguồn |
| U026-T3 | 20 ca biên và hồi quy capacity/nguồn theo contributor/quyền gọi AI | Như review |
| U027-T1 | Trích action, phủ định, ngày mơ hồ, hash/span và apply có kiểm phiên bản | Đạt review nếu nhận Should |
| U028-T1 | Admin lock/unlock/logout, revoke, audit và UI | Hiệp review nếu nhận Should |
| U023-T3 | Hồi quy quota, timeout/retry, lỗi upstream, telemetry, che secret | Lộc xác nhận review chính thức |
| U024-T2 | Hồi quy UI/loading/retry/nguồn/quyền; E2E trên bản hiện tại | Demo/feedback người thật |
| U025-T0 | Bộ public 70 ca, adapter HTTP, output và công cụ chấm đã có | **Chưa đóng nghiệm thu**: Hiệp bàn giao bộ kín độc lập/metadata khóa trước tinh chỉnh; người chấm nộp điểm |
| U026-T1 | Rule engine, ngưỡng, snapshot/nguồn theo contributor | Lộc xác nhận review |
| U026-T2 | Dismiss/reopen, nguồn thay đổi, quyền UI/API và revoke lúc AI chờ | Lộc xác nhận review |
| U027-T3 | Hồi quy tên/hạn/phủ định/span/apply | Nếu nhận Should, chấm precision >=85% trên 15 ghi chú độc lập |
| U028-T3 | Quyền system admin, phiên/socket/AI revoke, rollback | Lộc xác nhận review nếu nhận Should |

Không công bố đã deploy/CI remote. Các thay đổi Sprint 4 và tài liệu U025 đã có trước lượt này được giữ nguyên; kết quả kiểm thử áp dụng toàn bộ working tree tích hợp, không gán tác giả của thay đổi sẵn có cho lượt bổ sung này. Chưa commit/push trong lượt bàn giao này.
