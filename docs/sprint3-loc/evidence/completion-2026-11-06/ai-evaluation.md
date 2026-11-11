# Kết quả chạy đánh giá TaskFlow

Run: eval-2026-11-06T14-37-46-051Z. Bộ đề: development-v2 (development).
Provider: local. Revision: 3857d7377a0ede27b3f745319cfc7d670f41aeb5.
Source SHA-256: 37f446c9d1992ccbb0e216635fa1a8687378149f9d882b589600483f642b1410.
Prompt SHA-256: 8cfd6b9adb4d3f9eb1a3c37e2c8eea77dc8ac74430c6d2fcec69dae23317804b. Dataset SHA-256: 3fe345447f3779e6b02776f47d49a85c786376973948c61f52cedf93e7815a96.

Kỹ thuật: passed. Nghiệm thu: pending.
Kết quả development không thay thế bộ nghiệm thu giữ kín hoặc điểm hai người chấm.

| Nhóm ca | Đạt | Mẫu số đã chạy |
| --- | ---: | ---: |
| planner-schema | 5 | 5 |
| permissions | 3 | 3 |
| report-metrics | 3 | 3 |
| qa-answer | 1 | 1 |
| qa-refusal | 1 | 1 |
| qa-security | 2 | 2 |
| risk-rules | 8 | 8 |
| risk-explanation | 1 | 1 |

| Feature | Request | Lỗi HTTP/mạng | p50 (ms) | p95 (ms) |
| --- | ---: | ---: | ---: | ---: |
| planner | 30 | 0 | 26.95 | 35.04 |
| report | 30 | 0 | 49.50 | 61.51 |
| qa | 30 | 0 | 41.10 | 60.14 |
| risk | 30 | 0 | 41.01 | 58.62 |

Thời gian đo từ trước fetch đến sau đọc/parse response, gồm xử lý API, queue, retrieval và retry; giữ cả request lỗi. Chưa phải phép thử core API với 50 user ảo.
Cấu hình: win32/x64, AMD Ryzen 7 5800H with Radeon Graphics         , Node v24.15.0, concurrency=1.
Chi phí: chưa xác định. Local provider; no paid model quality or cost claim.

## Phần còn thiếu

- Independent human scoring
- Manual/AI baseline with 6 participants
- Hidden acceptance pack

## Ca thất bại

Không có ca kỹ thuật thất bại trong bộ đã chạy.

Output gốc, cấu hình, token đã biết/chưa biết và từng attempt được giữ trong [ai-run.json](ai-run.json). Không suy ra độ chính xác hoặc latency của provider trả phí từ run local.
