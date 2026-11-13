# Dữ liệu cần người giữ đề cung cấp

**Người phụ trách theo review: Hiệp; cần xác nhận người giữ đề thực tế.** Checkout hiện chưa cung cấp bằng chứng bộ kín, không chứng minh nhóm không có bộ ở nơi khác. Không gửi câu hỏi/đáp án kín vào chat này, Git hoặc nhánh phát triển. [Mẫu metadata](acceptance-handoff.template.json) chưa có giá trị nào được xác nhận.

## Điều kiện đóng phần chuẩn bị U025-T0

| Cần nhận | Trường metadata / bằng chứng cụ thể | Chia sẻ ở đâu |
|---|---|---|
| Người chịu trách nhiệm | `custodian`; ai tạo đề, ai quản kho; xác nhận reviewer U025-T0 | Chỉ chia sẻ danh tính theo quyền nhóm |
| Bộ kín thực tế 70 ca | `acceptanceVersion`, `caseMetadata`: ID, nhóm, hash từng ca; đủ 40 qa-answer, 10 qa-refusal, 20 qa-security, không trùng ID. Người chấm nhận input/precondition/steps/expected-status/checks thật. | Repo chỉ metadata/commitment được phép công khai; đề đầy đủ trong kho riêng |
| Đáp án chuẩn thật | `answerKeyCanonicalSha256`: đủ ý bắt buộc/ý sai bị cấm cho 40 câu; lý do thiếu dữ liệu cho 10; ACL matrix, nguồn được phép/cấm, kết quả từng bước/payload và tiêu chí leak của 20. Đáp án có source ID/version/đoạn bằng chứng, không chỉ một boolean pass. | Chỉ người giữ đề và người chấm được cấp quyền |
| Dataset/ACL có thể tái lập | `datasetVersion`, `datasetCanonicalSha256`: snapshot task/text/comment hợp lệ, tombstone/scan/ngoài quyền, role/membership/active, project/workspace, clock/timezone, ID mapping, reset/mutation/barrier, nguồn nào hỗ trợ đáp án và nguồn nào không được truy xuất. Không dùng dữ liệu khách hàng thật. | Kho riêng; tài khoản/secret qua kênh credential, không nằm trong metadata |
| Rubric chốt trước chạy | `rubricVersion`, `rubricSha256`; cách chấm câu/citation, xử lý lỗi, mẫu số, leak, đồng thuận và đối soát; nếu khác rubric v1 nêu phê duyệt và lý do | Rubric có thể công khai, đáp án vẫn riêng |
| Cam kết khóa có thời điểm | `packCanonicalSha256`, `frozenAt`, `frozenBy`, `commitmentReceipt`, `promptTuningStartedAt`, `frozenBeforeTuningEvidence`. Cần biên nhận timestamp/commit/kho version được bên độc lập lưu, chứng minh khóa **trước** chỉnh prompt; chuỗi thời gian tự nhập/hashes mới tạo không đủ chứng minh lịch sử. | Metadata/biên nhận, không cần nội dung kín |
| Phân quyền và truy cập | `privateStorageReference`, `authorizedGraders`, `accessPolicyEvidence`, `accessAuditEvidence`: người được đọc đề/đáp án, người tuning không được đọc; quyền đọc/ghi và thời điểm cấp/thu hồi, bằng chứng kho private thực tế | Bản bằng chứng đã che dữ liệu nhạy cảm cho reviewer |
| Tách khỏi development | `overlapReviewEvidence`: người review độc lập, ngày, cách so với bộ DEV-A/O/S này và các fixture công khai cũ, kết luận trùng/paraphrase/nguồn. Cam kết không dùng đề/đáp án kín để tuning. | Metadata + kết luận; chi tiết trong kho riêng |
| Lịch sử thay đề | `mutationHistory`: version/hash cũ/mới, ai đổi, lúc nào, lý do, ảnh hưởng độc lập và kết quả cũ giữ ở đâu. Nếu chưa đổi, người giữ đề xác nhận danh sách rỗng. | Metadata, giữ đề cũ ở kho riêng |
| Khả năng thực thi | `executionAdapterVersion`, `executionPreflightEvidence`: adapter/harness tương thích dataset, các actor và mutations; dry-run bằng **fixture development riêng**, không lộ đề kín cho người lập trình để sửa runner | Source adapter có thể công khai, mapping kín để riêng |

Hash canonical dùng `hash` trong `scripts/validation/core.mjs` với JSON đã parse: sắp key object đệ quy, giữ thứ tự array; không dùng byte hash file JSON để thay canonical pack hash. Hash file nguyên bytes được lưu riêng và ghi rõ thuật toán. Đáp án và dataset khóa riêng vì hash pack không nhất thiết bao gồm chúng. Không công bố hash từng đáp án ngắn/ít khả năng nếu có thể bị dò; dùng commitment kho riêng hoặc manifest có salt do người giữ đề quản. Đừng tạo `frozenAt` lùi ngày.

Nếu đã dùng/chia sẻ đáp án kín cho tuning, ghi bộ đó bị nhiễm và giữ kết quả như development; cần bộ kín mới do người giữ đề lập độc lập rồi khóa trước **chu kỳ tuning tiếp theo**. Không thể phục hồi tính độc lập bằng đổi tên/version hoặc timestamp.

## Điều kiện chạy/chấm chất lượng sau khi có bộ kín

Những dữ liệu sau chưa có trong checkout cho 70 ca mới. Chúng cần cho nghiệm thu chất lượng U025/U029, phân biệt với việc đã soạn đề của T0:

1. `build` (revision, sourceHash, dirty), `promptHash`, provider/model/version, cấu hình retry/temperature, adapter version, data/ACL version và clock; bằng chứng chính xác bản chạy. Không gán log build cũ cho checkout đang dirty.
2. `runId`, `runHash`, thời gian và operator; input/output thật **tất cả 70 ca**, kể cả lỗi/timeout; raw HTTP, citation/source snapshots và quyền mở, mutation/barrier/DB/egress traces cần thiết. Không thay output bằng expected.
3. Hai reviewer độc lập thực tế, timestamp/hash của hai bảng điểm gốc đã nộp trước thảo luận; điểm tiêu chí, nguồn và lý do mỗi ca. Operator không chấm output mình tạo. PIC đối soát khác hai người chấm/operator; lưu quyết định và lý do cho từng bất đồng.
4. Bảng tử/mẫu 40/10/20, citation toàn bộ response, coverage và đồng thuận trước đối soát; danh sách fail/missing/leak. Người phụ trách ký kết luận, không suy chữ ký từ test xanh. Nếu có bộ U029 tổng 130 ca thì bàn giao thêm planner/report/risk riêng; không lấy 70 ca này làm toàn bộ nghiệm thu release.

Không cần người giữ đề cung cấp key provider hoặc mật khẩu trong artifact. Các trường reviewers/ratings và acceptancePassed vẫn trống/null cho đến khi có sự kiện và bằng chứng thật. Người review có thể kiểm hash/ACL/version qua kho được cấp quyền mà không công khai đáp án vào repo.
