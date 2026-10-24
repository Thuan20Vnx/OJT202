import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { prisma } from './db.js';
import { randomToken } from './utils/security.js';

// Tài khoản demo (chỉ dùng cho môi trường phát triển). Mật khẩu chung cho mọi tài khoản demo:
export const DEMO_PASSWORD = 'TaskFlow@2026';

const PEOPLE = [
  { key: 'maianh', name: 'Mai Anh', email: 'mai.anh@nhom24.edu.vn', role: 'owner', title: 'PM' },
  { key: 'hoanganh', name: 'Hoàng Anh', email: 'hoang.anh@nhom24.edu.vn', role: 'admin', title: 'Product Owner / Tech lead' },
  { key: 'thuan', name: 'Thuận', email: 'thuan@nhom24.edu.vn', role: 'admin', title: 'Scrum Master / Backend' },
  { key: 'nhu', name: 'Như', email: 'nhu@nhom24.edu.vn', role: 'member', title: 'Frontend / UI/UX' },
  { key: 'loc', name: 'Lộc', email: 'loc@nhom24.edu.vn', role: 'member', title: 'Backend / Database' },
  { key: 'dat', name: 'Đạt', email: 'dat@nhom24.edu.vn', role: 'member', title: 'AI / Full-stack' },
  { key: 'hiep', name: 'Hiệp', email: 'hiep@nhom24.edu.vn', role: 'member', title: 'QA / DevOps' },
  { key: 'linh', name: 'Khánh Linh', email: 'khanh.linh@nhom24.edu.vn', role: 'viewer', title: 'Giảng viên hướng dẫn' },
];

const DAY = 86400000;

function at(offsetDays, hour = 17) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return new Date(d.getTime() + offsetDays * DAY);
}

// PDF/PNG tối giản hợp lệ để minh họa tệp đính kèm
const MINI_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj 4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 20 70 Td (TaskFlow SRS v1.2) Tj ET\nendstream endobj 5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);
const MINI_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

export async function seedDemo() {
  if (config.isProd) throw new Error('Không được tạo tài khoản demo trong production');
  if (await prisma.user.findFirst({ select: { id: true } })) return false;
  console.log('[seed] Tạo dữ liệu demo Nhóm 24…');
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const u = {};
  for (const p of PEOPLE) {
    u[p.key] = await prisma.user.create({ data: { name: p.name, email: p.email, passwordHash: hash, emailVerified: true, title: p.title, lastLoginAt: at(-1) } });
  }
  const admin = await prisma.user.create({ data: { name: 'System Admin', email: 'admin@taskflow.local', passwordHash: hash, emailVerified: true, isSystemAdmin: true } });
  const spammer = await prisma.user.create({
    data: {
      name: 'Người dùng thử',
      email: 'spam.test@example.com',
      passwordHash: hash,
      emailVerified: true,
      isLocked: true,
      lockReason: 'Spam lời mời',
      lockedAt: at(-2),
      lockedBy: admin.id,
    },
  });

  const ws = await prisma.workspace.create({ data: { name: 'Nhóm 24 - Product Hub', slug: 'nhom-24', owner: u.maianh.id, size: '6-10' } });
  for (const p of PEOPLE) await prisma.membership.create({ data: { workspace: ws.id, user: u[p.key].id, role: p.role, title: p.title, weeklyHours: 20 } });

  const all = PEOPLE.filter((p) => p.key !== 'linh').map((p) => u[p.key].id);
  const project = (data) => prisma.project.create({ data: { workspace: ws.id, createdBy: u.maianh.id, ...data } });
  const website = await project({
    name: 'Dự án Website',
    description: 'Nền tảng web TaskFlow: Kanban, cộng tác thời gian thực và Trợ lý AI.',
    color: 'blue',
    keyPrefix: 'TF',
    startDate: at(-40, 0),
    endDate: at(45, 0),
    members: [...all, u.linh.id],
    manager: u.maianh.id,
    sprint: { name: 'Sprint 14', goal: 'Đạt chuẩn Core Web Vitals & hoàn tất luồng xác thực 2 lớp', start: at(-6, 0).toISOString(), end: at(4, 0).toISOString() },
  });
  const mobile = await project({
    name: 'Mobile App',
    description: 'Ứng dụng di động cho thành viên xem và cập nhật công việc.',
    color: 'purple',
    keyPrefix: 'MB',
    startDate: at(-20, 0),
    endDate: at(60, 0),
    members: [u.maianh.id, u.nhu.id, u.dat.id, u.hiep.id],
    manager: u.nhu.id,
  });
  const backend = await project({
    name: 'Hệ thống Backend',
    description: 'API, cơ sở dữ liệu, phân quyền và hạ tầng triển khai.',
    color: 'slate',
    keyPrefix: 'BE',
    startDate: at(-30, 0),
    endDate: at(30, 0),
    members: [u.maianh.id, u.thuan.id, u.loc.id, u.hiep.id],
    manager: u.thuan.id,
  });
  const hackathon = await project({
    name: 'Hackathon FPT 2026',
    description: 'Dự án thi Hackathon – đã kết thúc.',
    color: 'amber',
    keyPrefix: 'HK',
    startDate: at(-120, 0),
    endDate: at(-90, 0),
    status: 'archived',
    members: all,
    manager: u.hoanganh.id,
    createdBy: u.hoanganh.id,
  });

  const T = {};
  const mk = async (project, number, data) => {
    const t = await prisma.task.create({
      data: {
        workspace: ws.id,
        project: project.id,
        number,
        key: `${project.keyPrefix}-${number}`,
        creator: u.maianh.id,
        sprint: project.sprint?.name || '',
        order: number,
        ...data,
        completedAt: data.status === 'done' ? data.completedAt || at(-1) : null,
      },
    });
    T[t.key] = t;
    return t;
  };

  await mk(website, 98, {
    title: 'Cấu hình Load Balancer WSS trên cụm Cloud',
    status: 'in_progress',
    priority: 'high',
    assignee: u.hiep.id,
    dueDate: at(-2),
    estimateHours: 8,
    spentHours: 3,
    labels: ['DevOps'],
    description: 'Cấu hình load balancer hỗ trợ WebSocket bảo mật (WSS) cho cụm staging và production.',
  });
  await mk(website, 99, {
    title: 'Thiết lập CI/CD pipeline cho frontend',
    status: 'done',
    priority: 'medium',
    assignee: u.hiep.id,
    completedAt: at(-6),
    estimateHours: 6,
    spentHours: 6,
    labels: ['DevOps'],
  });
  await mk(website, 100, {
    title: 'Chuẩn hóa Design Tokens màu và bo góc',
    status: 'done',
    priority: 'low',
    assignee: u.nhu.id,
    completedAt: at(-5),
    estimateHours: 4,
    spentHours: 4,
    labels: ['UI/UX'],
  });
  await mk(website, 101, {
    title: 'Thiết kế giao diện luồng Đăng nhập & Xác thực OTP 2 lớp',
    status: 'todo',
    priority: 'high',
    assignee: u.nhu.id,
    dueDate: at(3),
    estimateHours: 10,
    labels: ['UI/UX'],
    checklist: [
      { text: 'Wireframe đăng nhập', done: true },
      { text: 'Màn hình nhập OTP', done: false },
      { text: 'Trạng thái lỗi', done: false },
      { text: 'Bàn giao Figma', done: false },
    ],
  });
  await mk(website, 102, {
    title: 'Nghiên cứu tích hợp cổng thanh toán VNPay và Momo',
    status: 'todo',
    priority: 'medium',
    assignee: u.loc.id,
    dueDate: at(5),
    estimateHours: 16,
    labels: ['Fintech & API'],
  });
  const t103 = await mk(website, 103, {
    title: 'Xây dựng API đồng bộ dữ liệu Real-time qua WebSocket',
    status: 'in_progress',
    priority: 'high',
    assignee: u.thuan.id,
    dueDate: at(0, 23),
    estimateHours: 12,
    spentHours: 7,
    labels: ['Backend', 'Real-time', 'WebSocket'],
    description:
      'Thiết kế kiến trúc Socket gateway và triển khai kết nối hai chiều WebSocket (WSS) kết hợp Redis Pub/Sub nhằm cập nhật trạng thái thẻ Kanban theo thời gian thực giữa các thành viên dự án mà không cần tải lại trang.',
    acceptanceCriteria: [
      'Độ trễ cập nhật thẻ < 80ms trong cùng vùng mạng',
      'Khôi phục trạng thái và đồng bộ lại sau khi mất kết nối dưới 30s',
      'Mã hóa dữ liệu truyền tải qua WSS (TLS 1.3)',
    ],
    blockedBy: [T['TF-98'].id],
  });
  await mk(website, 104, {
    title: 'Tối ưu tốc độ tải trang Dashboard dưới 1.2s',
    status: 'in_progress',
    priority: 'high',
    assignee: u.dat.id,
    dueDate: at(1, 10),
    estimateHours: 10,
    spentHours: 5,
    labels: ['Hiệu năng Web'],
  });
  await mk(website, 105, {
    title: 'Viết tài liệu Hướng dẫn sử dụng cho Quản trị viên',
    status: 'todo',
    priority: 'low',
    assignee: u.nhu.id,
    dueDate: at(8),
    estimateHours: 6,
    labels: ['Tài liệu'],
  });
  await mk(website, 106, {
    title: 'Kiểm thử giao diện Responsive trên màn hình Tablet & Mobile',
    status: 'review',
    priority: 'medium',
    assignee: u.hiep.id,
    dueDate: at(2),
    reviewSince: at(-3),
    estimateHours: 6,
    spentHours: 6,
    labels: ['QA & Kiểm thử'],
  });
  await mk(website, 107, {
    title: 'Thẩm định thiết kế luồng Onboarding người dùng mới',
    status: 'review',
    priority: 'high',
    assignee: u.maianh.id,
    dueDate: at(1),
    reviewSince: at(-1),
    estimateHours: 3,
    labels: ['Đánh giá PM'],
  });
  await mk(website, 108, {
    title: 'Cập nhật thư viện biểu tượng SVG và bảng mã màu Design Tokens',
    status: 'done',
    priority: 'low',
    assignee: u.nhu.id,
    completedAt: at(-3),
    estimateHours: 4,
    spentHours: 4,
    labels: ['UI/UX'],
  });
  await mk(website, 109, {
    title: 'Phê duyệt kế hoạch phát hành phiên bản Beta v1.2',
    status: 'done',
    priority: 'medium',
    assignee: u.maianh.id,
    completedAt: at(-1),
    estimateHours: 2,
    spentHours: 2,
  });
  await mk(website, 110, {
    title: 'Tích hợp client SDK và hoàn thiện cơ chế reconnect tự động',
    status: 'todo',
    priority: 'medium',
    assignee: u.thuan.id,
    dueDate: at(3),
    estimateHours: 6,
    labels: ['Frontend', 'Real-time'],
    blockedBy: [t103.id],
  });
  await mk(website, 111, {
    title: 'Viết test phân quyền cross-tenant',
    status: 'todo',
    priority: 'high',
    assignee: u.thuan.id,
    dueDate: at(2),
    estimateHours: 8,
    labels: ['Bảo mật'],
  });
  await mk(website, 112, {
    title: 'Thiết kế màn hình Thông báo',
    status: 'in_progress',
    priority: 'medium',
    assignee: u.nhu.id,
    dueDate: at(2),
    estimateHours: 8,
    spentHours: 3,
    labels: ['UI/UX'],
  });
  await mk(website, 113, {
    title: 'Xây dựng Dashboard tải công việc',
    status: 'done',
    priority: 'medium',
    assignee: u.dat.id,
    completedAt: at(-4),
    estimateHours: 8,
    spentHours: 9,
  });
  await mk(website, 114, {
    title: 'Sửa lỗi kéo thả Kanban trên Safari',
    status: 'done',
    priority: 'high',
    assignee: u.loc.id,
    completedAt: at(-2),
    estimateHours: 3,
    spentHours: 2,
  });
  await mk(website, 115, {
    title: 'Chuẩn hóa API phân trang và bộ lọc',
    status: 'todo',
    priority: 'medium',
    assignee: u.thuan.id,
    dueDate: at(4),
    estimateHours: 6,
    labels: ['Backend'],
  });

  // Công việc con
  const subs103 = [
    ['Thiết kế lược đồ bản tin Socket JSON payload', 'done'],
    ['Triển khai WebSocket Server trên Node.js & Redis Pub/Sub', 'done'],
    ['Xử lý xác thực token qua handshake kết nối ban đầu', 'done'],
    ['Kiểm thử kết nối tải giả lập 2.000 clients đồng thời', 'done'],
    ['Cấu hình SSL/WSS qua reverse proxy Load Balancer', 'todo'],
    ['Tích hợp client SDK và hoàn thiện cơ chế reconnect', 'todo'],
  ];
  let n = 116;
  for (const [title, status] of subs103)
    await mk(website, n++, { title, status, parent: t103.id, assignee: u.thuan.id, priority: 'medium', completedAt: status === 'done' ? at(-2) : null });
  const subs104 = [
    ['Đo baseline Lighthouse', 'done'],
    ['Tách bundle theo route', 'done'],
    ['Lazy-load biểu đồ', 'done'],
    ['Cache API tổng quan', 'todo'],
    ['Đo lại và báo cáo', 'todo'],
  ];
  for (const [title, status] of subs104)
    await mk(website, n++, { title, status, parent: T['TF-104'].id, assignee: u.dat.id, priority: 'medium', completedAt: status === 'done' ? at(-1) : null });

  const mobileTasks = [
    ['Thiết kế màn hình danh sách công việc', 'in_progress', u.nhu, 3],
    ['Đăng nhập bằng email trên mobile', 'todo', u.dat, 6],
    ['Thông báo đẩy khi được giao việc', 'todo', u.hiep, 9],
    ['Thiết kế icon ứng dụng', 'done', u.nhu, -3],
    ['Kiểm thử trên Android 14', 'review', u.hiep, 2],
  ];
  let m = 1;
  for (const [title, status, who, due] of mobileTasks) await mk(mobile, m++, { title, status, assignee: who.id, dueDate: at(due), priority: 'medium', estimateHours: 5 });
  const beTasks = [
    ['Migration schema PostgreSQL v2', 'in_progress', u.loc, 2],
    ['Backup & restore tự động hằng ngày', 'todo', u.hiep, 5],
    ['Rate limit cho API AI', 'done', u.thuan, -2],
    ['Index tìm kiếm công việc', 'todo', u.loc, 6],
  ];
  let b = 1;
  for (const [title, status, who, due] of beTasks) await mk(backend, b++, { title, status, assignee: who.id, dueDate: at(due), priority: 'medium', estimateHours: 6 });
  await mk(hackathon, 1, { title: 'Pitch deck vòng chung kết', status: 'done', assignee: u.hoanganh.id, completedAt: at(-95) });
  await mk(hackathon, 2, { title: 'Demo prototype', status: 'done', assignee: u.dat.id, completedAt: at(-94) });

  await prisma.counter.createMany({
    data: [
      [website, n - 1],
      [mobile, m - 1],
      [backend, b - 1],
      [hackathon, 2],
    ].map(([p, max]) => ({ name: `task:${p.id}`, seq: max })),
  });

  // Bình luận
  await prisma.comment.createMany({
    data: [
      {
        task: t103.id,
        project: website.id,
        author: u.hiep.id,
        body: '@Thuận load balancer bên DevOps đang cấu hình WSS, dự kiến xong trong ngày mai.',
        mentions: [u.thuan.id],
        createdAt: at(-1, 9),
      },
      {
        task: t103.id,
        project: website.id,
        author: u.thuan.id,
        body: 'Mình đã xong phần handshake và xác thực token, đang chờ WSS để test end-to-end. @Mai Anh nhờ chị theo dõi giúp TF-98.',
        mentions: [u.maianh.id],
        createdAt: at(-1, 10),
      },
      { task: T['TF-107'].id, project: website.id, author: u.nhu.id, body: 'Em đã cập nhật lại bước chọn quy mô nhóm theo góp ý hôm qua.', createdAt: at(-1, 15) },
    ],
  });

  // Tài liệu
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const archParas = [
    'TaskFlow dùng Socket.io làm gateway real-time. Mỗi dự án là một phòng riêng; client chỉ được vào phòng sau khi server kiểm tra quyền thành viên.',
    'Khi mất kết nối, client tự kết nối lại và tải lại dữ liệu từ API để đồng bộ với cơ sở dữ liệu, nên không mất công việc khi socket lỗi.',
    'Kết nối WSS đi qua load balancer của DevOps (TF-98). Khi load balancer chưa cấu hình xong, TF-103 chưa thể kiểm thử end-to-end trên staging.',
    'Quyết định kiến trúc: cập nhật Kanban dùng version để chống ghi đè; bản cũ trả về 409 và giao diện tải lại.',
  ];
  const archContent = archParas.join('\n\n');
  const archDoc = await prisma.document.create({
    data: {
      workspace: ws.id,
      project: website.id,
      task: t103.id,
      kind: 'doc',
      name: 'Kiến trúc Real-time.txt',
      mime: 'text/plain',
      content: archContent,
      size: Buffer.byteLength(archContent),
      version: 4,
      uploadedBy: u.thuan.id,
      revisions: {
        create: [
          { version: 1, content: archParas[0], author: u.dat.id, createdAt: at(-9) },
          { version: 2, content: archParas.slice(0, 2).join('\n\n'), author: u.dat.id, createdAt: at(-5) },
          { version: 3, content: archParas.slice(0, 3).join('\n\n'), author: u.dat.id, createdAt: at(-1) },
          { version: 4, content: archContent, author: u.thuan.id, createdAt: at(0, 8) },
        ],
      },
    },
  });
  const minutes =
    'Họp Sprint 14 – thống nhất ưu tiên gỡ chặn TF-98 trước, sau đó kiểm thử end-to-end real-time.\n\nThuận phụ trách API WebSocket, Như cập nhật wireframe Thông báo, Hiệp hỗ trợ cấu hình WSS.';
  await prisma.document.create({
    data: {
      workspace: ws.id,
      project: website.id,
      kind: 'doc',
      name: 'Biên bản họp Sprint 14.txt',
      mime: 'text/plain',
      content: minutes,
      size: Buffer.byteLength(minutes),
      version: 2,
      uploadedBy: u.maianh.id,
      revisions: {
        create: [
          { version: 1, content: minutes.split('\n\n')[0], author: u.maianh.id },
          { version: 2, content: minutes, author: u.maianh.id },
        ],
      },
    },
  });
  for (const [name, buf, mime, isScan, who, task] of [
    ['SRS TaskFlow v1.2.pdf', MINI_PDF, 'application/pdf', false, u.hoanganh, null],
    ['Wireframe Thông báo.png', MINI_PNG, 'image/png', true, u.nhu, T['TF-112'].id],
  ]) {
    const key = `${randomToken(16)}${path.extname(name)}`;
    fs.writeFileSync(path.join(config.uploadDir, key), buf);
    await prisma.document.create({
      data: { workspace: ws.id, project: website.id, task, kind: 'file', name, mime, size: buf.length, storageKey: key, isScan, uploadedBy: who.id },
    });
  }

  // Nhật ký hoạt động
  const act = (actor, action, task, before, after, ago) =>
    prisma.activity.create({
      data: {
        workspace: ws.id,
        project: website.id,
        actor: actor.id,
        action,
        entityType: 'task',
        entityId: task.id,
        entityLabel: `${task.key} ${task.title}`,
        before,
        after,
        createdAt: new Date(Date.now() - ago * 3600000),
      },
    });
  await act(u.loc, 'Đổi trạng thái', T['TF-114'], 'Đang kiểm duyệt', 'Hoàn thành', 50);
  await act(u.hiep, 'Đổi trạng thái', T['TF-106'], 'Đang thực hiện', 'Đang kiểm duyệt', 72);
  await act(u.maianh, 'Giao việc', T['TF-112'], 'Chưa giao', 'Như', 30);
  await act(u.thuan, 'Cập nhật hạn chót', t103, at(-1).toLocaleDateString('vi-VN'), at(0).toLocaleDateString('vi-VN'), 20);
  await act(u.dat, 'Đổi ưu tiên', T['TF-104'], 'Trung bình', 'Cao', 26);
  await act(u.maianh, 'Đổi trạng thái', T['TF-109'], 'Đang kiểm duyệt', 'Hoàn thành', 22);
  await prisma.activity.create({
    data: {
      workspace: ws.id,
      actor: u.hoanganh.id,
      action: 'Phân quyền',
      entityType: 'member',
      entityId: u.linh.id,
      entityLabel: 'Khánh Linh',
      before: 'Member',
      after: 'Viewer',
      createdAt: at(-2, 17),
    },
  });
  await prisma.activity.create({
    data: {
      workspace: ws.id,
      project: website.id,
      actor: u.thuan.id,
      action: 'Cập nhật tài liệu',
      entityType: 'file',
      entityId: archDoc.id,
      entityLabel: archDoc.name,
      after: 'v4',
      createdAt: at(0, 8),
    },
  });

  // Thông báo cho Mai Anh
  const notif = (data, ago) =>
    prisma.notification.create({ data: { user: u.maianh.id, workspace: ws.id, project: website.id, createdAt: new Date(Date.now() - ago * 60000), ...data } });
  await notif(
    {
      type: 'mentioned',
      actor: u.thuan.id,
      task: t103.id,
      text: 'Thuận đã nhắc đến bạn trong TF-103',
      excerpt: 'Mình đã xong phần handshake… @Mai Anh nhờ chị theo dõi giúp TF-98.',
      dedupeKey: 'seed:1',
    },
    20,
  );
  await notif({ type: 'status', actor: u.hiep.id, task: T['TF-106'].id, text: 'Hiệp đã chuyển TF-106 sang Đang kiểm duyệt', dedupeKey: 'seed:2' }, 120);
  await notif({ type: 'due_soon', task: T['TF-107'].id, text: 'Nhắc hạn: TF-107 Thẩm định thiết kế luồng Onboarding đến hạn trong 24 giờ', dedupeKey: 'seed:3' }, 60);
  await notif(
    {
      type: 'comment',
      actor: u.nhu.id,
      task: T['TF-107'].id,
      text: 'Như đã bình luận trong TF-107',
      excerpt: 'Em đã cập nhật lại bước chọn quy mô nhóm…',
      dedupeKey: 'seed:4',
      readAt: at(-1),
    },
    60 * 26,
  );
  await notif({ type: 'overdue', task: T['TF-98'].id, text: 'TF-98 Cấu hình Load Balancer WSS đã quá hạn 2 ngày', dedupeKey: 'seed:5', readAt: at(-1) }, 60 * 28);
  await notif({ type: 'invite', actor: u.dat.id, project: mobile.id, text: 'Đạt đã thêm bạn vào dự án Mobile App', dedupeKey: 'seed:6', readAt: at(-3) }, 60 * 24 * 3);

  // Lịch sử gọi AI
  const calls = [
    ['planner', u.maianh, 'success', 1840, 2300],
    ['qa', u.thuan, 'success', 960, 1700],
    ['report', u.maianh, 'retried_success', 1500, 31000],
    ['qa', u.nhu, 'success', 820, 1500],
    ['risk', u.dat, 'error', 0, 30000],
  ];
  await prisma.aiCall.createMany({
    data: calls.map(([feature, who, status, tokens, latency], i) => ({
      workspace: ws.id,
      user: who.id,
      feature,
      model: 'taskflow-local-rules',
      inputTokens: Math.round(tokens * 0.7),
      outputTokens: Math.round(tokens * 0.3),
      latencyMs: latency,
      status,
      error: status === 'error' ? 'timeout sau 1 lần thử lại' : null,
      createdAt: new Date(Date.now() - (i + 1) * 47 * 60000),
    })),
  });

  console.log(`[seed] Xong. Đăng nhập: ${PEOPLE[0].email} / ${DEMO_PASSWORD}  (System Admin: admin@taskflow.local)`);
  return { users: u, workspace: ws, projects: { website, mobile, backend, hackathon }, spammer };
}
