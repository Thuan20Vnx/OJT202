# U031-T2 / U032-T2 — checklist giao diện

Kiểm tra ngày 29/10/2026 trên Edge headless, viewport desktop 1366×900 và mobile 390×844, dữ liệu test cách ly. Đây là kiểm chứng kỹ thuật ở các màn hình được chọn, chưa phải chứng nhận WCAG hay UAT người dùng thật.

| Nội dung | Expected / actual đã kiểm | Minh chứng |
| --- | --- | --- |
| My Tasks mobile | Không tràn document theo chiều ngang; tên task có dòng riêng, filter xuống dòng, nút trạng thái không phụ thuộc hover | [Ảnh](../screenshots/2026-10-29-nhu-my-tasks-mobile.png), E2E có assertion scrollWidth |
| Tài liệu mobile | Bảng cuộn trong vùng, không ép toàn layout rộng; tìm/lọc và nút tài liệu dùng được | [Ảnh](../screenshots/2026-10-29-nhu-documents-mobile.png) |
| Kanban keyboard | Mở task bằng Enter, đổi trạng thái qua select và rollback khi 503 | Kịch bản Như Sprint 1 trong test/e2e/sprint1.test.mjs |
| Comment keyboard | Gõ @Như, ArrowDown/Enter chọn; Ctrl+Enter gửi; lỗi giữ nội dung rồi retry thành công | Kịch bản Như Sprint 2–4; component test Escape và chống gửi lặp |
| Loading/error/empty | Spinner có role status; ErrorBox có role alert; history lỗi có retry, không báo chưa có dữ liệu; My Tasks lỗi không crash | Component tests và code UI |
| Nhãn điều khiển | Thêm tên truy cập search My Tasks/Documents, nội dung comment, câu hỏi/goal AI, capacity và quick status | Component/browser query bằng accessible name |
| Focus / chuyển động | Focus-visible viền xanh #1d4ed8; reduced-motion rút ngắn animation/transition | CSS đã triển khai; chưa có audit screen reader toàn ứng dụng |
| Màu và trạng thái | Lỗi đỏ kèm nội dung, nguồn stale có chữ cảnh báo, priority/status có chữ; không chỉ dùng màu | Ảnh QA, component/API regression; chưa đo tương phản từng theme/màn hình |
| Citation nguồn | Nguồn mở đúng ID tài liệu, hiển thị thời gian/version hiện tại; không tìm nguồn thì báo lỗi hoặc từ chối | [Ảnh](../screenshots/2026-10-29-nhu-qa-citation.png), API/E2E thật + AI nội bộ |
| Dataset lớn | 10.000 task test, tìm kiếm được; trang 1 và 2 chỉ render 20 nút task, tổng 10.000 | [Ảnh](../screenshots/2026-10-29-nhu-my-tasks-10000.png), E2E U031 |

Giới hạn: chưa đo 50 user ảo/10 phút, CPU/RAM, p95, iOS Safari/Android thật, mọi breakpoint hoặc mọi theme; chưa có screen-reader audit và toàn bộ dialog focus trap. Không cần virtual list trong My Tasks/documents khi mỗi trang đã giới hạn; Kanban toàn project cần profile riêng trước quyết định. Các lỗi tìm thêm cần ghi issue, build và retest, không suy ra tất cả giao diện đều đã đạt từ 5 kịch bản browser.
