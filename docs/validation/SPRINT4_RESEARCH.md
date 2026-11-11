# Tham khảo nghiệp vụ Sprint 4

Đối chiếu ngày 03/11/2026, dùng tài liệu chính thức. Các quyết định dưới đây là lựa chọn cho TaskFlow; không tuyên bố tương đương toàn bộ tính năng hoặc độ tin cậy của sản phẩm tham khảo.

| Nguồn | Quan sát từ tài liệu | Áp dụng vào TaskFlow |
| --- | --- | --- |
| [Asana AI features and admin controls](https://help.asana.com/s/article/asana-ai-features-and-admin-controls?language=en-US) | AI có tính năng theo ngữ cảnh và điều khiển quản trị. | Giữ cấu hình bật/tắt/quota theo workspace; ghi provider thật, không dùng output local làm chất lượng provider trả phí; demo quota/offline tách khỏi số đo nghiệm thu. |
| [Atlassian Rovo: knowledge sources](https://support.atlassian.com/rovo/docs/knowledge-sources-for-agents/) | Truy xuất phải tôn trọng quyền của người hỏi với nguồn. | Đưa ACL/không rò rỉ/citation vào rubric và giữ regression quyền sau revoke; bất kỳ leak nào chặn chất lượng, không bù bằng điểm trung bình. |
| [Atlassian automation audit log](https://confluence.atlassian.com/automation/using-the-audit-log-1093013297.html) | Theo dõi kết quả thực thi và thời gian chạy giúp điều tra hoạt động. | Ghi queue/finish, từng attempt, timeout/retry, model/provider; benchmark giữ cả lỗi trong p50/p95; log AI chỉ Owner/Admin theo nghiệp vụ sẵn có của TaskFlow. |
| [Linear audit log](https://linear.app/docs/audit-log) | Audit hỗ trợ truy vấn theo metadata, đồng thời hạn chế quyền truy cập thông tin quản trị. | Giữ ACL trên log/export, thêm usage completeness và bằng chứng theo build, tránh công bố dữ liệu chấm/đáp án kín; không tự thay vai trò TaskFlow bằng vai trò Linear. |

Khác biệt có chủ đích: website đồ án dùng PM/Member/Viewer và private project hiện có; AI phải được người dùng duyệt trước khi ghi task; risk là rule engine, không phải dự báo ML. Sprint 4 hoàn thiện đo lường, diễn tập và kiểm tra bàn giao, không thêm các tính năng ngoài Must để tạo cảm giác đủ scope.

Trong kiểm tra dependency phát hiện advisory [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) của minimatch. Cập nhật ESLint 10 và override minimatch >=11.0.1, giữ peer dependency phù hợp, kiểm lại lint/typecheck/build/tests và audit; không dùng gợi ý tự động downgrade ESLint về bản cũ.
