// Sao lưu database + tệp tài liệu (chỉ đọc nguồn).
// Chạy trong BackEnd:  npm run db:backup [-- --out <thư mục mới>] [--no-files]
// Nguồn: DATABASE_URL trong .env; để trống thì dùng PostgreSQL nhúng của server dev (phải đang chạy).
// Tệp: Supabase Storage nếu có SUPABASE_URL + SUPABASE_SERVICE_KEY, nếu không thì UPLOAD_DIR.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { config } from '../src/config.js';
import { backup, describe, embeddedUrl } from './lib/backup-core.js';

const { values } = parseArgs({ options: { out: { type: 'string' }, 'no-files': { type: 'boolean', default: false } } });
const url = config.databaseUrl || embeddedUrl();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.resolve(values.out ?? path.join(config.dataDir, 'backups', stamp));

try {
  const manifest = await backup({ url, out, includeFiles: !values['no-files'], log: (m) => console.log(m) });
  const rows = Object.values(manifest.tables).reduce((a, b) => a + b, 0);
  console.log(`Xong: ${describe(url)} → ${out}`);
  console.log(`  ${Object.keys(manifest.tables).length} bảng, ${rows} dòng, ${manifest.migrations.length} migration, ${Object.keys(manifest.files).length - 1} tệp`);
  if (manifest.missingFiles.length) console.log(`  Cảnh báo: ${manifest.missingFiles.length} tệp được tham chiếu nhưng không còn trong kho lưu`);
  console.log(`  backupHash ${manifest.backupHash}`);
} catch (e) {
  console.error(`Sao lưu thất bại: ${e.message}`);
  process.exitCode = 1;
}
