import { connectDb, disconnectDb } from './db.js';
import { seedDemo } from './seed.js';

await connectDb();
const done = await seedDemo();
if (!done) console.log('[seed] DB đã có dữ liệu – bỏ qua. Xóa dữ liệu (hoặc thư mục server/.data) để seed lại.');
await disconnectDb();
