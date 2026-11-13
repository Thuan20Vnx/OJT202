# Diễn tập 10–12 phút

Chuẩn bị hai người thao tác PM/Member, Viewer trong profile thứ ba, dữ liệu UAT riêng, build hash, provider và báo cáo kiểm thử. Người quan sát dùng đồng hồ; ghi thời điểm bắt đầu/kết thúc và lỗi vào `rehearsal.json` sinh bởi `prepare:uat`. Agenda dưới đây là kế hoạch, chưa phải biên bản diễn tập.

| Mốc | Thao tác | Điểm cần chứng minh |
|---|---|---|
| 0–2 phút | Nêu bài toán, đăng nhập PM/Member, chọn cùng workspace/project | Vai trò khác chức danh; provider/build được ghi rõ |
| 2–4 | PM giao việc, Member cập nhật và gửi Review, PM duyệt Done; hai người comment | Member không tự Done; realtime và lịch sử đúng |
| 4–7 | Tạo AI preview, sửa AC/estimate/người, chọn mục, duyệt; thử duyệt lại | Chưa duyệt chưa tạo task; duyệt lặp không nhân task |
| 7–9 | Mở risk theo rule, task nguồn; tạo report theo kỳ và mở nguồn | Số liệu từ DB, nguồn thật; diễn giải AI có nhãn |
| 9–11 | Member giao câu hỏi mã xác nhận cho agent trên máy (runner bật sẵn trước buổi), mở citation; hỏi dữ kiện ngoài phạm vi; Viewer thử giao câu hỏi | Nguồn đúng project; agent không bịa khi thiếu nguồn; Viewer bị chặn; câu trả lời nằm trong Lịch sử hỏi đáp |
| 11–12 | Mô phỏng lỗi mạng trên trình duyệt test, trở lại CRUD; chỉ rõ giới hạn báo cáo | Không biến lỗi AI thành mất dữ liệu; bản quay dự phòng ghi rõ là bản quay |

Nếu vượt 12 phút, ghi thời lượng thật, rút thao tác và diễn tập lại; không chỉnh số đo. Điền ít nhất hai cộng tác viên thật. `qualityRunId` phải tham chiếu báo cáo chất lượng đã chấm, `uatBuildHash` khớp build; chưa có thì để null, không gắn trạng thái passed.

## Câu hỏi và câu trả lời có căn cứ

- **Owner khác PM?** Owner quản thành viên/cấu hình workspace. Đọc dữ liệu dự án riêng vẫn cần project membership. PM quản phân công, estimate và duyệt hoàn thành trong dự án. System Admin không mặc định được đọc project.
- **Thu hồi quyền khi đang chờ?** API kiểm lại phiên/ACL trước commit/trả kết quả AI và sau đọc storage. Socket kiểm quyền khi join và trước phát sự kiện. Byte đã tải trước thời điểm thu hồi không thể thu hồi từ máy người dùng.
- **RAG dùng gì?** Task/comment/tài liệu văn bản được lọc trong project, tìm kiếm từ khóa và citations vào nguồn. Agent dùng cùng bộ nguồn qua công cụ `search_project`; khi lưu câu trả lời, citation không có thật trong dự án bị bỏ và đánh số lại. Có fingerprint phát hiện nguồn đổi. Hiện chưa có vector database/embeddings; không gọi toàn bộ hệ thống là semantic RAG.
- **Prompt injection đã an toàn tuyệt đối?** Không. ACL là ranh giới dữ liệu; kiểm thử bao gồm yêu cầu vượt phạm vi, nguồn hợp lệ và đầu ra. Guard mới chỉ chặn dạng yêu cầu rõ ràng đã mô tả. Hidden pack/provider thật cần đánh giá riêng.
- **Chi phí bao nhiêu?** Có hai nguồn khác nhau. Lập kế hoạch, báo cáo, biên bản và diễn giải rủi ro trên web dùng chuỗi nhà cung cấp ở AIService (Gemini → Groq → OpenRouter → Ollama tùy cấu hình), có hạn mức theo workspace và log token. Hỏi đáp và việc giao cho agent chạy bằng tài khoản Claude Code/Codex/Antigravity của chính người dùng, không tính lượt AI của nhóm và TaskFlow không thấy hóa đơn. Token ước tính không phải hóa đơn; thiếu usage thì ghi chưa biết, không ghi bằng 0. Chế độ local trong kiểm thử không chứng minh chi phí hay tốc độ của nhà cung cấp thật.
- **Agent trên máy có vượt quyền không?** Token agent mang đúng quyền project của người tạo, chỉ dùng ở `/api/mcp`, không thay được cookie. Member qua agent chỉ đưa việc của mình tới Chờ duyệt; kế hoạch và biên bản chỉ là nháp. Token bị thu hồi khi đặt lại/đổi mật khẩu, khi bị khóa hoặc buộc đăng xuất; lỗi token còn sống sau các thao tác này đã được sửa trong Sprint 4 và có trong ma trận quyền. Agent đọc code trên máy người dùng là phần ngoài server, nằm trong quyền của agent đó.
- **Đã đủ nộp chưa?** Đọc kết quả từng gate. Không lấy unit test hoặc 6 tài khoản demo thay 6 người UAT, không lấy localhost thay HTTPS production.

Sau diễn tập lưu thời gian, vai trò, issue/retest, ảnh hoặc bản quay được đồng ý. Hoàng Anh review kết quả U035-T3; không ký tên thay reviewer.
