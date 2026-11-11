# TypeScript trong bản bàn giao Sprint 1

U002-T1/T2 yêu cầu khởi tạo backend Node/Express + TypeScript và frontend React/Vite + TypeScript, routing, layout. Bản bàn giao đã thêm cấu hình strict và chuyển các điểm vào ứng dụng sang TypeScript:

| Backend | Frontend |
|---|---|
| `src/index.ts`: khởi động server | `src/main.tsx`: mount React |
| `src/app.ts`: Express, router, middleware | `src/App.tsx`: route và các gate xác thực/workspace |
| `src/services/acceptance-criteria.ts`: chuẩn hóa/validation đầu vào | `src/components/AppShell.tsx`: layout, navigation, tìm kiếm |
| `tsconfig.json`: NodeNext, strict, noEmit | `src/lib/api.ts`: API generic, lỗi, refresh, tải file |
| | `src/lib/app-context.ts`: contract context và hook |

Các file `app.js` backend và `api.js` frontend chỉ re-export để các import cũ hoạt động. Không có bản logic thứ hai cần đồng bộ.

## Chạy và kiểm tra

Node >=24.15.0 chạy cú pháp TypeScript có thể xóa kiểu trực tiếp; runtime không thay thế kiểm tra kiểu. Cài dependency ở root và ba package theo lockfile. Chạy `npm run typecheck`, `npm test`, `npm run test:e2e`. Lệnh build root tự chạy typecheck trước Vite. CI cũng có bước typecheck riêng để lỗi kiểu làm job thất bại sớm.

`erasableSyntaxOnly` không cho dùng cú pháp cần biến đổi runtime như enum/parameter property. Import kiểu dùng `import type`; import module `.ts`/`.tsx` ghi rõ phần mở rộng. Backend không có bước xuất JavaScript nên không cần thư mục build backend.

`allowJs: true`, `checkJs: false` cho phép di chuyển dần. Typecheck strict áp dụng các module TS/TSX liệt kê trên; các route/service và trang JS/JSX cũ vẫn được kiểm chứng bằng bộ test, chưa có bảo đảm static type toàn repo. Context là contract giữa provider JS và consumer TS, chưa chứng minh provider JS đúng kiểu bằng tsc. Dữ liệu mạng vẫn phải được server validation; generic của client không xác thực JSON tại runtime. AIService vẫn là JavaScript.

Nguồn kỹ thuật: [Node.js: TypeScript](https://nodejs.org/download/release/v24.20.0/docs/api/typescript.html), [TypeScript: TSConfig](https://www.typescriptlang.org/tsconfig/).
