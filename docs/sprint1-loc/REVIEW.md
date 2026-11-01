# Bàn giao local Sprint 1 — Nguyễn Bảo Lộc

Ngày 01/11/2026. Người thực hiện rà soát kỹ thuật và soạn hồ sơ: Codex, theo yêu cầu của người dùng. Phạm vi được người dùng xác nhận: chưa có staging, hoàn thiện bản bàn giao local trước.

Mã nền: `8aa32ab9955853f926cef6bc00e2d7f8e7118a9c`, cộng thay đổi working tree của các lượt bàn giao: hồ sơ, hướng dẫn quyền ở trang Thành viên, audit task, TypeScript, API v1, AC văn bản và kiểm thử. Không tự xác nhận thay các thành viên. Kết quả hiện hành nằm trong mục **Hoàn thiện các điểm còn lại** cuối tài liệu; bảng kết quả trước đó được giữ làm lịch sử.

## Hồ sơ

- [SRS, ma trận quyền, API, truy vết và ghi nhận phạm vi](SRS.md).
- [Kịch bản demo và biểu mẫu nghiệm thu](ACCEPTANCE.md).
- [Test toàn bộ trên mã nền](evidence/2026-11-01-tests.txt).
- [Cài sạch từ lockfile](evidence/2026-11-01-clean-install.txt).

## Review theo phân công trong Excel

| Task / dòng Detail Plan | Vai trò của Lộc | Kết quả rà soát kỹ thuật | Người xác nhận theo kế hoạch |
|---|---|---|---|
| U001-T3 / 14 | Thực hiện | Đã soạn SRS, bảng R01–R16 → story/code/test, bảng phạm vi và ghi rõ sai khác cần chốt. Chưa có biên bản duyệt của PO | Trần Hoàng Anh |
| U004-T3 / 24 | Thực hiện test | Có ca token cũ, logout, refresh/reuse, nhiều phiên và rate limit. Đạt trong log test | Nguyễn Hữu Tấn Đạt |
| U007-T1 / 28 | Thực hiện backend | Invite/hash/revoke/email, Owner cuối, unassign/audit và thu hồi quyền có code và test đạt | Trần Xuân Thuận |
| U008-T3 / 33 | Thực hiện test | Member/Viewer, project private và archive có test đạt | Trần Hoàng Anh |
| U009-T1 / 34 | Thực hiện backend | CRUD/AC/assignee/estimate/remaining, version, xóa mềm và transaction audit có test đạt | Nguyễn Khoa Hiệp |
| U002-T3 / 17 | Review Đạt | Kiểm tra workflow CI; thực hiện cài sạch theo lockfile và kiểm chứng migration/seed/build trong bản sao. CI remote chưa xác nhận | Nguyễn Bảo Lộc |
| U003-T1 / 19 | Review Thuận; PIC U003 | Đọc auth, schema, SMTP và rate limit; test SMTP TCP sandbox đạt. Chưa gửi mail provider thật | Nguyễn Bảo Lộc |
| U006-T3 / 27 | Review Như | Test cách ly workspace và đoán ID đã có và đạt | Nguyễn Bảo Lộc |
| U007-T3 / 30 | Review Hiệp | Test invite đồng thời, leo thang quyền, gỡ quyền và truy cập trực tiếp đã có và đạt | Nguyễn Bảo Lộc |
| U008-T1 / 31 | Review Hoàng Anh | Đọc project-members/transaction/ACL; kiểm quyền Viewer và PM cuối; test đạt | Nguyễn Bảo Lộc |
| U008-T2 / 32 | Review Đạt | Đọc trang Projects; E2E tạo project và chuyển giao PM bằng UI đạt. Chưa thay thế đánh giá usability của người dùng | Nguyễn Bảo Lộc |

Người trong cột cuối là người cần xác nhận, không phải người đã ký hoặc đã tham gia lượt chạy này. Trạng thái nghiệm thu của họ hiện là **chưa ghi nhận** cho cả 11 dòng.

## Phát hiện và xử lý trong lượt bàn giao

| Mã | Phát hiện | Xử lý |
|---|---|---|
| L01 | Bảng quyền trang Members ghi Workspace Member được tạo project/giao task; mô tả invite cũng hứa quyền tạo việc mặc định | Tách quyền workspace với quyền project, ghi đúng quyền PM và giới hạn Member; không thay quyền backend |
| L02 | README còn ghi xóa task sẽ xóa bình luận trong khi API đã xóa mềm | Sửa thành giữ task/comment, tách file về thư viện, gỡ dependency và audit cùng transaction |
| L03 | Chưa có hồ sơ tập trung cho U001-T3 và review phần Lộc | Bổ sung ba tài liệu trong thư mục này, truy vết tới code/test và lưu log có nguồn gốc |
| L04 | TypeScript, prefix API và biểu diễn AC khác mô tả Excel | Ban đầu ghi nhận sai khác; lượt tiếp theo đã bổ sung cấu hình/module TypeScript, API v1 và AC text theo SRS mục 6 |
| L05 | Test mới tái hiện cập nhật acceptanceCriteria có lưu nhưng không ghi audit | Thêm AC và các trường nội dung có thể sửa vào nhật ký; so sánh JSON để phân biệt `['A,B']` với `['A','B']`; test xác nhận version/nội dung rollback khi audit lỗi |
| L06 | Chưa có test chạm ngưỡng rate limit production, token verify hết hạn và round-trip AC | Bổ sung 3 ca. Test rate limit khởi tạo auth router thật với ngưỡng production 30 request, dùng request login không hợp lệ; kiểm request 31 trả 429 dù đổi header giả IP |

## Bằng chứng và cách đọc kết quả

Log `2026-11-01-tests.txt` là lần chạy mới trên mã nền trong cùng buổi làm việc: **16 AIService + 129 backend + 36 frontend = 181 ca**, fail 0, skip 0. Các dòng lỗi SMTP/audit giả lập là đầu vào có chủ đích; kết quả ca và tổng kết mới quyết định đạt/thất bại.

Kiểm thử backend/E2E ép `NODE_ENV=test`, xóa DATABASE_URL, dùng PostgreSQL nhúng, upload tạm và SMTP cục bộ. Không gửi email ra ngoài hoặc dùng database của nhóm. Suite migration tạo schema cũ trong DB tạm rồi migrate để xác nhận giữ dữ liệu. E2E có dữ liệu chuẩn bị bằng API và thao tác chính bằng UI; không mô tả mọi bước là thao tác tay trên UI.

Kết quả chạy trên bản sao cài sạch và bằng chứng của giao diện cuối được ghi trong mục **Kết quả cuối** bên dưới. Log của mã nền không được dùng thay log của phần code sửa sau đó.

Lần E2E đầu của bản cài sạch nằm dưới `.data` trả 404 vì đường dẫn file có thư mục ẩn; lưu log `2026-11-01-clean-e2e-hidden-path.txt`. Chuyển bản sao sang thư mục thường trong workspace, không đổi logic phục vụ file của ứng dụng, rồi chạy lại. Lần backend trước sửa audit có một ca AC thất bại; log `2026-11-01-backend-before-fix.txt` giữ nguyên để đối chiếu.

Quét sơ bộ file được Git theo dõi: không có `.env` thật và không có ứng viên theo mẫu private-key header/token provider được kiểm. Xem `2026-11-01-secret-check.json`; đây không phải chứng nhận không có mọi loại secret. Workflow CI đã được đọc; chưa truy cập kết quả CI remote.

## Bàn giao và phần cần người nhận xác nhận

Gói local gồm code hiện tại, lockfiles/migrations, README cấu hình, SRS, review, kịch bản demo và log. Hướng dẫn cấu hình SMTP đã có trong README. Không đưa credential vào hồ sơ.

Để nghiệm thu nhóm: review SRS và cách xử lý ba sai khác ở mục 6; điền tên/ngày/kết quả thực tế trong ACCEPTANCE; Lộc xác nhận các review được giao và các reviewer xác nhận phần Lộc trực tiếp làm. Đây là hành động của người được phân công, không thể suy ra từ tên nhánh hoặc log tự động. Staging được để lại cho đợt triển khai sau theo lựa chọn của người dùng.

## Kết quả lượt bàn giao trước khi bổ sung TypeScript/API v1/AC text

| Kiểm tra | Kết quả | Bằng chứng |
|---|---|---|
| Cài sạch 4 package từ lockfile, generate Prisma | Đạt; không sao chép node_modules/.env | [Log cài sạch](evidence/2026-11-01-clean-install.txt) |
| Backend cuối, gồm 3 ca bổ sung và migration/seed | 132/132, fail 0, skip 0 | [Log backend cuối](evidence/2026-11-01-backend-final.txt) |
| Frontend + AIService trên bản cài sạch | 36/36 + 16/16, fail 0, skip 0 | [Log cài sạch/test](evidence/2026-11-01-clean-tests.txt) |
| Build và E2E cuối | Build đạt; 2/2 E2E, fail 0, skip 0; đã xem ảnh Members desktop và phần đầu trang mobile | [Log E2E](evidence/2026-11-01-clean-e2e.txt) |
| Tương ứng code ở repo và bản cài sạch | Đối chiếu SHA-256 các file đã sửa | [Manifest](evidence/manifest.json) |

Tổng bộ kiểm thử chuẩn ở lượt trước là **184 = 132 backend + 36 frontend + 16 AIService**. Không cộng số ca của các lần chạy lại. E2E được thống kê riêng. Backend đã được chạy lại sau sửa audit; frontend/AI không đổi logic sau lượt chạy ở bản cài sạch, phần bố cục Members được build và kiểm chứng lại bằng E2E cuối lượt đó.

Ảnh kết quả: [Members desktop](evidence/members-desktop.png), [Members mobile](evidence/members-mobile.png). Các ảnh chỉ chứng minh trạng thái hiển thị tại thời điểm chụp.

## Hoàn thiện các điểm còn lại — bản bàn giao hiện hành

Theo yêu cầu người dùng tiếp tục Sprint 1, đã hoàn tất các thay đổi kỹ thuật còn lại trong phạm vi local:

- **TypeScript U002:** bootstrap backend, frontend entry/router/layout, API client, contract context và validator AC chuyển sang TS/TSX; typecheck strict bắt buộc trong build/CI. Các file JS/JSX nghiệp vụ cũ chưa chuyển toàn bộ; giới hạn kiểm tra kiểu được ghi trong [TYPESCRIPT.md](TYPESCRIPT.md).
- **API v1:** frontend dùng `/api/v1`, giữ `/api` tương thích. Cookie refresh đúng path; hai prefix dùng chung quyền, CSRF và rate limit. Test request thứ 31 đổi cả alias và header giả IP vẫn bị chặn. Phiên đã đăng nhập bằng frontend cũ có thể cần đăng nhập lại khi chuyển sang frontend mới do refresh cookie khác path.
- **AC văn bản U009:** API và textarea nhập/sửa `acceptance_criteria`; cột SQL TEXT và migration giữ dữ liệu cũ. Giữ alias danh sách cho client cũ. Bổ sung test Unicode, dòng trống, giới hạn, input sai/alias trùng, xóa nội dung và migration. Test audit rollback cũ tiếp tục đạt.
- **Nội dung hướng dẫn quyền:** sửa thêm lời giải thích ở form tạo task và ba trang AI, chỉ PM của dự án có quyền duyệt/quản lý tương ứng. Đây là sửa câu chữ cho khớp quyền đã có, không mở rộng nghiệp vụ AI trong Sprint 1.

| Kiểm tra hiện hành | Kết quả | Bằng chứng |
|---|---|---|
| Bộ test chuẩn | **186/186**: 134 backend + 36 frontend + 16 AIService; fail 0, skip 0 | [Log đầy đủ](evidence/2026-11-01-contract-tests-final.txt) |
| Cài sạch bốn lockfile, generate Prisma | Đạt trong bản sao tạm, không dùng node_modules/.env từ repo gốc | [Log cài sạch](evidence/2026-11-01-contract-clean-install.txt) |
| Typecheck + build + E2E trên bản cài sạch | **3/3 E2E**, gồm tạo/sửa AC qua UI, refresh cookie v1 và SMTP lỗi | [Log cuối](evidence/2026-11-01-contract-clean-e2e-final.txt) |
| Hash code và bằng chứng hiện hành | Danh sách file và SHA-256, đối chiếu code với bản cài sạch | [Manifest mới](evidence/manifest-contract.json) |

Log `2026-11-01-contract-tests.txt` giữ lần chạy đầu: test migration lỗi do câu SQL chuẩn bị dữ liệu thiếu ép UUID. Đã sửa thành `::uuid`, chạy lại toàn bộ và đạt. Log lỗi không bị xóa hoặc dùng làm kết quả đạt. Các log `contract-e2e`/`contract-clean-e2e` là những lượt trước khi chốt câu chữ và ảnh cuối.

Sau bộ 186 ca, chỉ sửa câu chữ quyền ở bốn component và bổ sung bước/ảnh E2E; không đổi logic ứng dụng. Bản cài sạch đã build/typecheck và chạy lại E2E trên thay đổi cuối. Không cộng số ca của các lần chạy lặp. Xem ảnh [form tạo task](evidence/acceptance-create.png), [chi tiết task sau lưu và tải lại](evidence/acceptance-detail.png). Ảnh đã được kiểm tra trực quan.

**Còn ngoài phạm vi local:** xác nhận review/nghiệm thu của các thành viên được giao, CI remote, staging và nhận thư SMTP provider thật. Chưa có chữ ký nhóm, không sửa trạng thái Excel hoặc tự ghi Done thay người phụ trách. Các yêu cầu bổ sung trong ảnh (nhiều assignee, bốn mốc ngày, booking/issue mới) vẫn theo phạm vi SRS mục 5.
