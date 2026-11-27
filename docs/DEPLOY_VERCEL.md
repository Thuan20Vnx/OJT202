# Deploy TaskFlow miễn phí: Vercel + Render + Supabase

Vercel chỉ chạy **FrontEnd**. BackEnd cần server chạy liên tục cho Socket.io và job định kỳ, nên đặt trên gói free của Render.

```text
Trình duyệt ──> Vercel (FrontEnd) ── /api, /socket.io ──> Render (BackEnd) ──> Supabase (database, tệp)
                                                              ├──> Render (AIService)
                                                              └──> Gmail API (gửi mail)
```

Trình duyệt chỉ làm việc với domain Vercel, nên cookie đăng nhập vẫn là cookie cùng site. `vercel.json` và `render.yaml` đã cấu hình sẵn.

## Thứ tự thực hiện

1. Chuẩn bị Google và Gmail API (mục 1, 2).
2. Chuẩn bị Supabase (mục 3).
3. Deploy Render để biết URL BackEnd (mục 4).
4. Trỏ `vercel.json` về Render, deploy Vercel (mục 5).
5. Điền `CLIENT_URL`, cập nhật Google Console (mục 6).

**Trước khi mở công khai:** chạy `node scripts/check-demo-accounts.js` trong `BackEnd` với `DATABASE_URL` của production. Tài khoản demo dùng mật khẩu ghi công khai trong repo, nên phải xóa hoặc đổi mật khẩu.

## 1. Google Client ID (đăng nhập Google)

1. Vào [Google Cloud Console](https://console.cloud.google.com/), tạo project `TaskFlow`.
2. **APIs & Services → OAuth consent screen**: chọn *External*, điền tên app và email.
3. **Credentials → Create credentials → OAuth client ID**, chọn *Web application*.
4. Ở **Authorized JavaScript origins**, thêm `http://localhost` và `http://localhost:5173`. URL Vercel thêm ở mục 6.
5. Ở **Authorized redirect URIs**, thêm `https://developers.google.com/oauthplayground` (dùng ở mục 2).
6. Lưu lại **Client ID** và **Client secret**.

## 2. Gmail no-reply qua Gmail API

Gói free của Render chặn cổng SMTP 465 và 587, nên mail gửi bằng Gmail API qua HTTPS.

1. Tạo tài khoản Gmail mới, ví dụ `taskflow.noreply@gmail.com`.
2. Trong project ở mục 1: **APIs & Services → Library**, bật **Gmail API**.
3. Ở **OAuth consent screen**, bấm **Publish app** để chuyển sang *In production*. Nếu giữ *Testing*, refresh token sẽ hết hạn sau 7 ngày và ngừng gửi được mail.
4. Mở [OAuth Playground](https://developers.google.com/oauthplayground), bấm biểu tượng bánh răng, chọn **Use your own OAuth credentials** và điền Client ID, Client secret.
5. Ở ô scope, nhập `https://www.googleapis.com/auth/gmail.send`, bấm **Authorize APIs**.
6. Đăng nhập bằng **tài khoản no-reply**. Google sẽ cảnh báo app chưa xác minh; chọn **Advanced → Go to TaskFlow** vì đây là app của chính bạn.
7. Bấm **Exchange authorization code for tokens** và lưu **Refresh token**.

Giữ refresh token như mật khẩu, không commit. Token có thể mất hiệu lực nếu bị thu hồi hoặc lâu không dùng; khi đó lặp lại bước 4–7.

## 3. Supabase

**Database:** lấy chuỗi **Session pooler** ở **Connect**, thêm `sslmode=require&connection_limit=10`.

**Lưu tệp:**
1. **Storage → New bucket**, đặt tên `taskflow-uploads`, để **Private**.
2. **Project Settings → API**, lưu **Project URL** và khóa **service_role** hoặc **secret**.

Khóa này có toàn quyền trên project: chỉ đặt ở Render, không đưa vào FrontEnd hay repo.

## 4. Deploy BackEnd trên Render

1. Vào [Render](https://dashboard.render.com/) → **New → Blueprint** và chọn repo.
2. Điền các biến:

| Biến | Giá trị |
|---|---|
| `DATABASE_URL` | Chuỗi ở mục 3 |
| `CLIENT_URL` | Tạm điền `https://example.vercel.app`, sửa ở mục 6 |
| `MAIL_FROM` | `TaskFlow No-Reply <taskflow.noreply@gmail.com>` |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` | Client ID và secret ở mục 1 |
| `GMAIL_REFRESH_TOKEN` | Refresh token ở mục 2 |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Project URL và khóa ở mục 3 |
| `GOOGLE_CLIENT_ID` | Client ID ở mục 1 |
| `AI_SERVICE_URL` | URL của `taskflow-ai`, ví dụ `https://taskflow-ai.onrender.com` |
| `GEMINI_API_KEY` | Để trống nếu dùng bộ luật nội bộ |

3. Ghi lại URL của dịch vụ `taskflow`. Lần khởi động đầu tiên sẽ tự áp migration lên Supabase.

## 5. Deploy FrontEnd trên Vercel

1. Nếu URL Render khác `https://taskflow.onrender.com`, sửa hai dòng `destination` trong `vercel.json`, rồi commit và push.
2. Vào [Vercel](https://vercel.com/new), import repo.
3. Giữ **Root Directory** là thư mục gốc. Không chọn `FrontEnd`, vì FrontEnd còn dùng `shared/dates.mjs` nằm ngoài thư mục đó.
4. Thêm biến `VITE_GOOGLE_CLIENT_ID` với giá trị Client ID, rồi bấm **Deploy**.

Vite nhúng biến này lúc build, nên đổi giá trị thì phải deploy lại.

## 6. Nối hai bên

1. Render → dịch vụ `taskflow` → **Environment**: sửa `CLIENT_URL` thành URL production của Vercel, không có `/` ở cuối.
2. Google Console: thêm URL Vercel vào **Authorized JavaScript origins**.

## 7. Kiểm tra sau khi deploy

| Kiểm tra | Kết quả mong đợi |
|---|---|
| Mở `https://<vercel>/api/health` | `{"ok":true,...}`; lần đầu có thể mất khoảng một phút |
| Tải lại trực tiếp trang `/board` | Trang mở bình thường, không lỗi 404 |
| Đăng ký bằng email thật | Nhận mail từ địa chỉ no-reply, nhập OTP thành công |
| Quên mật khẩu | Nhận mã, đổi được mật khẩu |
| Đăng nhập Google | Vào được ứng dụng |
| Mở hai trình duyệt, sửa một công việc | Trình duyệt kia tự cập nhật |
| Tải lên rồi tải xuống tệp lớn hơn 5 MB | Thành công, giới hạn của ứng dụng là 10 MB |
| Deploy lại rồi tải xuống tệp cũ | Tệp vẫn còn |
| Mở **Hồ sơ**, xem IP của phiên | Đúng IP công khai của bạn |

Nếu IP sai, tăng `TRUST_PROXY` trên Render từng bậc (2, 3, 4) đến khi đúng. Số quá nhỏ làm nhiều người dùng chung một giới hạn đăng nhập; số quá lớn cho phép giả mạo IP.

## Giới hạn của gói miễn phí

- **Render ngủ sau 15 phút không có truy cập**, lần gọi tiếp theo chờ khoảng một phút. Khi ngủ, job định kỳ (như nhắc hạn) cũng dừng nên thông báo có thể đến muộn.
- **Render có 750 giờ free mỗi tháng cho cả workspace**, dùng chung cho hai dịch vụ. Hết giờ thì dịch vụ bị tạm dừng đến tháng sau; đừng dùng công cụ ping để giữ server luôn thức.
- **AIService cũng ngủ**, nên lần gọi AI đầu tiên có thể báo lỗi tạm thời; thử lại sau một phút.
- **Supabase free** có 500 MB database, khoảng 1 GB tệp, và tạm dừng project sau khoảng một tuần ít hoạt động; khôi phục trong dashboard.
- **Realtime dùng polling.** Tài liệu Vercel không xác nhận rewrite sang server ngoài chuyển tiếp được WebSocket. Khi đó Socket.io tự ở lại polling, độ trễ và số request cao hơn một chút.
- **Rewrite của Vercel chờ tối đa 120 giây**, đủ cho lần Render thức dậy nếu khởi động bình thường.
- **Chỉ domain production hoạt động đầy đủ.** URL preview của Vercel không khớp `CLIENT_URL` và Google Console.
- **Gói Hobby của Vercel** dành cho dự án cá nhân, không thương mại.

Phù hợp cho demo và đồ án. Khi có người dùng thật, nên nâng cấp Render để không bị ngủ.

## Sự cố thường gặp

| Hiện tượng | Nguyên nhân thường gặp |
|---|---|
| Trang báo không kết nối được máy chủ | Render đang thức dậy (đợi một phút), hoặc `destination` trong `vercel.json` sai |
| Lỗi 403 "Origin không được phép" | `CLIENT_URL` không khớp domain đang mở |
| Nút Google báo chưa cấu hình | Thiếu `VITE_GOOGLE_CLIENT_ID` lúc build; thêm rồi deploy lại |
| Nút Google báo lỗi origin | Chưa thêm URL vào Authorized JavaScript origins |
| Lỗi `MAIL_UNAVAILABLE` | Refresh token hết hạn hoặc bị thu hồi, app còn ở *Testing*, chưa bật Gmail API, hoặc sai Client secret |
| Tải tệp lên báo lỗi | Sai `SUPABASE_URL`/khóa, hoặc chưa tạo bucket `taskflow-uploads` |
| Build lỗi không tìm thấy `shared/dates.mjs` | Root Directory đang đặt là `FrontEnd` |
