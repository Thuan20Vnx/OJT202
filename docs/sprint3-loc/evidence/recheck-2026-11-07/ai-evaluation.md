# Kết quả chạy đánh giá TaskFlow

Run: eval-2026-11-07T03-33-52-183Z. Bộ đề: development-v2 (development).
Provider: local. Revision: 5ac8b1810d5158406392cbe85013f3810836a535.
Source SHA-256: 4b3c73b50d8b8b26f50a84df3bbe8e0482ca974ef97714e305ffd6a596fccf8b.
Prompt SHA-256: 8cfd6b9adb4d3f9eb1a3c37e2c8eea77dc8ac74430c6d2fcec69dae23317804b. Dataset SHA-256: e9fa18c8512354cebec3e2b2c9039fa81e867b395c23072170b0043886f4e68a.

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
| planner | 30 | 0 | 30.51 | 40.13 |
| report | 30 | 0 | 57.51 | 73.90 |
| qa | 30 | 0 | 31.06 | 41.27 |
| risk | 30 | 0 | 37.47 | 58.73 |

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
