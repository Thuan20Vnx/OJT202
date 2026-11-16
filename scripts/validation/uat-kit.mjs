import { hash } from './core.mjs';

export const UAT_SCENARIOS = [
  { id: 'S1', roles: ['pm', 'member'], steps: ['PM tạo task có mô tả, tiêu chí, người nhận, estimate và hạn.', 'Member tìm task trong My Tasks, lọc dự án rồi bắt đầu; tải lại trang.'], expected: ['Đúng người nhận, dữ liệu giữ sau reload.', 'Member không sửa người nhận hoặc estimate.'] },
  { id: 'S2', roles: ['member', 'pm'], steps: ['Member cập nhật remaining và gửi Review.', 'PM duyệt Done rồi mở lại với remaining mới.'], expected: ['Member không tự Done.', 'Done có completedAt; reopen xóa completedAt, giữ lịch sử và remaining mới.'] },
  { id: 'S3', roles: ['pm', 'member', 'viewer'], steps: ['Hai tài khoản mở task, bình luận @mention.', 'Member tải TXT, xem/sửa nội dung; Viewer mở bản được cấp quyền.'], expected: ['Thông báo/realtime đúng người và dự án.', 'Viewer đọc được, không tải lên/sửa; tài khoản ngoài nhóm không tải được file.'] },
  { id: 'S4', roles: ['pm', 'member'], steps: ['PM tạo kế hoạch AI, sửa/chọn mục, người nhận và hạn rồi duyệt.', 'Thử duyệt lại; tạo báo cáo theo kỳ và mở nguồn.'], expected: ['Chưa duyệt thì chưa tạo task; duyệt lặp không nhân task.', 'Số liệu theo DB, kỳ [start,end); nguồn mở đúng task, đề xuất AI có nhãn.'] },
  { id: 'S5', roles: ['member', 'viewer', 'outsider'], steps: ['Member hỏi mã xác nhận trong tài liệu, mở citation.', 'Hỏi thông tin không có nguồn; thử cùng endpoint bằng Viewer và ngoài nhóm.'], expected: ['Câu có nguồn trả đúng mã và citation mở được.', 'Thiếu nguồn thì từ chối; Viewer không gọi AI; ngoài nhóm không đọc project/nguồn.'] },
];

export const emptyUat = build => ({ schemaVersion: 1, build, participants: [], trials: [], comparisons: [], issues: [], retests: [] });

/** Only called after startFixture() has created a disposable, loopback database. */
export async function prepareUatKit(fixture, build) {
  const { prisma } = fixture.db;
  const ownerSeed = await prisma.user.findUniqueOrThrow({ where: { id: fixture.seed.users.maianh.id }, omit: { passwordHash: false } });
  const slots = [], clock = new Date();
  for (let index = 1; index <= 6; index++) {
    const slot = `P0${index}`, accounts = {};
    for (const role of ['owner', 'pm', 'member', 'viewer']) {
      accounts[role] = await prisma.user.create({ data: {
        name: `${slot} ${role.toUpperCase()}`, email: `${slot.toLowerCase()}.${role}@uat.example.test`,
        passwordHash: ownerSeed.passwordHash, emailVerified: true, timezone: 'Asia/Ho_Chi_Minh',
      } });
    }
    const workspace = await prisma.workspace.create({ data: {
      name: `UAT ${slot} — dữ liệu thử riêng`, slug: `uat-${slot.toLowerCase()}`, owner: accounts.owner.id,
      ai: { enabled: true, dailyLimit: 200, timeoutSec: 30, features: { planner: true, report: true, qa: true, risk: true, meeting: false } },
      memberships: { create: Object.entries(accounts).map(([role, user]) => ({ user: user.id, role: role === 'owner' ? 'owner' : role === 'viewer' ? 'viewer' : 'member', weeklyHours: 20 })) },
    } });
    const projects = [];
    for (const variant of ['A', 'B']) {
      const project = await prisma.project.create({ data: {
        workspace: workspace.id, name: `Bài ${variant} — đăng ký sự kiện`, keyPrefix: `U${variant}`,
        manager: accounts.pm.id, createdBy: accounts.owner.id, members: ['pm', 'member', 'viewer'].map(role => accounts[role].id),
        memberships: { create: ['pm', 'member', 'viewer'].map(role => ({ user: accounts[role].id, role })) },
      } });
      const tasks = [];
      for (let n = 1; n <= 10; n++) {
        const number = await fixture.db.nextSeq(`task:${project.id}`);
        tasks.push(await prisma.task.create({ data: {
          workspace: workspace.id, project: project.id, creator: accounts.pm.id, assignee: accounts.member.id,
          number, key: `U${variant}-${number}`, title: `${variant} ${['API đăng ký', 'Giao diện đăng ký', 'Tài liệu hướng dẫn', 'Kiểm thử đầu vào', 'Thông báo xác nhận'][n % 5]} ${n}`,
          description: 'Dữ liệu tổng hợp cho UAT; không phải công việc hoặc kết quả của người thử thật.',
          acceptanceCriteria: 'Dữ liệu giữ sau tải lại; quyền đúng theo vai trò; lỗi có thông báo.',
          estimateHours: 2, remainingHours: n === 3 ? 0 : 2, status: n === 3 ? 'done' : n === 4 ? 'review' : 'todo',
          completedAt: n === 3 ? clock : null, dueDate: n === 5 ? null : new Date(clock.getTime() + (n === 1 ? -2 : 3) * 86400000),
          blockedBy: n === 2 ? [tasks[0].id] : [],
        } }));
      }
      const document = await prisma.document.create({ data: {
        workspace: workspace.id, project: project.id, kind: 'doc', name: `Yêu cầu bài ${variant}.txt`, mime: 'text/plain', uploadedBy: accounts.pm.id,
        content: `Mã xác nhận đăng ký sự kiện của bài ${variant} là ${variant}-EV123. Phải xác minh email trước khi đăng ký.`,
      } });
      projects.push({ variant, id: project.id, name: project.name, taskIds: tasks.map(task => task.id), documentId: document.id });
    }
    slots.push({ slot, participant: null, relationship: null, plannedOrder: index <= 3 ? 'manual-first' : 'ai-first', workspace: workspace.id,
      accounts: Object.fromEntries(Object.entries(accounts).map(([role, user]) => [role, { id: user.id, email: user.email, workspaceRole: role === 'owner' ? 'owner' : role === 'viewer' ? 'viewer' : 'member', projectRole: role === 'owner' ? null : role }])), projects });
  }
  const dataset = { version: 'loc-sprint4-uat-v1', clock: clock.toISOString(), slots, taskCount: 120, workspaceCount: 6, projectCount: 12 };
  return { schemaVersion: 1, kind: 'uat-preparation', build, mode: 'isolated-local', status: 'prepared', humanAcceptance: 'pending',
    dataset: { ...dataset, hash: hash(dataset) }, scenarios: UAT_SCENARIOS,
    credentials: { mode: 'public-demo-only', passwordSource: 'BackEnd/src/seed.js DEMO_PASSWORD', validWhileSessionRuns: true },
    comparisonRubric: { version: 'loc-sprint4-task-quality-v1', criteria: ['Đủ công việc trong phạm vi', 'Đúng người phụ trách', 'Hạn có căn cứ', 'Tiêu chí nghiệm thu kiểm được', 'Không thêm dữ kiện ngoài đề'], score: 'Số tiêu chí đạt / 5; cùng rubric cho A và B', inputs: 'Cùng mục tiêu và giới hạn 24 giờ công, số người 2; đổi bài A/B theo plannedOrder.' },
    observation: { fields: ['participant', 'scenario', 'build', 'success', 'assisted', 'durationMs', 'errors', 'observer', 'actual', 'issueIds'], results: null },
    reset: 'Dừng phiên rồi chạy lại; database/uploads tạm mới. Không dùng reset với DB thật.' };
}

export function rehearsalTemplate(build) {
  return { schemaVersion: 1, kind: 'demo-rehearsal', build, status: 'pending', durationMinutes: null, collaborators: [],
    approvalVerified: null, citationsVerified: null, fallbackLabelled: null, qualityRunId: null, uatBuildHash: null,
    agenda: [{ minutes: '0–2', action: 'Mục tiêu, vai trò, build/provider và giới hạn' }, { minutes: '2–4', action: 'Hai người phối hợp task, Review/Done và comment' }, { minutes: '4–7', action: 'AI preview, sửa/chọn, duyệt, lặp không nhân task' }, { minutes: '7–9', action: 'Risk nguồn thật, report snapshot' }, { minutes: '9–11', action: 'Q&A có citation và ngoài nguồn; chỉ đọc số đo có bằng chứng' }, { minutes: '11–12', action: 'Quota/mất mạng, CRUD độc lập, bản ghi có nhãn' }],
    questions: ['Owner khác PM ở quyền nào?', 'Thu hồi phiên/quyền trong lúc chờ AI hoặc storage xử lý thế nào?', 'Nguồn RAG nào được đọc và khi nào phải từ chối?', 'Token chưa biết có phải chi phí bằng 0 không?', 'Số đo nào là local, số nào có người chấm độc lập?'], observations: [], issues: [],
    limitation: 'Đây là mẫu chuẩn bị. Chỉ người diễn tập/quan sát thật ghi thời lượng, cộng tác viên và kết quả.' };
}
