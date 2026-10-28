# Sprint 1 — phần code Hoàng Anh

Phạm vi: U006-T1 (workspace/membership/tenant), U008-T1 (project và quyền PM), U010-T1 (workflow/version/thứ tự), U012-T3 (kiểm thử E2E). U001-T1 là khảo sát thực tế, không tính là hoàn thành bằng code.

## Nghiệp vụ

- Workspace được phép trùng tên; người tạo là Owner, ID/slug phân biệt nhóm.
- Chỉ Workspace Owner/Admin tạo project; người tạo được cấp PM trong cùng transaction.
- Project private: cần cả workspace membership và project membership. Owner/Admin không có project membership nhận 404 trên project/task/file/metrics và không thấy chúng trong tìm kiếm/nhật ký.
- Bảng `project_members` lưu PM/Member/Viewer. Workspace Viewer chỉ có thể là Project Viewer. Danh sách `Project.members` và `manager` được giữ tương thích với API, đồng bộ cùng transaction.
- PM quản lý roster, chuyển giao và archive/restore. Khóa dòng project bảo vệ các thao tác đồng thời; dự án luôn còn PM. Gỡ thành viên bỏ gán task và loại khỏi phòng realtime.
- Member chỉ cập nhật trạng thái/thứ tự/giờ còn lại của task mình nhận, chưa Done. To do → In progress → Review; có thể trả Review về In progress. PM duyệt Done và reopen.
- Done đặt `completedAt` và giờ còn lại = 0; reopen xóa `completedAt`, nhận giờ còn lại mới hoặc để thiếu ước lượng.
- PATCH task bắt buộc `version`; bản cũ trả 409 kèm task mới. Thay đổi task và nhật ký được commit cùng transaction; realtime phát sau commit.

## API bổ sung/thay đổi

Prefix `/api`, đăng nhập bằng cookie, request ghi có header `x-taskflow: 1`.

| Method/path | Body/chức năng |
|---|---|
| POST `/workspaces` | `{name, slug?}`; cho trùng tên |
| POST `/workspaces/:wsId/projects` | `{name, members?, memberRoles?}`; creator là PM |
| PATCH `/projects/:projectId` | Sửa project/roster; `manager` chuyển giao PM; `memberRoles` ánh xạ user ID → pm/member/viewer |
| GET/POST `/projects/:projectId/members` | Xem roster/thêm `{user, role}` |
| PATCH `/projects/:projectId/members/:userId` | `{role}` |
| DELETE `/projects/:projectId/members/:userId` | Gỡ thành viên; chặn PM cuối |
| POST `/projects/:projectId/transfer-manager` | `{user}`; PM mới phải thuộc project và không là Workspace Viewer |
| POST `/projects/:projectId/archive`, `/restore` | PM archive/restore |
| PATCH `/tasks/:id` | `{version, status?, remainingHours?, ...}`; whitelist theo quyền |
| POST `/tasks/:id/move` | `{version, status, order}` |

GET task/board/My Tasks trả quyền thao tác để UI không đề xuất thao tác bị cấm. Chỉnh project trong trang Projects có chọn vai trò và chuyển giao PM.

## Chạy kiểm tra

```powershell
npm ci
npm --prefix BackEnd ci
npm --prefix AIService ci
npm --prefix FrontEnd ci
npm test
npm run test:e2e
```

E2E dùng Playwright: Windows mặc định Microsoft Edge đã cài; máy khác chạy `npx playwright install chromium` trước. Có thể đặt `PLAYWRIGHT_CHANNEL` để chọn channel phù hợp. Test dùng PostgreSQL và upload tạm, không dùng `DATABASE_URL`/upload dev. Ảnh desktop/mobile lưu trong `.data/e2e` (được Git bỏ qua).

Suite E2E thực hiện đăng ký/xác minh, tạo workspace/project/task bằng UI; chuẩn bị lời mời và thành viên thứ hai qua API; Member đổi trạng thái tới Review, PM duyệt Done/reopen và chuyển giao bằng UI. Không có JavaScript page error mới được tính đạt. Workflow CI chạy API, migration, build và E2E, lưu ảnh kiểm tra.

## Migration

`20261028090000_project_roles` backfill project membership từ `members`/`manager` và workspace role; không tự thêm Owner/Admin ngoài project. Khởi tạo giờ còn lại từ estimate − spent. Test migration nâng một database tạm có dữ liệu theo schema cũ. Backend tự áp dụng migration khi khởi động.

Nếu dữ liệu cũ có project không còn thành viên có quyền ghi, migration dừng và chỉ rõ project cần gán PM hợp lệ; không tự cấp PM cho Viewer.

Các test local chứng minh luồng trên build hiện tại. Demo với mentor, PR review và kiểm tra trên staging là các bằng chứng cần bổ sung trước khi đánh Done theo quy trình nhóm.
