# Phát hành, sao lưu và rollback TaskFlow

Áp dụng cho U033-T1 (build, pipeline, cấu hình, healthcheck, rollback) và phần sao lưu của U031. Có hai cách chạy production, dùng chung quy trình:

| Cách | Thành phần | Tài liệu |
|---|---|---|
| Gói free (đang dự kiến) | Vercel (web) → Render (API + AIService) → Supabase (DB + tệp) | [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md), `render.yaml`, `vercel.json` |
| Docker (VPS hoặc máy chủ trường) | `Dockerfile` (API + web cùng origin), `AIService/Dockerfile`, `docker-compose.yml` (thêm PostgreSQL 17) | mục 2 dưới đây |

## 1. Hai đường kiểm tra sức khỏe

| Đường | Ý nghĩa | Dùng cho |
|---|---|---|
| `GET /api/health` | Tiến trình còn sống, trả `build.revision` = `RELEASE_SHA` | Biết đang chạy bản nào, smoke |
| `GET /api/health/ready` | Truy vấn được database trong 3 giây; nếu không thì trả **503** | Render `healthCheckPath`, Docker `HEALTHCHECK`, `compose --wait` |
| `GET /health` (AIService) | AIService sống, nhà cung cấp AI đang dùng | Docker `HEALTHCHECK` của `ai` |

AIService chết không làm API "không sẵn sàng". Các tính năng AI trả 503 `AI_UNAVAILABLE`, còn CRUD vẫn chạy.

## 2. Build và chạy bằng Docker

```powershell
Copy-Item .env.docker.example .env.docker   # điền mật khẩu DB, JWT_SECRET (>=32 ký tự), AI_SERVICE_KEY, SMTP
$env:RELEASE_SHA = git rev-parse HEAD
docker compose --env-file .env.docker up -d --build --wait
curl.exe http://localhost:4000/api/health/ready
```

- Image gắn tag theo commit (`taskflow:<sha>`, `taskflow-ai:<sha>`). Rollback chính là chạy lại tag cũ.
- Image không chứa `.env`, `.data` hay `node_modules` của máy build (`.dockerignore`). Bí mật chỉ đi vào lúc chạy qua `.env.docker`, file này đã có trong `.gitignore`.
- Khi khởi động, server tự chạy `prisma migrate deploy` rồi mới nhận request. Production chặn `SEED_DEMO=true`, `MAIL_MODE=outbox`, JWT yếu và thiếu `AI_SERVICE_KEY`.
- CI (job `docker` trong `.github/workflows/ci.yml`) build cả hai image, chạy compose và kiểm tra: readiness có `db:"up"`, `/api/health` trả đúng mã commit, `/board` trả SPA, `/api/workspaces` trả 401, AIService khỏe.

## 3. Quy trình phát hành

1. **Đóng băng bản**: `main` xanh CI (test + docker), ghi lại mã commit.
2. **Sao lưu trước khi đổi schema** (bắt buộc nếu bản mới có thư mục mới trong `BackEnd/prisma/migrations`):
   ```powershell
   cd BackEnd
   npm run db:backup -- --out ..\..\taskflow-backups\truoc-<sha>
   ```
   Lệnh này chỉ đọc nguồn. Nó dump schema `public` bằng `pg_dump` (bản client phải >= bản server; trên Windows tự tìm trong `C:\Program Files\PostgreSQL\*\bin`, hoặc đặt `PG_BIN`) và chép mọi tệp mà bảng `documents` tham chiếu, từ Supabase Storage hoặc `UPLOAD_DIR`. Kết quả có `manifest.json` ghi SHA-256 của từng tệp, số dòng từng bảng và danh sách migration. Lưu bản sao lưu **ngoài repo** (repo public).
3. **Triển khai**:
   - Render: push `main` (Blueprint tự build) hoặc bấm *Manual Deploy*. Render chỉ chuyển traffic khi `/api/health/ready` đạt.
   - Docker: `docker compose --env-file .env.docker up -d --build --wait`.
4. **Smoke** trên URL HTTPS thật (U033-T2): `npm run validate:smoke -- --url https://<origin> --out .data/validation/production-<sha>`.
5. **Theo dõi 15 phút**: log lỗi 5xx, nhật ký job. Nếu có lỗi nghiêm trọng thì sang mục 4.

## 4. Rollback

### 4.1 Chỉ đổi code (không có migration mới)

- Render: *Events → Rollback* về deploy trước, hoặc *Manual Deploy* commit cũ.
- Docker: `$env:RELEASE_SHA = "<sha cũ>"; docker compose --env-file .env.docker up -d --no-build --wait` (image cũ vẫn còn trên máy). Nếu đã xóa image cũ thì checkout tag/commit cũ rồi build lại.
- Kiểm tra `/api/health` thấy `build.revision` là mã cũ.

### 4.2 Bản lỗi đã chạy migration

Migration của Prisma chỉ đi tới, không tự lùi. Chọn một trong hai cách:

1. **Sửa tiến (ưu tiên)**: nếu migration chỉ thêm bảng/cột (đa số migration của dự án), code cũ vẫn chạy được với schema mới. Rollback code như mục 4.1, giữ database, rồi phát hành bản sửa.
2. **Khôi phục dữ liệu** khi migration làm hỏng hoặc xóa dữ liệu:
   ```powershell
   cd BackEnd
   npm run db:restore -- --from <thư mục sao lưu> --verify-only          # kiểm checksum, không ghi gì
   $env:RESTORE_DATABASE_URL = "<database MỚI, rỗng>"                   # không dán mật khẩu vào lệnh
   npm run db:restore -- --from <thư mục sao lưu> --yes [--supabase | --upload-dir <thư mục>]
   ```
   Checksum trong `manifest.json` chỉ phát hiện tệp hỏng/thiếu, không chống người cố ý sửa (không có chữ ký): cất bản sao lưu ở nơi chỉ người vận hành ghi được. `--clean` chỉ xóa đối tượng có trong bản dump; bảng thừa ở đích sẽ làm lệch số đếm, nên tốt nhất khôi phục vào database mới, trống.

   Lệnh restore **không bao giờ** tự lấy `DATABASE_URL`. Nếu database đích đã có bảng, nó từ chối trừ khi thêm `--clean`. Sau khi khôi phục, nó đếm lại từng bảng và so với manifest, đọc lại từng tệp và so checksum. Khi đạt, trỏ `DATABASE_URL` của bản code cũ sang database vừa khôi phục, chạy code cũ (mục 4.1), giữ database lỗi để điều tra. Dữ liệu phát sinh sau lúc sao lưu sẽ mất, cần báo cho người dùng.

## 5. Diễn tập đã chạy (U031)

`npm run validate:performance` dựng database tạm và chạy diễn tập: sao lưu bằng script ở trên → khôi phục vào database mới → đối chiếu 39 bảng + 42 tệp. Kết quả xem [sprint4-thuan/README.md](sprint4-thuan/README.md). Chưa diễn tập trên Supabase thật: cần một project Supabase trống làm đích và người dùng cho phép đọc production.
