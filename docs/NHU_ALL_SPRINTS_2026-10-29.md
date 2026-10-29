# Hoàng Thị Hải Như — đối chiếu toàn bộ nhiệm vụ

Nguồn: `C:\Users\ASUS\Downloads\DN26_CPL_Mock_Project_Nhom24 (2).xlsx`, các sheet Sprint 1–4, Detail Plan và Process. Tên đầy đủ trong file là Hoàng Thị Hải Như. Báo cáo ngày 29/10/2026, không sửa workbook gốc, không tự xác nhận tác giả code cũ hoặc ký review thay người được phân công.

## Phạm vi và tình trạng

Đã rà soát nhiệm vụ triển khai và phần được giao review ở cả bốn sprint. Nhiều tính năng đã có trong repo trước lượt này; thay đổi lần này tập trung lỗ hổng và đầu ra còn thiếu. “Có code/đã test” không đồng nghĩa story đã được nhóm nghiệm thu. Mục U028 Should chưa được nhận baseline theo workbook; chỉ kiểm tra regression phần đã có, không tự nhận scope mới.

| Task (Detail Plan) | Đầu ra được đối chiếu / hoàn thiện |
| --- | --- |
| U002-T2 (16) | React Router/layout/API client và JS/TS entry, ESLint/typecheck/CI đã có. Chưa chuyển toàn bộ JS sang TS; mô tả đúng trong SRS. |
| U004-T2 (23) | Login/protected routes/refresh/logout đã có; regression giữ phiên khi mạng/refresh lỗi và kết thúc phiên khi 401 thật. |
| U006-T3 (27) | API tests workspace/project private/đoán ID/thu hồi quyền; dữ liệu cách ly trong test DB. |
| U009-T2 (35) | Form/drawer/member/priority/deadline/version và giữ draft đã có; kiểm lại với bộ regression hiện tại. |
| U010-T2 (38) | Kanban keyboard/select, rollback riêng thẻ, lock move và Viewer đã có; browser regression tiếp tục kiểm tra. |
| U011-T2 (59) | My Tasks: thêm search debounce 300ms, chống ghi lặp theo task, reload sau lỗi/409, select trạng thái luôn truy cập được, reset trang khi bỏ filter; lỗi không giả danh sách rỗng. |
| U014-T2 (65) | CommentBox giữ nội dung/lỗi gửi, bắt Promise rejection, khóa Ctrl+Enter gửi lặp; @mention ArrowUp/Down/Enter/Escape và nút click bàn phím. |
| U015-T2 (68) | Documents: debounce, reset trang khi đổi loại/người tải, upload lock, tên tài liệu là button; query document mở đúng preview từ citation. |
| U015-T3 (69) | Backend suite có MIME/chữ ký/size, file xóa, traversal và thu hồi quyền; xem log tự động và assertion trong api.test.js. |
| U017-T2 (74) | useLoad đã resync theo scope; thêm banner reconnect, refresh khi quay lại tab và mỗi 30 giây khi socket mất/tab hiện, nút tải ngay. Không nhận là đã dùng query cache tập trung. |
| U019-T2 (80) | Biểu đồ/drill-down đã có; thêm capacity editor Owner/Admin theo đúng đối tượng được quản, 0–80 giờ, giữ ô lỗi; overview nghe board:refresh. |
| U021-T2 (99) | Planner preview/edit/select/apply một lần đã có; thêm label goal và lỗi/loading/retry lịch sử, không hiển thị rỗng khi API lỗi. |
| U022-T2 (102) | Report chọn kỳ/editor/source/history đã có; thêm trạng thái lỗi/loading/retry lịch sử. Số liệu snapshot và cảnh báo stale đã có. |
| U024-T2 (108) | Rà soát luồng Kanban → AI → citation/document, phản hồi lỗi và quyền. Browser test dùng API thật + AI nội bộ, không provider trả phí. |
| U025-T2 (111) | Citation document đi đúng ID, hiển thị cập nhật nguồn và cách retrieval thật; API thống kê nhỏ thay tải mọi task để đếm; lỗi scope/history có retry. Chặn Viewer/archived gửi ask tại UI và backend, recheck quyền trước lưu kết quả. |
| U028-T3 (122, Should) | Test admin hiện hữu khóa user có lý do/phiên/audit/không đọc project; không tự đổi trạng thái Should trong workbook. |
| U029-T2 (136) | [Bảng chỉ số, rubric và đối chứng](validation/NHU_EVALUATION_UAT.md), mẫu số rõ; chừa kết quả thực đo khi chưa có bộ kín/hai người chấm/người thử. |
| U031-T2 (142) | My Tasks/documents phân trang, debounce; Q&A scope là API count nhỏ, lịch sử giới hạn; loading/error/empty rõ. Browser kiểm My Tasks trên 10.000 task, mỗi trang 20 dòng, sang trang 2 đúng. Kanban/retrieval/overview vẫn lấy dữ liệu toàn project: không coi đây là benchmark 50 user đồng thời. |
| U032-T2 (145) | Nút bàn phím, label mới, focus-visible rõ, giảm chuyển động theo hệ điều hành, main min-width và toast vừa điện thoại; browser kiểm viewport 390px và ảnh thật. Không tuyên bố đạt WCAG toàn ứng dụng. |
| U034-T1 (150) | [SRS/quyền/trạng thái/quyết định](design/SRS.md), [ERD + 23 model](design/ERD.md), [OpenAPI](design/openapi.json), [cài sạch](design/INSTALL.md), [source hashes](design/source-manifest.json). OpenAPI inventory đủ tuyến khai báo, schema chi tiết các luồng chính; handler là nguồn cho phần chưa đặc tả đầy đủ. |

## Các nhiệm vụ review

| Task được giao review | Kết quả kỹ thuật / đầu vào còn cần |
| --- | --- |
| U001-T1/T2 (12,13) | Repo chưa có phiếu khảo sát ≥6 người/2 nhóm hoặc wireframe gốc có version; không tạo người trả lời/biên bản giả. Hành trình sản phẩm mô tả trong SRS. |
| U003-T3 (21) | Suite xác minh email/trùng/hết hạn/dùng lại và SMTP sandbox; không thay việc nhận Gmail thật khi deploy. |
| U010-T3 (39) | Regression Kanban reload/409/Viewer/rollback trong API/component/browser. |
| U011-T3 (60) | API scope và filter, frontend error/debounce; cần reviewer độc lập xác nhận kết quả. |
| U018-T3 (78) | Suite dependency self/cross-project/cycle và deadline/calendar; không tự ký review Thuận. |
| U020-T3 (84) | Suite log ACL và chống CSV formula; README mô tả quy tắc. |
| U024-T1 (107) | Test DB dùng migrations thật, API/AI nội bộ qua HTTP; chưa xác nhận staging hoặc provider thật. |
| U026-T3 (116) | Suite deadline, capacity 0/missing, Done và risk resolve; không xem rule-based output là AI suy luận độc lập. |
| U030-T2 (139) | SRS ma trận quyền; bổ sung chặn Viewer gọi ask + kiểm nguồn, thông báo/file theo suite cũ. Chưa thay ma trận nghiệm thu kín đầy đủ. |
| U032-T3 (146) | Protocol 6×5 và đối chứng đã chuẩn bị; chưa có người tham gia/số đo/chấm độc lập để review kết quả. |
| U033-T1 (147) | Chưa có RC HTTPS/deploy/rollback/backup-restore thật trong repo để xác nhận; không tự gắn final tag. |

## Minh chứng và tái chạy

Lượt cuối: **199/199 test tự động đạt** (AIService 16, backend 131, frontend 52), không skip; **5/5 kịch bản Edge E2E đạt**. Production build và typecheck đạt. ESLint 0 lỗi, còn 4 cảnh báo unused eslint-disable đã có. Build còn cảnh báo chunk chính >500kB; chưa coi là lỗi hiệu năng đã đo. My Tasks 10.000 task chỉ chứng minh phân trang/render giới hạn trong ca browser, không chứng minh tải đồng thời hay p95 toàn hệ thống.

OpenAPI có 84 path /108 operation; ERD có 23 model. Đã kiểm ID operation không trùng, tham số path đầy đủ, 109 hash source khớp và liên kết tài liệu tồn tại. [Checklist UI và ảnh](validation/NHU_UI_CHECKLIST.md) ghi rõ phạm vi kiểm tra và phần chưa kiểm.

- `docs/test-evidence/2026-10-29-nhu-all-tests.txt`: toàn suite AI/backend/frontend.
- `docs/test-evidence/2026-10-29-nhu-all-e2e.txt`: build + browser test, DB/upload tạm, AI nội bộ.
- `FrontEnd/test/nhu-all-sprints.test.js`: debounce, bình luận lỗi/gửi lặp/mention, capacity 0/blank/error, My Tasks lỗi, scope Q&A nhỏ và lỗi nguồn.
- `BackEnd/test/qa-sources.test.js`: metadata thời gian/version hiện tại, nguồn thay đổi và khóa nguồn đã xóa.
- `BackEnd/test/api.test.js`: thêm test thống kê nguồn và kiểm Viewer không tiêu quota hỏi đáp.
- `test/e2e/sprint1.test.mjs`: thêm luồng My Tasks → comment retry/mention → Q&A citation → document → capacity → viewport mobile.
- Ảnh browser được lưu `.data/e2e/nhu-*.png`; bản chọn bàn giao ở `docs/screenshots/` sau khi test thành công.

`npm test`, `npm run test:e2e`, lint/typecheck theo [hướng dẫn](design/INSTALL.md). Kết quả local không đại diện trạng thái CI sau push. Git nền `0a100ec85b53ee88a762148ff6f0a138991ed653` + thay đổi chưa commit trong lượt này. Mọi hash/version cần gắn cùng commit và diff khi nhóm review; manifest khóa source frontend/backend/AI/shared/Prisma, không thay hash binary build hoặc dependencies.

## Phần cần người thật/môi trường triển khai

Chưa xác nhận reviewer, UAT 6 người/30 lượt, hai người chấm và bộ đề nghiệm thu kín, 50 user ảo/10.000 task/10 phút, backup/restore checksum, SMTP Gmail thật, RC HTTPS và cài sạch bởi thành viên khác. Đây là điều kiện để nhóm chốt Done; các biểu mẫu không thay kết quả. Việc hoàn thiện code và tài liệu local không tự làm các gate này đạt.

Daily Scrum có thể dùng cập nhật hiện tại: “Đã đối chiếu toàn bộ phần Như, hoàn thiện My Tasks, comment/mention, citation tài liệu, reconnect/capacity và tài liệu thiết kế; chạy kiểm thử kỹ thuật và gửi bằng chứng để review. Còn UAT/AI nghiệm thu độc lập và kiểm chứng môi trường triển khai.” Không điền ngược hôm qua hoặc xác nhận tham dự cuộc họp 28/10 khi không có bằng chứng.
