# TaskFlow — SRS Sprint 1 và truy vết phần Lộc

Phiên bản 1.0, ngày 01/11/2026. Tài liệu được Codex tổng hợp từ workbook `DN26_CPL_Mock_Project_Nhom24 (1).xlsx` và rà soát với mã nguồn nền `8aa32ab9955853f926cef6bc00e2d7f8e7118a9c`. Đây là đặc tả để bàn giao local; chưa có chữ ký duyệt của Product Owner hoặc reviewer được phân công.

## 1. Mục tiêu và nguồn yêu cầu

Sprint 1 cho phép một nhóm đăng ký, tạo workspace/project, mời thành viên và quản lý task theo quyền. Luồng sản phẩm: đăng ký → xác minh → workspace → project → giao task → Member gửi Review → PM duyệt Done.

Nguồn chính là sheet `Detail Plan`, dòng 12–42; `Sprint 1`, dòng 5–14; `Process`, ô B223–B253. Nội dung lập kế hoạch trong workbook được dùng làm yêu cầu, không được coi là bằng chứng sản phẩm đã hoàn thành.

Phần Lộc trực tiếp làm: U001-T3, U004-T3, U007-T1, U008-T3, U009-T1. Lộc là reviewer của U002-T3, U003-T1, U006-T3, U007-T3, U008-T1 và U008-T2. Sheet Sprint 1 còn ghi Lộc là PIC của U003/U007/U009; PIC không đồng nghĩa người viết toàn bộ code của story.

## 2. Vai trò và ranh giới quyền

| Phạm vi | Vai trò | Quyền và giới hạn |
|---|---|---|
| Workspace | Owner | Quản lý workspace và Owner/Admin/Member/Viewer; không được xóa hoặc hạ Owner cuối |
| Workspace | Admin | Quản lý Member/Viewer và tạo project; không quản Owner/Admin |
| Workspace | Member | Tham gia project theo quyền được cấp; không tự tạo project |
| Workspace | Viewer | Chỉ có thể là Viewer trong project |
| Project | PM | Quản thành viên, tạo/giao/sửa/xóa task, đặt estimate, duyệt Done và mở lại task |
| Project | Member | Đọc, cộng tác; cập nhật trạng thái đến Review và remaining của task mình nhận, chưa Done |
| Project | Viewer | Chỉ đọc nội dung được cấp; không ghi |

Mỗi workspace/project membership lưu một role. Một người có thể có role khác nhau giữa workspace và project. Owner/Admin cũng phải có project membership mới đọc được project private. Project đã archive chặn ghi nội dung; PM có thao tác restore riêng.

## 3. Yêu cầu chức năng và tiêu chí chấp nhận

Mã Rxx dùng để truy vết trong hồ sơ này, không thay mã Uxxx trong Excel. Các tên test dưới đây là ca đã có trong repository, không phải kết quả giả định.

| ID | Yêu cầu/tiêu chí chấp nhận | Story | Code và bằng chứng kiểm thử |
|---|---|---|---|
| R01 | Email duy nhất không phân biệt hoa/thường; mật khẩu không hợp lệ bị từ chối; tài khoản chưa xác minh không đăng nhập được | U003 | `BackEnd/src/routes/auth.js`; test «đăng ký: email duy nhất…», «mật khẩu yếu bị từ chối» |
| R02 | Register/verify/resend; link xác minh một lần, có hạn; SMTP gửi được tới sandbox; lỗi SMTP không báo đã gửi thành công | U003 | `services/mailer.js`; test «SMTP thực nhận email…», «SMTP lỗi báo lỗi an toàn…», «Sprint 1: token xác minh hết hạn…»; E2E SMTP bị từ chối |
| R03 | Logout làm access token cũ hết hiệu lực; refresh xoay token và phát hiện reuse; nhiều phiên được quản lý độc lập; giới hạn thử đăng nhập không bị né bằng X-Forwarded-For giả | U004 | `routes/auth.js`, `middleware/auth.js`, `services/sessions.js`; test logout, refresh, revoke đồng thời; `BackEnd/test/auth-limit.test.js` kiểm ngưỡng production 30 request, request 31 bị 429 |
| R04 | Workspace phân biệt bằng ID; người ngoài không đọc được bằng cách đoán ID | U006 | `middleware/access.js`; test «người ngoài nhóm không đọc được…», «workspace cùng tên…» |
| R05 | Tạo/nhận/gửi lại/thu hồi lời mời; lưu hash token, hạn và revokedAt; đúng email đã xác minh; không nhận hai lần; resend vô hiệu token cũ | U007 | `routes/workspaces.js`, `routes/me.js`; test «nhận cùng lời mời đồng thời…», SMTP register/invite; đăng nhập yêu cầu emailVerified |
| R06 | Chỉ Owner quản quyền Owner/Admin; luôn còn Owner sau hai request cạnh tranh | U007 | `services/membership.js`, `routes/workspaces.js`; test «Admin không gỡ Admin khác…», «hai Owner hạ quyền đồng thời…» |
| R07 | Gỡ membership đồng thời bỏ giao task cha/con, tăng version, giữ lịch sử; chặn truy cập API/file/AI và socket; không để gán task cho người vừa bị gỡ | U007 | `services/membership.js`, `services/realtime.js`; test «gỡ khỏi workspace…», «socket đang mở bị thu hồi…», «giao task đồng thời gỡ thành viên…» |
| R08 | Creator của project là PM; project chỉ nhận người trong workspace; Workspace Viewer không thành Project Member/PM; giữ PM cuối | U008 | `routes/projects.js`, `services/project-members.js`; test «Member/Viewer không tạo project…», «PM cuối không bị gỡ…», «hai PM hạ quyền nhau…» |
| R09 | Project private không lộ dữ liệu cho Admin ngoài project; Member/Viewer không quản project; archive chặn sửa | U008 | `middleware/access.js`; test «Admin ngoài project không đọc được…», «PM archive làm project chỉ đọc…» |
| R10 | PM tạo/đọc/sửa/xóa task; có title, description, acceptance criteria, assignee, priority, due date; assignee phải thuộc project và không là Viewer | U009 | `routes/tasks.js`; test «người nhận phải thuộc dự án…», «PM là Member vẫn được duyệt…», «Sprint 1: AC lưu qua create/read/update…» và test ngày sai |
| R11 | Estimate và remaining không âm; PM đặt estimate; Member chỉ cập nhật remaining của task mình nhận; hỗ trợ 0, null, số thập phân và ghi audit | U009 | `routes/tasks.js`; test «remainingHours nhận 0/null, kiểm biên/quyền, audit…» |
| R12 | PATCH bắt buộc version; hai request cùng version chỉ một thành công, request cũ trả 409; không ghi đè draft UI khi realtime tải chậm | U009/U010 | `routes/tasks.js`, `TaskDetailModal.jsx`; test «cập nhật thiếu version…», các test realtime trong `FrontEnd/test/task-detail.test.js`; E2E draft |
| R13 | Xóa mềm giữ task/comment, xác nhận khi có con, xóa mềm cha+con, gỡ dependency, giữ file trong thư viện; task xóa không xuất hiện trong truy vấn và nguồn AI | U009 | migration `20261029090000_task_soft_delete`; test «soft-delete giữ dữ liệu/audit…» |
| R14 | Mutation task và audit trong cùng transaction; lỗi audit rollback; update/delete cạnh tranh không làm sống lại task | U009 | `services/activity.js`, `routes/tasks.js`; test «soft-delete rollback nếu audit thất bại…» và test AC kiểm rollback nội dung/version khi audit lỗi |
| R15 | Member chỉ chuyển task mình nhận đến Review; PM mới duyệt Review → Done; Done đặt completedAt và remaining=0; reopen xóa completedAt | U010, phụ thuộc U009 | `middleware/access.js`; test «Member chỉ đổi trạng thái task mình nhận…» và E2E Review/Done/reopen |
| R16 | Cài từ lockfile; migration/seed chạy trên DB mới; nâng schema giữ dữ liệu cũ; frontend build được; demo không dùng dữ liệu thật | U002/U012 | `.github/workflows/ci.yml`; `BackEnd/test/migration.test.js`; log cài sạch và E2E trong `evidence/` |

Các test API nằm trong [BackEnd/test/api.test.js](../../BackEnd/test/api.test.js). Đường dẫn code viết tắt ở bảng tương đối với `BackEnd/src`, trừ khi có prefix khác. [Review](REVIEW.md) ghi kết quả và giới hạn từng nhóm.

## 4. Hợp đồng dữ liệu và API đang bàn giao

| Đối tượng | Trường/ràng buộc chính |
|---|---|
| Membership | Workspace + user duy nhất, role Owner/Admin/Member/Viewer |
| ProjectMember | Project + user duy nhất, role PM/Member/Viewer; phải thuộc workspace |
| Invite | Email chuẩn hóa, tokenHash duy nhất, expiresAt, acceptedAt, revokedAt, invitedBy |
| Task | Project/workspace, title, description, acceptance_criteria dạng text, assignee đơn hoặc null, dueDate, estimateHours, remainingHours, version, completedAt, deletedAt |
| Activity | Actor, entity, thay đổi trước/sau, thời điểm; không có API sửa/xóa nhật ký |

Schema chính xác: [schema.prisma](../../BackEnd/prisma/schema.prisma). JSON phản hồi đổi `id` thành `_id` tại bộ serialize. Ngày chỉ có ngày được diễn giải cuối ngày theo timezone hồ sơ; timestamp cụ thể giữ offset. Task không nhập hạn thì để trống.

API dùng prefix chuẩn `/api/v1`, giữ `/api` làm alias tương thích với cùng kiểm tra quyền và rate limit. Cookie phiên và header `x-taskflow: 1` cho thao tác ghi:

| Nhóm | Endpoint |
|---|---|
| Xác thực | POST `/auth/register`, `/auth/verify-email`, `/auth/resend-verification`, `/auth/login`, `/auth/refresh`, `/auth/logout` |
| Lời mời | GET/POST `/workspaces/:wsId/invites`; POST `.../:id/resend`; DELETE `.../:id`; POST `/me/invites/:token/accept` |
| Thành viên workspace | GET `/workspaces/:wsId/members`; PATCH/DELETE `.../:userId` |
| Project | GET/POST `/workspaces/:wsId/projects`; GET/PATCH `/projects/:projectId`; POST `.../archive`, `.../restore`, `.../transfer-manager` |
| Thành viên project | GET/POST `/projects/:projectId/members`; PATCH/DELETE `.../:userId` |
| Task | GET/POST `/projects/:projectId/tasks`; GET/PATCH/DELETE `/tasks/:id`; POST `/tasks/:id/move` |

Lỗi thường gặp: 400 dữ liệu không hợp lệ; 401 chưa có phiên hợp lệ; 403 thiếu quyền; 404 không có hoặc không được biết đối tượng; 409 version cũ/xóa cha cần xác nhận; 503 SMTP không gửi được. Recovery công khai trả thông báo chung để tránh lộ tài khoản.

## 5. Đối chiếu phạm vi và yêu cầu mới

Đây là ghi nhận phạm vi theo Excel và chỉ đạo hiện tại, không giả lập một buổi họp duyệt của nhóm.

| Nội dung | Quyết định cho gói bàn giao local | Căn cứ/lý do |
|---|---|---|
| U003/U004/U006/U007/U008/U009/U010 | Giữ trong phạm vi kiểm chứng Sprint 1 | Sheet Sprint 1 và Detail Plan |
| Một task có nhiều người nhận | Ghi vào yêu cầu bổ sung, chưa triển khai trong gói này | Baseline task có `assignee_id` đơn; cần quy tắc giờ/trạng thái theo từng người |
| Bốn mốc ngày task: planned start/end, actual start/end | Ghi vào yêu cầu bổ sung | Baseline có due_at/completed_at; created_at không phải ngày bắt đầu thực hiện |
| Một người nhiều role đồng thời trong cùng workspace | Ghi vào yêu cầu bổ sung | Baseline membership có một role; role giữa workspace/project đã tách |
| Issue nghỉ ốm, booking cuộc họp, thanh tiến độ thực tế mới | Chưa đưa vào Sprint 1 này | Chưa có sub-task tương ứng trong phân công Sprint 1; cần định nghĩa và phân công |
| AI meeting notes U027 | Giữ trạng thái Should chưa nhận | Không đồng nghĩa chức năng đặt lịch họp |
| Staging và nhận thư provider thật | Chuyển sang bước bàn giao môi trường sau | Người dùng xác nhận 01/11 chưa có staging, yêu cầu hoàn thiện local trước |

## 6. Các sai khác đã xử lý trong lượt hoàn thiện Sprint 1

Theo yêu cầu tiếp tục hoàn thiện các điểm còn lại, đã sửa code thay vì đổi nội dung yêu cầu Excel:

1. U002-T1/T2: thiết lập TypeScript strict ở backend/frontend; chuyển bootstrap, frontend routing/layout, API client/context và validator AC sang TS/TSX. Build và CI có typecheck bắt buộc. Các module JS/JSX cũ vẫn được giữ; xem [phạm vi chính xác](TYPESCRIPT.md). Đáp ứng phần khởi tạo TypeScript, không tuyên bố toàn bộ code đã được chuyển đổi.
2. Process B238–B242: `/api/v1` là prefix chính, frontend đã chuyển sang đường dẫn này; `/api` giữ tương thích. Refresh cookie dùng path auth tương ứng. Có test ACL/CSRF, cookie, refresh và logout.
3. Process B227: `acceptance_criteria` là chuỗi tối đa 10.000 ký tự, lưu cột SQL `TEXT`; migration ghép mảng cũ bằng xuống dòng. Giao diện nhập/sửa textarea giữ dòng trống. Alias `acceptanceCriteria` dạng danh sách vẫn hỗ trợ client cũ; không gửi cả hai trường. AI draft vẫn dùng danh sách và chuyển sang text khi tạo task. Test nâng schema giữ dữ liệu, tạo/đọc/sửa/xóa nội dung, validation và audit rollback.

## 7. Điều kiện nghiệm thu

R01–R16 có bằng chứng kỹ thuật tương ứng, các sai khác đã có quyết định xử lý, PO/reviewer xác nhận SRS và phân công, demo ghi nhận actual theo [ACCEPTANCE.md](ACCEPTANCE.md). Đạt test local không tự thay chữ ký của người được phân công hoặc chứng minh đã chạy staging.
