# Như — bảng đánh giá AI, đối chứng và UAT

Version 2026-10-29. Đây là protocol và biểu mẫu có thể thực hiện trên TaskFlow; chưa phải kết quả người dùng thật. Bộ test tự động là regression kỹ thuật, không thay bộ nghiệm thu kín của Hiệp/Lộc hoặc hai người chấm độc lập.

## U029-T2 — cách ghi nhận

Trước chạy lưu build Git + diff/source-manifest, run_id, dataset hash, prompt/model/provider, thời điểm, cấu hình và log. Không đưa secret vào báo cáo. Offline dùng bộ quy tắc phải ghi `provider=local`; không ghi chi phí/độ chính xác Claude từ kết quả offline.

| Chỉ số | Tử số / mẫu số | Ngưỡng kế hoạch | Kết quả thực đo |
| --- | --- | --- | --- |
| Q&A đúng đáp án, đủ ý, không thêm ý sai | Câu đúng / 40 câu có đáp án | ≥32/40 | Chưa chạy bộ kín |
| Từ chối đúng khi ngoài dữ liệu | Từ chối đúng / 10 câu ngoài dữ liệu | ≥9/10 | Chưa chạy bộ kín |
| Citation hỗ trợ đúng nhận định và mở được | Citation đúng / tổng citation trả về | ≥90% | Chưa chấm độc lập |
| Quyền và injection | Ca rò rỉ / 20 ca | 0/20 | Chưa chạy bộ kín |
| Hai người chấm | Số ca đồng thuận / tổng ca được cả hai chấm | Báo tỷ lệ và đối soát | Chưa có người chấm |
| Latency AI | p50/p95 toàn luồng, mọi request kể cả lỗi / 30 request mỗi feature | p95 ≤20s | Chưa benchmark |
| Lợi ích đối chứng | Trung vị thời gian thủ công và AI trên 6 người | Giảm ≥30%, không giảm chất lượng | Chưa có người dùng thật |
| UAT | Lượt thành công không trợ giúp /30 lượt | ≥27/30 | Chưa có người dùng thật |

Mỗi ca AI ghi: case_id, bộ đề/version, input, output nguyên văn, expected, nguồn/version, nguồn mở được, điểm người chấm 1 + lý do, điểm người chấm 2 + lý do, quyết định đối soát + người chốt. Giữ cả ca lỗi; không xóa timeout hoặc đáp án sai khỏi mẫu số. Đề phát triển được xem tách khỏi đề nghiệm thu kín; không tự tạo lại đề kín rồi báo là độc lập.

## Đối chứng thủ công / AI

Tuyển 6 người, ưu tiên ngoài nhóm phát triển; ghi mã P01–P06, quan hệ với nhóm và mức kinh nghiệm. Hai bộ bài A/B tương đương về số task/độ khó, cùng tiêu chí đầu ra. P01–P03 làm thủ công A trước rồi AI B; P04–P06 AI A trước rồi thủ công B. Hướng dẫn thao tác trước đo; không hỗ trợ trong lượt đo, nếu hỗ trợ phải ghi thất bại hoặc assisted theo rubric đã chốt.

| Người | Quan hệ/kinh nghiệm | Thứ tự | Phút thủ công | Phút AI | Lỗi thủ công / AI | Chất lượng thủ công / AI |
| --- | --- | --- | --- | --- | --- | --- |
| P01 | Chưa tuyển | Thủ công → AI | — | — | — | — |
| P02 | Chưa tuyển | Thủ công → AI | — | — | — | — |
| P03 | Chưa tuyển | Thủ công → AI | — | — | — | — |
| P04 | Chưa tuyển | AI → thủ công | — | — | — | — |
| P05 | Chưa tuyển | AI → thủ công | — | — | — | — |
| P06 | Chưa tuyển | AI → thủ công | — | — | — | — |

Đo từ bắt đầu đọc bài đến đầu ra đạt rubric, tính cả chờ AI, sửa nháp và retry. Giảm thời gian = (median thủ công − median AI)/median thủ công ×100%; không tính nếu mẫu thiếu hoặc median thủ công=0. Chất lượng: đủ công việc/đúng người/hạn/phụ thuộc/không bịa nguồn; cùng rubric hai chế độ.

## U032 — 5 kịch bản × 6 người

Chuẩn bị tài khoản Owner/PM/Member/Viewer và hai workspace, ba project, tối thiểu 50 task có overdue/blocked/no due; reset bằng dataset test riêng, không xóa dữ liệu người dùng. Mỗi lượt có người quan sát, build/dataset cố định, ghi phút, lỗi, trợ giúp, expected/actual, issue và retest trên cùng build hoặc ghi rõ build mới.

| Kịch bản | Vai trò / thao tác | Expected |
| --- | --- | --- |
| S1 | PM tạo/giao task, Member mở My Tasks, tìm/lọc và bắt đầu | Task đúng người, tìm được, trạng thái lưu sau reload |
| S2 | Member gửi Review, PM duyệt rồi mở lại | Member không tự Done; completedAt và UI đúng |
| S3 | Hai tài khoản comment @mention, upload TXT và mở tài liệu | Realtime hoặc banner rõ; mention đúng người; file tải qua quyền |
| S4 | PM tạo AI nháp, sửa/chọn rồi duyệt; tạo report và mở nguồn | Không task trước duyệt, duyệt lặp không trùng, report có nguồn |
| S5 | Member hỏi có nguồn/ngoài dữ liệu; Viewer và tài khoản nhóm khác thử truy cập | Citation mở đúng đối tượng, thiếu nguồn từ chối, không lộ nguồn ngoài quyền |

| Người | S1 (đạt/phút/lỗi) | S2 | S3 | S4 | S5 | Tổng đạt |
| --- | --- | --- | --- | --- | --- | --- |
| P01 | — | — | — | — | — | — |
| P02 | — | — | — | — | — | — |
| P03 | — | — | — | — | — | — |
| P04 | — | — | — | — | — | — |
| P05 | — | — | — | — | — | — |
| P06 | — | — | — | — | — | — |

Không tự điền người tham gia, thời gian, chữ ký reviewer hoặc 30 lượt thành công. Quy mô 6 người chỉ hỗ trợ kết luận trong đồ án.

## Demo so sánh có thể tái lập

1. Cùng mục tiêu “triển khai đăng ký sự kiện”, 6 thành viên, giới hạn 24 giờ công; chuẩn bị hai project tương đương.
2. Thủ công: PM nhập task, mô tả, tiêu chí, người nhận và hạn; lưu tổng phút/sai sót.
3. AI: nhập cùng mục tiêu và giới hạn; mở preview, sửa gợi ý, bỏ việc không phù hợp rồi duyệt.
4. Mở Kanban xác nhận dữ liệu; bấm duyệt lại xác nhận không tạo trùng. Đọc report và mở một citation Q&A.
5. Hiện provider thật và log; nếu mất mạng dùng bản ghi ghi rõ “bản ghi”, không giả chạy trực tiếp. Không điền phần trăm tiết kiệm trước đo.
