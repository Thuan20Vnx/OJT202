# Cài đặt và bàn giao TaskFlow

Version 2026-10-29; chạy lệnh tại thư mục chứa package.json gốc (ví dụ `D:\OJT\Project\OJT202`), không cần thư mục con tên taskflow. Node 24 là phiên bản CI đang dùng. Giữ cả `shared/`, migrations và lockfile khi sao chép.

## Máy mới — PowerShell

```powershell
npm ci
npm --prefix BackEnd ci
npm --prefix AIService ci
npm --prefix FrontEnd ci
Copy-Item BackEnd/.env.example BackEnd/.env
Copy-Item AIService/.env.example AIService/.env
npm run dev
```

Chỉ Copy-Item khi .env chưa tồn tại để tránh ghi đè cấu hình máy. Sửa JWT_SECRET và cấu hình riêng trước chạy. Web :5173, backend :4000, AIService :5000. DATABASE_URL trống dùng PostgreSQL nhúng dev, không cần Docker; lần đầu cần binary/package đúng OS. DATABASE_URL có giá trị dùng PostgreSQL được cấu hình; không đưa URL/password vào Git hoặc báo cáo.

Backend tự chạy `prisma migrate deploy` khi connectDb; DB dev trống + SEED_DEMO=true có dữ liệu demo. DB đã có dữ liệu không reset tự động. Có thể dùng `npm --prefix BackEnd run db:migrate`; không dùng migrate reset với dữ liệu người dùng. Prisma generate chạy theo package install; nếu cần chạy lại trên Windows, dừng backend trước.

Demo dev: `mai.anh@nhom24.edu.vn` (Owner/PM), `nhu@nhom24.edu.vn` (Member), `khanh.linh@nhom24.edu.vn` (Viewer); mật khẩu `TaskFlow@2026` từ seed. Không dùng tài khoản demo ở production. MAIL_MODE=outbox xem `/dev/outbox`; đây là hộp thư giả lập local. Gmail SMTP cần cấu hình và nhận thư thật riêng theo README.

## Kiểm tra kỹ thuật

```powershell
npm --prefix FrontEnd run lint
npm --prefix FrontEnd run typecheck
npm test
npm run test:e2e
node scripts/generate-contract-docs.mjs
```

Test API/E2E tạo PostgreSQL và uploads tạm, không dùng DB dev. Windows E2E dùng Edge mặc định; Linux CI cài Chromium bằng `npx playwright install --with-deps chromium`. Build cảnh báo bundle lớn không có nghĩa build thất bại; cần đo thực tế trước tối ưu. Typecheck hiện hỗ trợ JS/TS hỗn hợp, không kiểm kiểu toàn bộ JS cũ.

## Production

`NODE_ENV=production`, `SEED_DEMO=false`, PostgreSQL thật, JWT_SECRET đủ mạnh, AI_SERVICE_KEY giống nhau ở backend/AIService, SMTP TLS, CLIENT_URL đúng HTTPS origin. Build frontend rồi chạy backend và AIService theo tiến trình riêng. `npm start` không tự đặt NODE_ENV. TRUST_PROXY chỉ định proxy thực tế, không tin mọi forwarded header.

Backup DB cùng UPLOAD_DIR và env/secret qua kênh bảo mật riêng; manifest/checksum và thử restore ở môi trường cách ly trước khi tuyên bố đạt. Upload hiện là filesystem, chưa có object storage cloud. Health `/api/health` không xác nhận DB/AI readiness. Chưa có URL staging/RC thật hoặc bằng chứng deploy trong lượt này.

## Xác nhận cài sạch bởi người khác

Người thực hiện: **chưa có xác nhận**. Máy/OS/Node: —. Git hash + source-manifest: —. Ngày giờ: —. Kết quả cài/đăng nhập/CRUD/upload/AI: —. Sai khác tài liệu và issue/retest: —. Đây là phần U034-T3 của Hoàng Anh; không ký thay hoặc dùng lần chạy của tác giả làm xác nhận độc lập.
