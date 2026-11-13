# Sprint 3 của Lộc — kiểm tra lại trên bản hợp nhất main, 12/11/2026

Nguồn phân công: `DN26_CPL_Mock_Project_Nhom24 (1).xlsx`, sheet **Detail Plan**, SHA-256 `46f3c870dcf25c05003c9a979bff5c19fa154dac1c35438b6410deb35e76da16`. So với workbook cũ (`d07999bf…`), bản mới chỉ đổi trạng thái U018 ở Sprint 2 sang Done. Danh sách 11 nhiệm vụ Sprint 3 của Lộc không đổi. Workbook không bị sửa trong lượt này.

## Phạm vi

Main có 3 commit mới chưa vào Loc: Agent MCP chạy trên máy, chuỗi AI dự phòng Gemini/Groq/OpenRouter/Ollama và sửa CI. Đã hợp nhất vào Loc tại `73f4d3c`, không có xung đột git. Sáu file hai bên cùng sửa đã được đối chiếu thủ công; các thay đổi nằm ở vị trí khác nhau, không bên nào ghi đè logic bên kia. Hợp đồng Q&A, luật rủi ro, kỳ báo cáo và ghi chú họp của Lộc không bị main sửa.

## Lỗi phát hiện và đã sửa

**SPA fallback trả 404 khi đường dẫn repo có thư mục bắt đầu bằng dấu chấm.** `res.sendFile(path.join(dist, 'index.html'))` truyền đường dẫn tuyệt đối. Thư viện `send` coi mọi thành phần bắt đầu bằng dấu chấm là dotfile và từ chối, nên checkout nằm trong `.claude/worktrees/…` hoặc thư mục tương tự nhận `{"error":"Not Found"}` cho `/login`, `/`, `/board`. Hậu quả: 11/13 E2E lỗi, 2 bị hủy và 4 ca UI của ma trận bảo mật lỗi ở bước đăng nhập. Lỗi không do main gây ra; nó xuất hiện vì lượt kiểm tra chạy từ worktree.

Đã đổi thành `res.sendFile('index.html', { root: dist })` trong `BackEnd/src/app.ts`. `send` chỉ kiểm dotfile ở phần đường dẫn sau `root`. Hành vi trên checkout thông thường không đổi; `index.html` vẫn `no-store`, tệp thiếu vẫn 404. Đã sinh lại OpenAPI, ERD và source manifest.

## Kết quả trên bản cuối

Commit `c0a7ff8`, source hash `ea0a92d48788b5eb44ca052f636d93060b9bbca4abc940bd8b634c1503713b88` (`sha256-lf-v1`). Các lệnh chạy trên working tree trước commit; source hash của commit trùng bản đã kiểm thử.

| Kiểm tra | Kết quả | Bằng chứng |
|---|---|---|
| Toàn bộ test | **559/559**: validation 21, AIService 85, backend 343, frontend 96, mcp 14 | [tests-backend.txt](evidence/merge-2026-11-12/tests-backend.txt), [lint-build-tests.txt](evidence/merge-2026-11-12/lint-build-tests.txt) |
| Typecheck, build, ESLint | Đạt; còn cảnh báo chunk chính > 500 kB | [typecheck.txt](evidence/merge-2026-11-12/typecheck.txt), [lint-build-tests.txt](evidence/merge-2026-11-12/lint-build-tests.txt) |
| E2E Edge headless | **13/13** sau sửa; trước sửa 0 đạt, 11 lỗi, 2 hủy | [e2e.txt](evidence/merge-2026-11-12/e2e.txt), [e2e-before-fix.txt](evidence/merge-2026-11-12/e2e-before-fix.txt) |
| Ma trận quyền API/socket/file/RAG/UI | **92/92** sau sửa; trước sửa 86 kiểm tra, 4 ca UI lỗi | [security.json](evidence/merge-2026-11-12/security.json), [security-before-fix.txt](evidence/merge-2026-11-12/security-before-fix.txt) |
| 70 ca U025 qua HTTP | **70/70 kiểm tra kỹ thuật**, provider local, không gọi nhà cung cấp trả phí | [u025-run.json](evidence/merge-2026-11-12/u025-run.json) |

Mọi lệnh dùng PostgreSQL và uploads tạm riêng, không dùng DB dev hay Supabase. Dòng lỗi SMTP/audit/retrieval trong log là fault injection có assertion. [verification.json](evidence/merge-2026-11-12/verification.json) và [manifest.json](evidence/merge-2026-11-12/manifest.json) lưu số liệu và hash từng tệp.

## Trạng thái 11 nhiệm vụ

| Nhiệm vụ | Vai trò Lộc | Kỹ thuật | Còn cần người thật |
|---|---|---|---|
| U022-T3 | Thực hiện | Đạt trên bản hợp nhất | Đạt review; chấm ≥90% nhận định có nguồn |
| U026-T3 | Thực hiện | Đạt | Như review |
| U027-T1 | Thực hiện, Should | Đạt | Đạt review nếu nhóm nhận Should |
| U028-T1 | Thực hiện, Should | Đạt; khóa/mở khóa trong E2E và ma trận quyền | Hiệp review nếu nhóm nhận Should |
| U023-T3 | Review | Đạt; chuỗi provider dự phòng mới của main không đổi gateway quota/timeout | Lộc ký review |
| U024-T2 | Review | Đạt; E2E 13/13 | Demo và phản hồi người thật |
| U025-T0 | Review | 70/70 kỹ thuật trên bộ public | **Chưa đóng**: Hiệp bàn giao bộ kín khóa trước tinh chỉnh; hai người chấm nộp điểm |
| U026-T1 | Review | Đạt | Lộc ký review |
| U026-T2 | Review | Đạt | Lộc ký review |
| U027-T3 | Review, Should | Đạt hồi quy | Precision ≥85% trên 15 ghi chú độc lập nếu nhận Should |
| U028-T3 | Review, Should | Đạt | Lộc ký review nếu nhận Should |

Không ký thay reviewer, không đổi trạng thái trong Excel và không coi kết quả local là CI remote hay nghiệm thu độc lập. Tính năng Agent MCP mới của main không thuộc phạm vi Sprint 3 của Lộc; chỉ được kiểm qua các test có sẵn của gói `mcp`.

## Chạy lại

Từ root, Node ≥ 24.15.0:

```powershell
npm ci; npm --prefix BackEnd ci; npm --prefix AIService ci; npm --prefix FrontEnd ci; npm --prefix mcp ci
npm test
npm run build
npm --prefix FrontEnd run lint
node --test --test-concurrency=1 test/e2e/sprint1.test.mjs
npm run validate:u025 -- --out .data/validation/<ten-moi>
node scripts/sprint4-loc.mjs security --out .data/sprint4-loc/<ten-moi>
```
