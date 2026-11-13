# Điều phối UAT — 6 người × 5 kịch bản

Chạy `npm run uat:sprint4 -- --minutes 120`. Giữ terminal mở, lấy URL và đường dẫn output. Mỗi người chỉ dùng slot được phân công; không dùng tài khoản thật. Mật khẩu demo `TaskFlow@2026`, email `p01.pm@uat.example.test`, `p01.member@uat.example.test`, `p01.viewer@uat.example.test`, `p01.owner@uat.example.test`; thay p01 bằng p02…p06. Owner quản workspace nhưng không là thành viên hai dự án riêng; PM là quản lý dự án.

Đăng nhập các vai trò ở profile trình duyệt riêng để tránh dùng chung cookie. URL loopback chỉ mở trên máy đang chạy. Có thể tổ chức lần lượt hoặc chia sẻ màn hình; không quảng bá URL này như môi trường từ xa.

## Tuyển và ghi nhận

Chọn 6 người, ưu tiên ngoài nhóm; chỉ ghi mã P01–P06 trong kết quả. Quan hệ `external`/`developer` phải đúng, kinh nghiệm `experience` ghi ngắn gọn. Danh sách liên hệ/đồng ý tham gia lưu riêng, không đưa email thật vào Git. Người quan sát không ký thay người tham gia. Chưa có người nào được xác nhận hoặc gửi lời mời bởi công cụ này.

Mẫu lời mời để điều phối viên gửi sau khi thống nhất lịch: “Nhóm 24 mời bạn thử TaskFlow trên dữ liệu giả trong khoảng 30–45 phút. Bạn sẽ làm 5 tình huống quản lý công việc và một bài so sánh thủ công/AI. Nhóm ghi thời gian, lỗi và góp ý dưới mã ẩn danh; ảnh/quay màn hình chỉ thực hiện khi bạn đồng ý. Bạn có thể dừng bất kỳ lúc nào. Thời gian/địa điểm: [điền].”

## Năm tình huống

| ID | Thao tác người thử | Tiêu chí quan sát |
|---|---|---|
| S1 | PM tạo task có mô tả, AC, estimate, người nhận và hạn; Member tìm và bắt đầu | Dữ liệu giữ sau reload; đúng người nhận; Member không đổi phân công/estimate |
| S2 | Member gửi Review; PM duyệt Done rồi mở lại | Member không tự Done; completedAt xuất hiện khi Done và xóa khi reopen; remaining nhập lại đúng |
| S3 | Hai vai trò bình luận, @mention; Member tải/sửa TXT; Viewer đọc | Realtime đúng dự án; tải đúng byte; Viewer không sửa/tải lên; ngoài nhóm không đọc file |
| S4 | PM tạo nháp AI với yêu cầu dưới đây, sửa/chọn rồi duyệt; tạo báo cáo và mở nguồn | Chưa duyệt chưa có task; duyệt lại không nhân bản; số liệu/nguồn đúng và AI có nhãn |
| S5 | Member giao câu hỏi mã xác nhận cho agent trên máy, mở citation trong Lịch sử hỏi đáp; hỏi ngoài nguồn; Viewer thử giao câu hỏi | Có mã/citation đúng; thiếu nguồn thì agent nói chưa ghi nhận, không bịa; Viewer bị chặn; citation ngoài dự án bị bỏ |

S5 cần agent thật (mục dưới). Nếu buổi UAT không có máy cài agent, ghi S5 là không thực hiện được kèm lý do, không thay bằng gọi API trực tiếp và không tính vào 30 lượt.

## Chuẩn bị agent cho S5

Hỏi đáp trên web chỉ chạy qua agent trên máy từ bản hợp nhất ngày 12/11. Máy điều phối cần Node và ít nhất một trong Claude Code, Codex hoặc Antigravity đã đăng nhập bằng tài khoản của nhóm. Agent gửi nội dung dự án UAT (dữ liệu giả) tới nhà cung cấp của agent đó; nói rõ điều này với người thử.

1. Người thử đăng nhập tài khoản Member của slot, mở **Trợ lý AI › Agent dự án**, tạo token 7 ngày.
2. Ở terminal riêng, dùng thư mục cấu hình tạm để không ghi đè cấu hình agent thật của máy:

```powershell
$env:TASKFLOW_HOME = "$PWD\.data\uat-agent-p01"
$env:TASKFLOW_URL = "<URL phiên uat:sprint4>"
$env:TASKFLOW_TOKEN = "<token vừa tạo>"
npm run agent
```

3. Trên web, mục Hỏi đáp hiện runner đang bật và danh sách agent có sẵn. Người thử chọn agent và gửi câu hỏi.
4. Sau lượt, thu hồi token ở tab Agent dự án và dừng runner (Ctrl+C). Xóa thư mục `.data\uat-agent-p0x`. Không đưa token vào ghi chú, ảnh hoặc báo cáo.

Thời gian S5 gồm cả thời gian agent chạy; ghi tên agent và model vào `actual`. Kết quả S5 phụ thuộc agent của máy điều phối, không đại diện cho nhà cung cấp AI cấu hình ở AIService.

Mỗi lượt ghi `participant`, `scenario`, `build`, `success`, `assisted`, `durationMs`, `errors`, `observer`, `actual`, `issueIds`. Thời gian từ nhận đề đến hoàn tất; ghi lỗi và thao tác trợ giúp ngay, không xóa lượt thất bại. Có trợ giúp thì không tính vào thành công không hỗ trợ. 30 lượt đủ mới tính tỷ lệ; cần ít nhất 27/30 và không còn lỗi critical/high chưa retest độc lập.

Đăng ký kết quả vào `uat-observations.json` do phiên sinh ra. Mẫu schema/đánh giá chi tiết: [NHU_EVALUATION_UAT](../validation/NHU_EVALUATION_UAT.md). Chấm bằng `npm run validate:uat -- --input <thư-mục-phiên>/uat-observations.json --out <thư-mục-kết-quả-mới>`. Không chỉnh `build` cũ để làm kết quả trông như thuộc build mới.

## So sánh cặp A/B

P01–P03 làm thủ công bài A rồi AI bài B; P04–P06 làm AI bài A rồi thủ công bài B. Hai bài cùng mục tiêu, dữ liệu tương đương, thời gian/tiêu chí như nhau. Dữ liệu tách dự án để không sao chép đáp án. `kit.json` ghi rõ `plannedOrder`; chỉ xác nhận khi thực tế đúng thứ tự.

Đề: “Lập kế hoạch chức năng đăng ký sự kiện: xác minh email, form đăng ký, mã xác nhận, xử lý lỗi và kiểm thử. Chia 5–8 task, hai người thực hiện (PM và Member), tổng estimate không quá 24 giờ; mỗi task có người nhận và tiêu chí nghiệm thu kiểm được. Chọn hạn còn ở tương lai. Không thêm thanh toán hoặc chức năng ngoài đề.” Thủ công tạo trực tiếp; AI phải tính cả thời gian xem, sửa và duyệt. Không lấy tốc độ sinh nháp làm thời gian hoàn tất.

Chấm cùng rubric 5 tiêu chí trong kit: đủ phạm vi, đúng người, hạn có căn cứ, AC kiểm được, không thêm dữ kiện ngoài đề. Điểm = số tiêu chí đạt / 5. Ghi `manualMs`, `aiMs`, `manualErrors`, `aiErrors`, `manualQuality`, `aiQuality`, dataset A/B và `rubricVersion`. Cần đủ 6 cặp, cân bằng thứ tự, trung vị thời gian giảm ≥30%, trung vị chất lượng không giảm và lỗi không tăng. Không kết luận từ kết quả AI local sang Claude trả phí.

## Lỗi và retest

Ghi issue ID, mô tả, severity, người báo; có bước tái hiện và expected/actual. Sau sửa, người khác retest đúng build, ghi ISO timestamp có timezone, reviewer và bằng chứng. Giữ cả lần fail lẫn pass; lần retest mới nhất quyết định. Đổi code giữa UAT thì bắt đầu bộ quan sát build mới, không trộn các lượt.
