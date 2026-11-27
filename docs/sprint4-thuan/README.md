# Sprint 4: Trần Xuân Thuận

Phạm vi theo sheet **Detail Plan** của `DN26_CPL_Mock_Project_Nhom24.xlsx`, các việc giao cho Thuận còn mở: U031-T1 (hiệu năng, độ bền dữ liệu), U033-T1 (build, triển khai, healthcheck, rollback), U030-T2 (giao diện theo vai trò). Thực hiện ngày 18–19/11/2026 trên commit `d3c45a6` cộng phần thay đổi chưa commit, nên bằng chứng ghi `dirty: true`. Muốn dùng làm gate release thì phải chạy lại trên build sạch.

| Việc | Sản phẩm | Lệnh chạy lại | Kết quả |
|---|---|---|---|
| U031-T1 | Đo 50 người dùng / 10.000 task trên DB nhúng **và Supabase thật**, đếm câu SQL, EXPLAIN, sao lưu/khôi phục DB + tệp | `npm run validate:performance [-- --target supabase]`, `npm run validate:queries` | Supabase: p95 đọc **502 ms** (trước tối ưu 1.891). DB nhúng: 89 ms, stress 739 ms. 0 lỗi, khôi phục khớp |
| U033-T1 | `Dockerfile`, `AIService/Dockerfile`, `docker-compose.yml`, `/api/health/ready`, job CI `docker`, [runbook phát hành/rollback](../RELEASE_RUNBOOK.md) | CI job `docker` | Chưa build được trên máy này (không có Docker). CI sẽ build và chạy thử |
| U030-T2 | Ma trận giao diện 4 vai trò trên Edge thật | `npm run validate:ui-roles` | **39/39** ô đạt; thử tắt bộ lọc quyền thông báo thì ma trận báo đỏ |

## U031: hiệu năng và độ bền dữ liệu

### Cách đo

`scripts/validation/performance.mjs` dựng dữ liệu gồm 50 tài khoản, 20 dự án × 500 task = 10.000 task (tổng 10.050), 5.000 bình luận, phụ thuộc giữa các việc và 40 tệp. Mỗi người dùng ảo:

- đăng nhập bằng tài khoản riêng, xong trước khi bắt đầu đo;
- chỉ ở 2 dự án của mình;
- lặp 6 vòng, mỗi vòng 10 thao tác: hồ sơ, Việc của tôi, danh sách dự án, Kanban, Tổng quan, chi tiết việc, bình luận, tìm kiếm, thông báo, **gửi 1 bình luận**;
- nghỉ 1–3 giây giữa hai thao tác.

Bộ tạo tải chạy trong worker thread riêng. Thời gian đo tính từ trước `fetch` đến khi đọc xong body. Prisma ghi mọi câu SQL, rồi các câu tốn nhiều thời gian nhất được `EXPLAIN (ANALYZE, BUFFERS)` lại.

Hai nơi đặt database:

- **DB nhúng** (mặc định): PostgreSQL tạm trên máy, không bao giờ dùng `DATABASE_URL`.
- **Supabase thật** (`--target supabase`): dùng `DATABASE_URL` trong `BackEnd/.env` nhưng mọi bảng thử nằm trong **schema riêng `perf_u031`**. Schema `public` không bị đụng. Schema đo phải chưa tồn tại, và luôn bị xóa khi xong, kể cả khi lỗi. Trước khi đo đã sao lưu `public` (chỉ đọc) ra `Documents/taskflow-backups/`. Sau mỗi lần đo đã kiểm: không còn schema `perf_*`, số dòng trong `public` không đổi.

API và client chạy trên máy ở Việt Nam (Ryzen 9 8945HS, Node 24.21). Supabase ở Singapore (PostgreSQL 17.11, pooler phiên). Mỗi lượt đi-về tới Supabase mất **~52 ms**.

### Kết quả

| Bài đo | p50 đọc | p95 đọc | p95 ghi | Request/s | Lỗi | Bằng chứng |
|---|---:|---:|---:|---:|---:|---|
| **Supabase**, 50 người, nghỉ 1–3 s | 218 ms | **502 ms** | 610 ms | 20,6 | 0 | [u031-supabase](evidence/u031-supabase/performance-restore.json) |
| DB nhúng, 50 người, nghỉ 1–3 s | 16 ms | **89 ms** | 26 ms | 22,9 | 0 | [u031-realistic](evidence/u031-realistic/performance-restore.json) |
| DB nhúng, stress, nghỉ 50–250 ms | 173 ms | **739 ms** | 657 ms | 119 | 0 | [u031-stress](evidence/u031-stress/performance-restore.json) |

Supabase, p50/p95 từng thao tác (ms): Tổng quan 323/864, Kanban 377/601, Việc của tôi 229/440, chi tiết việc 175/367, tìm kiếm 230/373, gửi bình luận 485/610.

Cả ba bài đo đều đạt gate U031 trong `scripts/validation/release.mjs`. Riêng Tổng quan trên Supabase vẫn có p95 864 ms nếu xét từng endpoint.

### Tối ưu: trước và sau

Khi chạy trên Supabase, mỗi câu SQL tốn ~52 ms đường mạng nhưng chỉ ~1 ms trên server. Pooler phiên cho tối đa **15 kết nối** (vượt sẽ báo `EMAXCONNSESSION`). Pooler transaction cổng 6543 đo được còn chậm hơn: 80 so với 195 truy vấn/s. Vì vậy, với một tiến trình API, **tổng số câu SQL là trần thông lượng**, và **số câu SQL nối tiếp là độ trễ**.

`npm run validate:queries -- --target supabase` đếm số câu SQL của từng thao tác ([bằng chứng](evidence/queries-supabase/query-profile.json)):

| Thao tác (1 người, Supabase) | Câu SQL trước → sau | Thời gian trước → sau |
|---|---:|---:|
| Chi tiết việc | 18 → 4 | 987 → 182 ms |
| Tổng quan | 21 → 11 | 630 → 333 ms |
| Kanban / tìm kiếm | 14 / 19 → 4 / 4 | 552 / 525 → 228 / 242 ms |
| Việc của tôi | 14 → 5 | 445 → 173 ms |
| Danh sách dự án | 9 → 7 | 389 → 276 ms |
| Cả vòng 10 thao tác | ~108 → 51 | |

Các thay đổi:

1. **Xác thực lặp lại** (`middleware/auth.js`). Mỗi router gắn `requireAuth` riêng, nên một request đi qua 2–4 router bị kiểm phiên 2–4 lần nối tiếp. Giờ mỗi request chỉ kiểm một lần.
2. **Chi tiết việc chạy trong transaction** (`routes/tasks.js`). Transaction `RepeatableRead` (Lộc thêm để chi tiết việc không trả dữ liệu lệch nhau) buộc 18 câu chạy nối tiếp trên một kết nối, dù code viết `Promise.all`. Giờ mọi phần phải khớp nhau (việc, người nhận, người tạo, người cùng làm, checklist, việc con, tệp, số đếm, quyền) nằm trong **một câu SQL** (Prisma `relationJoins`), tự nhất quán như snapshot. Phần còn lại (việc chặn, nhật ký) chạy song song sau đó. `loadTask` (trả về sau khi sửa việc) làm tương tự.
3. **Kanban, tìm kiếm, lịch** dùng `listTasks`: một câu `include` cho mọi dữ liệu đi kèm, cộng một câu cho việc chặn (thay 8 câu). `enrich` còn lại chạy mọi truy vấn trong một lượt.
4. **Việc của tôi**: danh sách bằng một câu `include`. 5 câu đếm tóm tắt gộp thành một câu lấy `status/dueDate/completedAt` của các việc của mình rồi đếm bằng JS.
5. **Tổng quan**:
   - Toàn bộ việc của dự án tải một lần, dùng chung cho số liệu và cảnh báo rủi ro (trước đây tải 3 lần). Việc chặn và số việc con tra trong bộ nhớ.
   - Tên người nhận nạp song song.
   - Tải tuần gộp người dùng, membership và vai trò dự án thành một câu.
   - Nhật ký gần đây lấy người làm bằng `include`.
6. Bình luận không có `@` thì không tra danh sách thành viên.
7. Từ đợt trước: bình luận dùng **khóa workspace chia sẻ** (`FOR SHARE`, p95 ghi 3.481 → 41 ms trên DB nhúng), và `isTimeZone` nhớ múi giờ hợp lệ.

**Kiểm chứng không đổi hành vi:** mỗi thay đổi được so trên cùng dữ liệu với cài đặt cũ (lấy từ git), bằng script tạm đã xóa sau khi xong:

| Thao tác | Phạm vi so sánh | Kết quả |
|---|---|---|
| Chi tiết việc và `loadTask` | 6 việc × 2 vai trò; có việc con đã xóa, việc chặn khác dự án, bình luận đã xóa | 18/18 giống hệt |
| Kanban, tìm kiếm, lịch | PM, thành viên, Viewer | 24/24 |
| Việc của tôi | 2 người × 2 workspace × 12 bộ lọc, gồm số liệu tóm tắt | 48/48 |
| Tổng quan | 15 trường hợp | 15/15, kể cả mã `sourceVersion` của cảnh báo rủi ro; chỉ bỏ qua `generatedAt` là thời điểm gọi |

Test BackEnd vẫn 368/368, e2e 13/13.

### EXPLAIN

Các câu SQL tốn nhiều thời gian nhất đọc bảng `tasks` qua chỉ mục: `tasks_project_id_aiDraftItem_key` (tiền tố `project_id`), `tasks_project_status_due_idx`, `tasks_parent_task_id_idx`. Thời gian thực thi trên server dưới 5 ms. Seq Scan chỉ xuất hiện ở bảng nhỏ. Không cần thêm chỉ mục: nút thắt là số lượt đi-về, không phải chỉ mục.

### Còn lại

- Production dự kiến đặt API ở Render Singapore, cùng vùng với Supabase, nên mỗi lượt đi-về chỉ còn vài ms thay vì ~52 ms. Số đo từ máy ở Việt Nam là trường hợp xấu. Chưa đo trên Render vì chưa deploy.
- Có thể giảm tiếp:
  - Tổng quan (11 câu, p95 864 ms trên Supabase);
  - gửi bình luận (8 câu, phần lớn là BEGIN/khóa/COMMIT bắt buộc);
  - mỗi request vẫn kiểm phiên bằng 1 câu SQL. Cache phiên sẽ làm chậm việc thu hồi phiên, nên chưa làm.
- Bộ đo cần `pg_dump`/`pg_restore` ≥ bản server (máy này dùng client PostgreSQL 18), nên chưa đưa vào CI.

### Sao lưu và khôi phục

`npm run db:backup` và `npm run db:restore` (trong `BackEnd`, mã ở `scripts/lib/backup-core.js`):

- **Sao lưu** chỉ đọc nguồn. Nó dùng `pg_dump --format=custom --schema=public`, cộng mọi tệp mà `documents.storageKey` tham chiếu (Supabase Storage hoặc `UPLOAD_DIR`). `manifest.json` ghi SHA-256 từng tệp, số dòng từng bảng, danh sách migration và `backupHash`. Thư mục đích phải mới (không ghi đè). Tệp được tham chiếu nhưng không còn trong kho thì ghi vào `missingFiles`.
- **Khôi phục** kiểm checksum trước khi ghi. Nó không bao giờ tự lấy `DATABASE_URL` mà bắt buộc `--target-url`/`RESTORE_DATABASE_URL` và `--yes`. Database đích đã có bảng thì phải thêm `--clean`. Không khôi phục mục `CREATE SCHEMA public`, nên `--clean` không xóa schema (an toàn với Supabase). Sau khi khôi phục, nó đếm lại từng bảng, đọc lại từng tệp và so với manifest.
- Mật khẩu đi qua biến môi trường `PGPASSWORD`, không nằm trên dòng lệnh.
- **Diễn tập** (10.050 task, 15.864 dòng, 39 bảng, 27 migration, 42 tệp):
  - DB nhúng: sao lưu 0,5 s (895 KB), khôi phục vào database mới 0,7 s.
  - **Supabase thật**: sao lưu schema đo 13 s, xóa schema, khôi phục lại 24 s.
  - Cả hai lần: mọi bảng và tệp khớp.
- Đã sao lưu thật schema `public` của Supabase (39 bảng, 367 dòng, 2 tệp) trước khi đo, và kiểm checksum bằng `--verify-only`.

### Chưa làm / cần người thật

- Phần Supabase Storage của script chưa thử với tài khoản thật (`.env` hiện lưu tệp ở `UPLOAD_DIR`).
- Bộ đo cần `pg_dump`/`pg_restore` ≥ bản server (máy này dùng client PostgreSQL 18). CI Ubuntu chỉ có client 16, nên chưa đưa `validate:performance` vào CI.

## U033-T1: build, triển khai, healthcheck, rollback

- `/api/health/ready`: truy vấn DB trong 3 s, nếu không được thì trả 503. Đây là readiness của Render (`render.yaml`) và Docker `HEALTHCHECK`. `/api/health` giữ vai trò liveness và báo mã commit.
- `Dockerfile` build 3 bước (web → thư viện production → image chạy bằng user `node`), không có PostgreSQL nhúng, nhận `RELEASE_SHA`. `AIService/Dockerfile` riêng. `docker-compose.yml` thêm PostgreSQL 17 và volume tệp. Bí mật nằm trong `.env.docker` (đã ignore, mẫu `.env.docker.example`). `.dockerignore` loại `.env`, `.data`, `node_modules`.
- CI job `docker` build hai image, chạy compose với bí mật ngẫu nhiên, rồi kiểm: readiness có `db:"up"`, `/api/health` đúng mã commit, `/board` trả SPA, `/api/workspaces` trả 401, AIService khỏe.
- [RELEASE_RUNBOOK.md](../RELEASE_RUNBOOK.md): phát hành, sao lưu trước migration, rollback code, rollback khi đã chạy migration.
- **Chưa kiểm chứng**: máy này không có Docker, nên Dockerfile/compose mới chỉ được kiểm cú pháp YAML; job CI sẽ là lần build đầu. Chưa deploy production (theo quyết định chưa deploy), nên U033-T2 (smoke HTTPS thật) vẫn chờ.

## U030-T2: giao diện theo vai trò

`scripts/validation/ui-role-matrix.mjs` đăng nhập 4 vai trò (PM, thành viên, Viewer, người ngoài workspace) trên Edge headless, dùng database tạm. Kỳ vọng lấy từ quy tắc phía server, không lấy từ giao diện. [Kết quả](evidence/u030-ui-roles/ui-role-matrix.json) kèm ảnh chụp từng vai trò.

| Bề mặt | Kiểm tra |
|---|---|
| Bảng công việc | Nút "Tạo công việc" chỉ bấm được với PM; người ngoài trỏ vào dự án qua `tf_project` không thấy dữ liệu |
| Chi tiết việc | Menu xóa chỉ PM; ô bình luận cho PM + thành viên; Viewer thấy lý do không bình luận được; link việc của dự án khác không hiện nội dung |
| Cài đặt | Nút "Mời thành viên" chỉ Owner/Admin |
| Thông báo | Như được nhắc tên ở dự án B rồi bị gỡ khỏi dự án: thông báo đó biến mất, còn thông báo ở dự án A vẫn hiện (đối chứng) |
| Nguồn AI | Trích dẫn Hỏi đáp chỉ trỏ tới task/tài liệu trong dự án, số nút nguồn khớp API; lịch sử hỏi đáp riêng từng người |
| Trình duyệt | Không có lỗi JS ở cả 4 vai trò |

**Kiểm ngược:** tạm bỏ điều kiện lọc theo dự án trong `routes/notifications.js` thì ô `notifications-after-removal` của thành viên chuyển sang đỏ. Code đã trả lại nguyên trạng. Ma trận đã thêm vào CI (sau bước `validate:local`).

Chưa bao phủ: email thông báo (môi trường thử dùng outbox), giao diện điện thoại, vai trò Giảng viên và Admin hệ thống.
