# U025-T0 — gói chuẩn bị ngày 08/11/2026

**Đã soạn bộ phát triển 40 câu có nguồn +10 câu ngoài nguồn +20 ca ACL/injection. Chưa chạy 70 ca trên ứng dụng, chưa có bộ kín, chưa có điểm người chấm; U025-T0 còn pending.** Các đáp án trong thư mục này chỉ là kỳ vọng của dữ liệu giả lập công khai, không phải output thực đo hoặc đáp án nghiệm thu kín.

Nguồn yêu cầu: [review 06/11](../REVIEW_2026-11-06.md), [trích Excel](../evidence/review-2026-11-06/plan-extract.json) (`Detail Plan!D113/F113`, `Process!B258/B266/B269/B270`), [protocol](../../validation/NHU_EVALUATION_UAT.md), [runbook validation](../../validation/SPRINT4_RUNBOOK.md). Không đọc lại workbook ngoài checkout và không sửa trạng thái Excel.

## Artifact và phạm vi

| Artifact | Nội dung / cách dùng |
|---|---|
| [development-dataset.json](development-dataset.json) | Snapshot giả lập: 2 workspace, 3 project, vai trò, 10 task hiện hành P-A, task đã xóa, 2 task ngoài quyền, tài liệu doc/TXT/scan/rỗng và bình luận. Ngày/giờ cố định; mã canary không phải secret thật. |
| [development-cases.json](development-cases.json) | DEV-A01–A40: truy xuất task/doc/comment, thiếu trường, tổng hợp/lọc, phụ thuộc, múi giờ. DEV-O01–O10: ngoài dữ liệu, mục tiêu khác kết quả, không OCR/crawl. DEV-S01–S20: ACL, revoke/race, nguồn đổi/xóa, conversation, injection nhiều kênh, exfiltration, SQL và lỗi retrieval. Mỗi ca có input, precondition, steps, expected. |
| [development-observations.template.json](development-observations.template.json) | 70 dòng `not-run`; output/HTTP/thời gian/technicalPassed để null. Chỉ chép template sang thư mục run riêng rồi ghi bằng chứng thật. |
| [grader-1.template.json](grader-1.template.json), [grader-2.template.json](grader-2.template.json) | Mỗi mẫu 70 dòng trống, chưa có danh tính/điểm; lưu riêng, không chia sẻ điểm trước nộp. |
| [adjudication.template.json](adjudication.template.json) | Điểm cuối, bất đồng và tử/mẫu còn pending; giữ hash hai bảng gốc. |
| [RUBRIC.md](RUBRIC.md) | Cách chấm từng tiêu chí, mọi citation và đối soát; không lấy HTTP 200 hoặc fixture xanh làm chất lượng AI. |
| [CUSTODIAN_HANDOFF.md](CUSTODIAN_HANDOFF.md), [acceptance-handoff.template.json](acceptance-handoff.template.json) | Danh sách chính xác cần Hiệp/người giữ đề cung cấp qua kênh phân quyền. Metadata chưa nhận để null/rỗng; không tạo câu/đáp án kín. |
| [manifest.json](manifest.json), [verification.json](verification.json) | SHA-256 canonical của pack/dataset, byte hash của file, build có dirty flag; kết quả kiểm cấu trúc, không phải nghiệm thu sản phẩm. |

## Dùng bộ phát triển

1. Tạo DB/tenant test riêng, không reset DB đang dùng. Restore toàn bộ snapshot trước mỗi ca. Tạo users hiển thị An, Bình, Chi để gán task; actor `member` có thể dùng An. Actor PM khác member; Bình/Chi là member P-A, Viewer chỉ đọc. `otherProject` thuộc W-A/P-B nhưng không thuộc P-A; `outsider` thuộc W-B/P-C; system admin không có membership P-A. Các symbolic ID được ánh xạ sang ID thật trong `sourceIdMap`, lưu cả user/task/document/comment/project IDs. Membership, user active và workspace AI enabled phải được kiểm trước chạy.
2. Nạp task, nội dung doc/TXT và comment đúng snapshot, ghi version/update time thực tế và hash. DOC-3 biểu diễn nguồn bị loại do scan, không phải yêu cầu OCR; không đưa chuỗi canary của ảnh vào tài liệu text. Hạn chót là UTC trong JSON; giờ hiển thị UTC+07. Với A40, freeze clock ở `2026-11-08T03:00:00Z` trong harness hoặc dùng môi trường có đồng hồ điều khiển; nếu không làm được thì đánh dấu chưa chạy, không đổi kỳ vọng theo ngày máy.
3. Dùng hội thoại mới cho từng ca trừ ca có bước lịch sử; mọi precondition bổ sung phải hoàn tất rồi chụp snapshot. Chạy theo `steps`, lưu HTTP/body nguyên văn, lỗi/timeout, source version, citation mở bằng actor tương ứng, AI telemetry và thứ tự sự kiện. `httpStatus: null` là ca nhiều bước hoặc loại lỗi: dùng từng điều kiện trong `requiredBehavior`, không coi null là HTTP kỳ vọng tùy ý. S08/S09/S11 cần barrier kiểm soát race; S18 cần trace egress, S19 trace truy vấn, S20 fault injection. Thiếu công cụ/bằng chứng thì pending, không đánh dấu pass bằng đọc mã.
4. Đóng băng output, ghi `runId`, `runHash`, Git revision + sourceHash + dirty, prompt hash, provider/model cụ thể, cấu hình retry/temperature, clock, dataset/pack hash, adapter version và operator. Khóa quyền sửa output rồi chuyển cho hai người chấm theo rubric. Không dùng provider local để kết luận chất lượng provider trả phí. Gói này không gọi provider hoặc sử dụng key.
5. Chấm đủ ca kể cả timeout/lỗi, lưu tất cả citation (kể cả citation thừa/sai) và nguồn mở không được. Lưu kết quả trong `.data/validation/<run-id>` hoặc nơi riêng được phân quyền; `.gitignore` không thay thế ACL. Nếu run có dữ liệu kín thì không commit output, đáp án hoặc danh tính người chấm thật.

## Tương thích với validation đang có

Đây là **spec dữ liệu/ca và biểu mẫu**, không phải JSON input trực tiếp cho `validate:ai` hay `validate:grades`. Không truyền `development-cases.json` cho CLI đó và không đổi `split` thành acceptance. Fixture chung `taskflow-evaluation-fixture-v2` chỉ có 4 task, 4 actor và các scenario cố định; không nạp dataset này, không có các bước revoke/barrier hoặc câu hỏi nhiều HTTP trong spec. `evaluate()` còn bắt buộc benchmark bốn feature; `validatePack()`/`assessGrades()` yêu cầu cả planner=20/report=20/risk=20 cho bộ acceptance tổng 130 ca. **70 ca U025 riêng không đóng gate release U029 chung.**

Để chạy qua CLI chung cần người phụ trách xây adapter/fixture riêng cho dataset và mutation, kiểm kỹ trước khi nhận bộ kín; hoặc thực hiện quy trình thủ công có harness race và ghi từng bước. Không chèn ca giả của feature khác để đủ 130. Các regression kỹ thuật hiện có có thể làm bằng chứng bổ sung nhưng không thay output của một ca chưa chạy.

`scripts/validation/grading.mjs` hiện tổng hợp citation chỉ từ nhóm `qa-answer`; rubric U025 tính **mọi citation trả về trong cả 70 ca**. Vì vậy cần sổ citation đầy đủ và bảng tổng hợp riêng khi chấm U025; không dùng riêng metric `citations` của CLI để xác nhận yêu cầu rộng hơn. CLI lấy mẫu số agreement là toàn bộ run, còn protocol lấy ca được cả hai chấm: khi chấm thiếu phải báo cả coverage và agreement-on-double-graded, không nhầm hai tỷ lệ.

## Xác minh artifact offline

Từ root repository:

```powershell
node scripts/validation/u025-artifacts.mjs verify
```

Lệnh kiểm 40/10/20, ID/input duy nhất, tham chiếu nguồn, kỳ vọng tổng hợp đối chiếu snapshot, mẫu chưa có điểm/output, canonical/file hash và sự khớp với [nguồn soạn ca](../../../validation/u025/development.mjs). Không HTTP, không DB, không AI. `prepare` chỉ dùng khi phát hành artifact lần đầu (ghi file kiểu exclusive); sửa version phải tạo gói mới, không ghi đè hồ sơ đã chấm. `manifest.build` nhận diện checkout lúc chuẩn bị, không chứng minh ứng dụng đã chạy bộ ca.

## Development và acceptance

Tất cả DEV-A/O/S, dữ liệu, rubric và expected ở đây đã công khai cho người phát triển. Không thể giấu lại để gọi là bộ độc lập. Bộ kín phải khác thực chất về nguồn, câu hỏi, đáp án, fixture quyền và payload, có người giữ đề review overlap; chỉ đổi tên/số/mã hoặc paraphrase từ đây không tạo độc lập. Rubric công khai được dùng chung, đáp án chuẩn phải ở nơi riêng. Hash tạo ngày 08/11 chỉ chứng minh trạng thái gói development lúc tạo, **không chứng minh đã khóa bộ kín trước những lần chỉnh prompt trước đó**.
