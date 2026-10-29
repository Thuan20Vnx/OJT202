# TaskFlow – Nền tảng quản lý công việc & cộng tác nhóm

Đồ án Nhóm 24 (Hoàng Anh, Thuận, Như, Lộc, Đạt, Hiệp). Giao diện dựng theo 23 màn hình thiết kế trên Stitch (dự án *TaskFlow Kanban Interface*), nghiệp vụ theo Product Backlog trong `DN26_CPL_Mock_Project_Nhom24.xlsx`.

| Thư mục | Thành phần | Công nghệ |
|---|---|---|
| `FrontEnd/` | Giao diện web | React 18 + Vite + Tailwind CSS (Inter, Material Symbols – đúng design system Stitch v2) |
| `BackEnd/` | API + realtime | Node.js 24 + Express 5 + Prisma 6 + Socket.io, **PostgreSQL** (chưa có thì tự chạy PostgreSQL 17 nhúng) |
| `AIService/` | Dịch vụ AI | Express 5 – Anthropic Claude (khi có `ANTHROPIC_API_KEY`) hoặc bộ AI nội bộ dựa trên quy tắc |

```
Trình duyệt ──HTTP/WebSocket──▶ BackEnd :4000 ──Prisma──▶ PostgreSQL / Supabase
   (FrontEnd :5173)                    │
                                       └──HTTP (x-ai-service-key)──▶ AIService :5000 ──▶ Claude (tùy chọn)
```

BackEnd giữ mọi thứ liên quan dữ liệu & quyền (kiểm quyền, hạn mức AI theo ngày, nhật ký gọi AI, lọc nguồn dữ liệu trước khi gửi);
AIService chỉ nhận dữ liệu đã lọc và trả kết quả AI (kế hoạch nháp, action items, câu trả lời có trích dẫn, tóm tắt báo cáo, diễn giải rủi ro) – không kết nối database.

## Chạy nhanh

Yêu cầu: Node.js ≥ 20.

```bash
cd taskflow
npm run install:all
cp BackEnd/.env.example BackEnd/.env        # rồi đổi JWT_SECRET
cp AIService/.env.example AIService/.env
npm run dev                                 # chạy cả AIService + BackEnd + FrontEnd
```

- Web: http://localhost:5173 · API: http://localhost:4000 · AIService: http://localhost:5000
- Không cần cài PostgreSQL: khi `DATABASE_URL` để trống, API tự chạy PostgreSQL 17 nhúng (gói `embedded-postgres`, binary PostgreSQL thật) ở cổng `54329`. Dữ liệu dev lưu ở `BackEnd/.data/pg` nên khởi động lại không mất.
- Mỗi lần khởi động, API tự áp dụng migration (`prisma migrate deploy`).
- DB trống sẽ được seed dữ liệu demo của Nhóm 24 (`SEED_DEMO=true`).

### Tài khoản demo (chỉ môi trường phát triển)

Mật khẩu chung: `TaskFlow@2026` (định nghĩa trong `BackEnd/src/seed.js`).

| Email | Vai trò |
|---|---|
| mai.anh@nhom24.edu.vn | Owner · PM |
| hoang.anh@nhom24.edu.vn, thuan@nhom24.edu.vn | Admin |
| nhu@, loc@, dat@, hiep@nhom24.edu.vn | Member |
| khanh.linh@nhom24.edu.vn | Viewer (chỉ xem) |
| admin@taskflow.local | System Admin (trang Quản trị hệ thống) |

Email xác minh / đặt lại mật khẩu / lời mời: `MAIL_MODE=outbox` lưu vào **hộp thư dev** – mở http://localhost:5173/dev/outbox (chỉ ngoài production). Đặt `MAIL_MODE=smtp` để gửi email thật; không tự chuyển sang outbox nếu SMTP lỗi.

### Gửi email bằng Gmail SMTP

Trong `BackEnd/.env`, cấu hình riêng trên máy triển khai:

```env
MAIL_MODE=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_REQUIRE_TLS=true
SMTP_USER=your-account@gmail.com
SMTP_PASS=your-google-app-password
MAIL_FROM="TaskFlow <your-account@gmail.com>"
CLIENT_URL=https://your-taskflow-domain.example
```

Dùng [App Password của Google](https://support.google.com/accounts/answer/185833?hl=en) sau khi bật xác minh hai bước; không dùng mật khẩu đăng nhập Gmail. Thay các giá trị mẫu, không commit `.env` hay gửi mật khẩu vào chat. Khi chạy local, giữ `CLIENT_URL=http://localhost:5173`. Khởi động lại backend sau khi đổi cấu hình. Port 465 dùng TLS ngay từ đầu; port 587 cần `SMTP_SECURE=false`, `SMTP_REQUIRE_TLS=true` ([tài liệu Nodemailer](https://nodemailer.com/smtp)).

Kiểm chứng sau cấu hình: đăng ký một tài khoản kiểm thử có hộp thư bạn quản lý, nhận thư thật và mở liên kết xác minh; thử gửi lại thư và lời mời. Nếu gửi thư đăng ký lỗi, tài khoản vẫn chờ xác minh và giao diện cho gửi lại, không cần đăng ký lại. Các API khôi phục công khai trả thông báo chung để không tiết lộ email có tài khoản hay không. Production bắt buộc SMTP có TLS; outbox không được chấp nhận.

## Kết nối PostgreSQL thật

Khi đã có PostgreSQL ≥ 13 (cài trực tiếp, Docker, Neon, Supabase, RDS…), tạo database rồi đặt trong `BackEnd/.env`:

```env
DATABASE_URL=postgresql://taskflow:matkhau@localhost:5432/taskflow
SEED_DEMO=false        # production bắt buộc false; true chỉ dành development
```

**Supabase** (đang dùng): Supabase → nút **Connect** → **Session pooler**, thay `[YOUR-PASSWORD]` bằng mật khẩu database và thêm `?sslmode=require&connection_limit=10` (Session pooler gói miễn phí giới hạn ~15 kết nối; mặc định Prisma mở số nhân CPU × 2 + 1):

```env
DATABASE_URL=postgresql://postgres.<project-ref>:<mật-khẩu>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&connection_limit=10
```

Mỗi truy vấn tới Supabase mất ~60–90ms đi-về nên backend được tối ưu theo số **lượt** truy vấn: kiểm tra phiên/quyền gộp bằng JOIN (`relationJoins`), các truy vấn độc lập chạy song song, kiểm tra vòng lặp phụ thuộc bằng CTE đệ quy, cập nhật công việc bằng `UPDATE … RETURNING`.

Không cần `@supabase/supabase-js` – backend kết nối thẳng PostgreSQL qua Prisma; bảng hiện trong Supabase → Table Editor.

Ví dụ chạy PostgreSQL bằng Docker:

```bash
docker run -d --name taskflow-pg -e POSTGRES_USER=taskflow -e POSTGRES_PASSWORD=matkhau -e POSTGRES_DB=taskflow -p 5432:5432 -v taskflow-pg:/var/lib/postgresql/data postgres:17
```

Bảng, khóa ngoại, enum và chỉ mục được tạo bằng migration trong `BackEnd/prisma/migrations` – API tự chạy khi khởi động, hoặc chạy tay `npm --prefix BackEnd run db:migrate`.

### Lược đồ dữ liệu

`BackEnd/prisma/schema.prisma` gồm 23 bảng: `users`, `sessions`, `tokens`, `workspaces`, `memberships`, `invites`, `projects`, `project_members`, `tasks`, `comments`, `documents`, `document_revisions`, `notifications`, `notification_prefs`, `activities`, `ai_calls`, `ai_drafts`, `ai_reports`, `ai_conversations`, `risk_resolutions`, `admin_audits`, `outbox`, `counters` (đánh số công việc).

- Khóa chính `uuid` (`gen_random_uuid()`), khóa ngoại có `ON DELETE CASCADE / SET NULL` phù hợp (xóa công việc ⇒ xóa bình luận, tệp đính kèm giữ lại).
- Ràng buộc UNIQUE thay cho kiểm tra trong code: email, `(workspace, user)`, `(project, number)`, `(user, dedupeKey)` chống gửi trùng thông báo, `(project, aiDraftItem)` chống tạo trùng việc khi duyệt AI nhiều lần, `(document, version)`.
- Danh sách id (thành viên dự án, phụ thuộc công việc, nhắc tên) là mảng `uuid[]` có chỉ mục GIN; dữ liệu lồng nhau ít truy vấn (checklist, cài đặt AI, sprint, nội dung bản nháp/báo cáo AI) là `JSONB`.
- Cập nhật công việc kiểm tra `version` ngay trong câu `UPDATE … WHERE version = ?` nên hai người sửa cùng lúc không ghi đè nhau.
- API vẫn trả khóa `_id` như trước (đổi tên `id → _id` tại một chỗ khi tuần tự hóa JSON) nên frontend không phải sửa.

Xem/sửa dữ liệu trực quan: `npm --prefix BackEnd run db:studio` (Prisma Studio).

## Lệnh

| Lệnh | Mô tả |
|---|---|
| `npm run dev` | Chạy AIService + BackEnd + FrontEnd (hot reload) |
| `npm test` | Test AIService, API/phân quyền và migration nâng dữ liệu cũ (PostgreSQL nhúng tạm thời, không đụng dữ liệu dev) |
| `npm run test:e2e` | Build và kiểm thử Sprint 1 trên trình duyệt: đăng ký, tạo nhóm/dự án, giao việc, Member gửi Review, PM duyệt/mở lại/chuyển giao |
| `npm --prefix BackEnd run db:migrate` | Áp dụng migration vào DB đang cấu hình |
| `npm --prefix BackEnd run db:studio` | Mở Prisma Studio xem dữ liệu |
| `npm run build` | Build frontend vào `FrontEnd/dist` |
| `npm start` | Chạy BackEnd production; nếu có `FrontEnd/dist` thì phục vụ luôn giao diện |
| `npm run start:ai` | Chạy AIService production |
| `npm --prefix BackEnd run seed` | Seed dữ liệu demo vào DB đang cấu hình (chỉ khi DB trống) |

## Bản đồ màn hình ↔ user story

| Màn hình (Stitch) | Đường dẫn | Story |
|---|---|---|
| Đăng nhập & Đăng ký, Xác minh email | `/login`, `/register`, `/verify-email` | U003, U004 |
| Quên mật khẩu & Đặt lại | `/forgot-password`, `/reset-password` | U005 |
| Tạo workspace (Onboarding) | `/onboarding` | U006 |
| Thành viên & Phân quyền, Lời mời | `/settings/members`, `/settings/invites`, `/invite/:token` | U007 |
| Quản lý dự án | `/projects` | U008 |
| Bảng Kanban, Tạo công việc, Chi tiết công việc | `/board`, `?task=<id>` | U009, U010, U013, U014, U015 |
| Việc của tôi | `/my-tasks` | U011 |
| Tài liệu | `/documents` | U015 |
| Thông báo | `/notifications` | U016 |
| (Realtime toàn hệ thống) | Socket.io | U017 |
| Lịch dự án & phụ thuộc | `/calendar` | U018 |
| Tổng quan (Dashboard) | `/overview` | U019 |
| Nhật ký hoạt động + xuất CSV | `/settings/activity` | U020 |
| Trợ lý AI – Lập kế hoạch | `/ai/planner` | U021 |
| Trợ lý AI – Báo cáo tiến độ | `/ai/report` (`/reports`) | U022 |
| Cài đặt AI / hạn mức | `/settings/ai` | U023 |
| Trợ lý AI – Hỏi đáp dự án | `/ai/qa` | U025 |
| Cảnh báo rủi ro | `/risks` | U026 |
| Trợ lý AI – Ghi chú họp (Should) | `/ai/meeting` | U027 |
| Quản trị hệ thống (Should) | `/admin` | U028 |
| Hồ sơ cá nhân | `/profile` | U005 |

## Bảo mật & tiêu chí nghiệm thu đã hiện thực

- **Phiên đăng nhập**: access token 15 phút + refresh tối đa 30 ngày khi chọn Ghi nhớ; nếu không chọn thì cookie phiên và hạn server 24 giờ trong cookie `HttpOnly`, `SameSite=Lax`, `Secure` khi production; refresh **xoay vòng**, dùng lại token cũ ⇒ thu hồi cả chuỗi phiên; logout/đổi mật khẩu/reset thu hồi phiên. Lỗi đăng nhập chung chung, mật khẩu băm bcrypt.
- **CSRF**: mọi request ghi phải có header `x-taskflow: 1`; CORS chỉ cho `CLIENT_URL`.
- **Cách ly dữ liệu**: mọi truy vấn đi qua `workspaceAccess` / `projectAccess`; người ngoài nhóm nhận 404 (không lộ sự tồn tại). Viewer không ghi, không kéo thả; dự án lưu trữ chỉ đọc; phòng Socket.io chỉ vào được sau khi kiểm quyền; thu hồi quyền đẩy user khỏi phòng ngay.
- **Kanban**: mỗi công việc có `version`; bản cũ ⇒ **409** kèm dữ liệu mới để UI tải lại.
- **Quyền dự án**: Owner/Admin tạo dự án và trở thành PM. Mỗi dự án có bảng `project_members` với vai trò PM/Member/Viewer; Owner/Admin ngoài membership không đọc được project private. PM quản thành viên, chuyển giao trước khi rời dự án; Workspace Viewer không được nâng thành Project Member/PM. Gỡ thành viên bỏ gán các task của người đó.
- **Workflow**: Member chỉ đổi trạng thái công việc mình nhận theo To do → In progress → Review và cập nhật giờ còn lại. PM duyệt Done/mở lại; Done ghi `completedAt`, mở lại xóa thời điểm hoàn thành. PATCH task phải có `version`. Giao diện Kanban/My Tasks/chi tiết dùng cùng chính sách quyền.
- **Workspace**: cho phép cùng tên; ID/slug phân biệt các workspace.
- **Phụ thuộc**: chặn tự liên kết, khác dự án và chu trình.
- **Tệp**: chỉ PDF/TXT/PNG/JPG ≤ 10MB, kiểm tra cả MIME lẫn chữ ký đầu tệp; tải xuống qua backend proxy kiểm membership mỗi lần; ảnh/scan không dùng cho AI.
- **Bình luận**: loại bỏ HTML, chỉ sửa/xóa bình luận của mình, @mention chỉ người trong dự án.
- **Thông báo**: khi được giao, được nhắc tên, trước hạn 24 giờ, quá hạn, đổi trạng thái; `dedupeKey` đảm bảo không gửi trùng.
- **Nhật ký**: chỉ thêm (không có API sửa/xóa); xuất CSV theo quyền, **chống formula injection**.
- **AI gateway**: hạn mức theo workspace/ngày, bật/tắt từng tính năng, timeout + thử lại tối đa 1 lần, ghi token/độ trễ/model/trạng thái; lỗi AI không ảnh hưởng CRUD. Kế hoạch & action items luôn là **nháp**, chỉ tạo công việc khi duyệt, **duyệt nhiều lần không tạo trùng**. Báo cáo: số liệu tính bằng truy vấn DB, AI chỉ viết tóm tắt/đề xuất. Hỏi đáp: lọc quyền trước khi tìm, chỉ một dự án, có trích dẫn bấm được, **thiếu chứng cứ thì từ chối**, kiểm lại quyền trước khi trả kết quả, nguồn được bọc như dữ liệu để chống prompt injection. Cảnh báo rủi ro theo **quy tắc**, AI chỉ diễn giải.
- **Quản trị**: System Admin khóa tài khoản phải có lý do, phiên bị chặn ngay, mọi hành động ghi audit; không có API đọc nội dung dự án.

## Dùng Claude thật cho Trợ lý AI

Đặt trong `AIService/.env` (khóa Anthropic chỉ nằm ở AIService, BackEnd không cần biết):

```env
ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL=claude-opus-5-5
```

Khi triển khai, đặt cùng một `AI_SERVICE_KEY` ở `AIService/.env` và `BackEnd/.env` (BackEnd gửi kèm header `x-ai-service-key`), và `AI_SERVICE_URL` ở BackEnd trỏ tới AIService.
AIService tắt hoặc lỗi ⇒ tính năng AI báo "AI đang bận" (503), mọi chức năng khác vẫn chạy.

Không đặt khoá thì dùng bộ AI nội bộ (phân rã theo mẫu quy trình, tìm kiếm từ khóa tiếng Việt có trích dẫn, trích action item theo câu "Người: nội dung") – chạy offline, phù hợp demo và test.

## Cấu trúc thư mục

```
taskflow/
├─ FrontEnd/
│  └─ src/
│     ├─ components/    # AppShell (top bar + sidebar), Select, modal công việc, UI kit, biểu đồ
│     ├─ pages/         # các màn hình
│     └─ lib/           # api client (tự refresh token), state, socket, hiệu ứng ripple, định dạng
├─ BackEnd/
│  ├─ prisma/
│  │  ├─ schema.prisma  # lược đồ PostgreSQL (bảng, quan hệ, enum, chỉ mục)
│  │  └─ migrations/    # migration SQL
│  ├─ src/
│  │  ├─ db.js          # kết nối PostgreSQL (thật hoặc nhúng), migration, tiện ích truy vấn
│  │  ├─ routes/        # auth, me, workspaces, projects, tasks, documents, notifications, dashboard, ai, admin
│  │  ├─ middleware/    # xác thực, CSRF, kiểm quyền workspace/dự án
│  │  ├─ services/      # realtime, notify, activity, metrics (dashboard/rủi ro), jobs
│  │  │  └─ ai/         # cổng gọi AIService (hạn mức, timeout, nhật ký) + thu thập dữ liệu nguồn
│  │  └─ seed.js        # dữ liệu demo Nhóm 24
│  └─ test/api.test.js  # test tích hợp theo tiêu chí nghiệm thu
├─ AIService/
│  ├─ src/
│  │  ├─ app.js         # API /v1/planner, meeting, qa, report, risk, info (kiểm tra khóa dùng chung)
│  │  ├─ llm.js         # client Anthropic Claude (tùy chọn)
│  │  ├─ text.js        # xử lý tiếng Việt (bỏ dấu, tách từ, chấm điểm)
│  │  └─ features/      # lập kế hoạch, ghi chú họp, hỏi đáp, báo cáo, diễn giải rủi ro
│  └─ test/ai.test.js
└─ scripts/dev.mjs      # chạy song song 3 dịch vụ khi phát triển
```

## Giới hạn hiện tại

- Nút "Tiếp tục với Google" cần cấu hình OAuth Client ID khi triển khai (bản này dùng email + mật khẩu).
- SMTP adapter đã có; cần cấu hình tài khoản Gmail/App Password và kiểm chứng nhận thư thật khi triển khai.
- Chuyển ngôn ngữ EN mới áp dụng cho menu điều hướng; nội dung còn lại tiếng Việt.
- Chế độ tối là lớp ghi đè màu cơ bản, chưa tinh chỉnh từng màn hình.

## Thay đổi nhánh Loc (23/10/2026)

**Cập nhật 29/10/2026:** [bàn giao code U003/U007/U009 của Lộc](docs/LOC_SPRINT1_COMPLETION_2026-10-29.md). Hoàn thiện SMTP, xóa mềm, giờ còn lại và giữ bản nháp khi realtime/xung đột phiên bản. Đạt 129 backend + 16 AIService + 36 frontend và 2 kịch bản browser. Người dùng chọn cấu hình Gmail sau; chưa xác nhận gửi Gmail thật hoặc nghiệm thu của nhóm.

Đối chiếu ngày 28/10/2026 theo workbook `(1).xlsx`: [báo cáo lịch sử trước khi sửa](docs/LOC_SPRINT1_READINESS_2026-10-28.md).

Cập nhật rà soát ngày 26/10/2026, vòng 2: [lỗi đã sửa và bằng chứng kiểm tra](docs/REVIEW_2026-10-26_ROUND2.md), gồm cài đặt AI, lời mời, phản hồi lỗi bảo mật, tải tệp và phạm vi thông báo. Bộ kiểm thử tại thời điểm đó có **111 backend + 16 AIService + 30 frontend = 157 ca**.

Rà soát ngày 26/10/2026, vòng 1: [lỗi đã sửa và bằng chứng kiểm tra](docs/REVIEW_2026-10-26.md), gồm dữ liệu và quyền cũ trên giao diện, thao tác AI bất đồng bộ, lưu/duyệt nháp, dữ liệu NUL và nhắc hạn dự án lưu trữ. Kết quả đợt đó: 109 backend + 16 AIService + 18 frontend.

Rà soát ngày 25/10/2026: [lỗi đã sửa và bằng chứng kiểm tra](docs/LOC_REVIEW_2026-10-25.md), gồm phân quyền khi thao tác đồng thời, bảo toàn tài liệu dài/TXT, phiên đăng nhập và màn hình Việc của tôi. Kết quả đợt đó: 102 backend + 16 AIService + 7 frontend.

Xem [báo cáo review](docs/LOC_REVIEW.md) và [kết quả kiểm thử](docs/LOC_TEST_RESULTS.md): 95 backend + 16 AIService, build và audit ba package đều qua.

Giữ thư mục `shared/` khi sao chép dự án. Cài lại dependency và generate Prisma trước khi chạy; có ba migration thêm pending AI, revision nguồn report và lựa chọn ghi nhớ phiên. Dừng backend trước khi generate trên Windows.

Production cần `NODE_ENV=production`, `SEED_DEMO=false`, JWT_SECRET ít nhất 32 ký tự ngẫu nhiên, AI_SERVICE_KEY và cấu hình SMTP ở trên. Mặc định không tin header proxy; đặt `TRUST_PROXY` thành IP/CIDR của reverse proxy thực tế (ví dụ `loopback` nếu proxy cùng máy), không bật tin mọi địa chỉ. `npm start` tự nó không đặt NODE_ENV. Không coi outbox demo là email đã gửi.

Ngày chót chỉ nhập ngày được hiểu hết ngày theo timezone hồ sơ; báo cáo, quota và số liệu chung dùng giờ Việt Nam. Không thay đổi ngầm timestamp các deadline cũ.
