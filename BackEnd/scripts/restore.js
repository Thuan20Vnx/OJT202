// Khôi phục một bản sao lưu vào database được CHỈ ĐỊNH RÕ (không bao giờ tự lấy DATABASE_URL).
// Chạy trong BackEnd:
//   npm run db:restore -- --from <thư mục sao lưu> --target-url <postgresql://...> --yes [--clean]
//                         [--upload-dir <thư mục> | --supabase] [--no-files] [--verify-only]
// --target-url có thể thay bằng biến RESTORE_DATABASE_URL (để mật khẩu không nằm trong lịch sử lệnh).
// --clean: cho phép ghi đè database đích đang có bảng. --verify-only: chỉ kiểm checksum, không ghi gì.
import { parseArgs } from 'node:util';
import { config } from '../src/config.js';
import { describe, restore, verifyBackup } from './lib/backup-core.js';

const { values } = parseArgs({
  options: {
    from: { type: 'string' }, 'target-url': { type: 'string' }, yes: { type: 'boolean', default: false },
    clean: { type: 'boolean', default: false }, 'upload-dir': { type: 'string' }, supabase: { type: 'boolean', default: false },
    'no-files': { type: 'boolean', default: false }, 'verify-only': { type: 'boolean', default: false },
  },
});

try {
  if (!values.from) throw new Error('Thiếu --from <thư mục sao lưu>');
  if (values['verify-only']) {
    const m = await verifyBackup(values.from);
    console.log(`Bản sao lưu hợp lệ: ${Object.keys(m.files).length} tệp, tạo lúc ${m.createdAt}, backupHash ${m.backupHash}`);
  } else {
    const url = values['target-url'] || process.env.RESTORE_DATABASE_URL;
    if (!url) throw new Error('Thiếu --target-url hoặc RESTORE_DATABASE_URL (cố ý không dùng DATABASE_URL)');
    if (!values.yes) throw new Error(`Thêm --yes để xác nhận ghi vào ${describe(url)}`);
    if (values['upload-dir'] && values.supabase) throw new Error('Chọn một: --upload-dir hoặc --supabase');
    const storage = values.supabase
      ? { mode: 'supabase', url: config.storage.url, serviceKey: config.storage.serviceKey, bucket: config.storage.bucket }
      : { mode: 'local', dir: values['upload-dir'] || config.uploadDir };
    if (storage.mode === 'supabase' && !(storage.url && storage.serviceKey)) throw new Error('--supabase cần SUPABASE_URL và SUPABASE_SERVICE_KEY');
    const r = await restore({ from: values.from, url, storage, clean: values.clean, includeFiles: !values['no-files'], log: (m) => console.log(m) });
    console.log(`Đã khôi phục ${Object.keys(r.tables).length} bảng, ${r.restoredFiles} tệp vào ${describe(url)}`);
    if (!r.verified) {
      console.error(`Số dòng KHÔNG khớp ở: ${r.mismatched.join(', ')}`);
      process.exitCode = 1;
    } else console.log('Số dòng từng bảng khớp với bản sao lưu.');
  }
} catch (e) {
  console.error(`Khôi phục thất bại: ${e.message}`);
  process.exitCode = 1;
}
