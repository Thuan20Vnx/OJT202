# Sprint 4 — Nguyễn Bảo Lộc

Phạm vi theo `DN26_CPL_Mock_Project_Nhom24.xlsx`, sheet **Detail Plan**, dòng 140, 144, 150–152, 155. SHA-256 workbook: `d07999bf8a1cd30adfbe13487ff35b2ad56cfdba798d4473aa4fef601169532b`. Ngày thực hiện kỹ thuật: 07/11/2026; không đổi lịch Sprint trong Excel và không ghi nhận người thử chưa tham gia.

Kết quả hiện tại: [làm lại trên bản hợp nhất Agent MCP ngày 13/11](REVIEW_2026-11-13.md) — 566/566 test, 141/141 ma trận quyền (45 ca agent), 13/13 E2E, cài sạch 8/8; đã sửa lỗ hổng token agent không bị thu hồi. Bản trước: [07/11](REVIEW_2026-11-07.md), 490/490 test, 92/92 ma trận quyền.

| Mục | Sản phẩm bàn giao | Điều còn cần người thật |
|---|---|---|
| U030-T3 — ma trận API/socket/file/RAG | `npm run validate:security`, JSON expected/actual theo vai trò; 9 hồi quy thu hồi quyền/phiên khi storage chậm | Hiệp review độc lập, đối chiếu deployment |
| U032-T1 — chuẩn bị UAT | 6 slot riêng, 24 tài khoản, 12 dự án A/B, 120 task, 5 kịch bản; hướng dẫn và biểu mẫu | Chốt/mời 6 người, khai quan hệ, chạy 30 lượt quan sát thật |
| U034-T2 — hướng dẫn vai trò | [Hướng dẫn có ảnh app thật](USER_GUIDE.md) | Đạt review tính dễ dùng |
| U035-T3 — diễn tập | [Agenda 10–12 phút và Q&A](REHEARSAL.md), mẫu quan sát để trống | Hai người cùng diễn tập, đo thời lượng, ghi lỗi; Hoàng Anh review |
| Review U034-T1 — tài liệu Như | Sửa mô tả storage, tái sinh OpenAPI/ERD/manifest; đối chiếu quyền và trạng thái | Người phụ trách xác nhận phiên bản nộp |
| Review U034-T3 — cài sạch Hoàng Anh | Chạy kiểm tra cài tự động từ snapshot; mẫu cài độc lập trong INSTALL | Một thành viên khác cài từ README, ghi môi trường và log |

## Chạy lại

Từ repository root, Node >=24.15.0, đã cài dependencies theo [INSTALL](../design/INSTALL.md):

```powershell
npm run validate:security
npm run prepare:uat
npm run uat:sprint4 -- --minutes 120
```

Ma trận dùng Edge trên Windows, Chromium trên Linux (`npx playwright install --with-deps chromium`). Mỗi lần chạy tạo thư mục `.data/sprint4-loc/<command>-<timestamp>`; `--out` chỉ dùng thư mục mới vì bằng chứng không được ghi đè. `kit.json` chứa ID tài khoản/dataset; `uat-observations.json` và `rehearsal.json` là mẫu **chưa có kết quả**.

Phiên `uat:sprint4` chỉ bind `127.0.0.1`, dùng PostgreSQL/uploads tạm, mail outbox và AI nội bộ; terminal in URL. Dừng bằng Ctrl+C hoặc hết hạn thì xóa dữ liệu tạm. Thu thập quan sát và bằng chứng trước khi dừng. Người thử dùng cùng máy hoặc phiên chia sẻ màn hình có người điều phối; lệnh này không cung cấp website UAT từ xa. Production cần môi trường riêng theo runbook cả nhóm.

## Hai lỗi đã xử lý

1. Storage phản hồi chậm: logout/lock vẫn có thể hoàn tất upload; download/content có thể trả dữ liệu sau logout/lock hoặc thu hồi project. Kiểm lại phiên và ACL sau I/O, trước trả nội dung; upload kiểm trong transaction và rollback object nếu bị từ chối. 9 ca hồi quy có chốt thời điểm storage chờ, không dựa vào sleep ngẫu nhiên.
2. Q&A nội bộ có thể dùng từ chung của nguồn hiện tại để trả lời yêu cầu đọc dự án khác. Yêu cầu vượt phạm vi rõ ràng bằng tiếng Việt/Anh được từ chối trước provider; ACL vẫn lọc nguồn ở backend. Đây là lớp bổ sung cho các dạng yêu cầu đã kiểm thử, không phải cam kết phát hiện mọi prompt injection.

## Giới hạn nghiệm thu

Kết quả tự động là bằng chứng kỹ thuật local. Không thay thế hidden pack/hai người chấm (U029), tải 50 người/10.000 task và restore thật (U031), UAT 6 người (U032), HTTPS production (U033), cài độc lập (U034), hoặc diễn tập có người (U035). Chỉ gắn final tag khi `validate:release` xác nhận mọi gate trên cùng build sạch. Xem [runbook chung](../validation/SPRINT4_RUNBOOK.md).
