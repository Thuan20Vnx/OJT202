import { populate, populateAll, prisma, subtaskCounts } from '../db.js';

const DAY = 86400000;
export const startOfDay = (d = new Date()) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
export function weekRange(d = new Date()) {
  const s = startOfDay(d);
  const dow = (s.getDay() + 6) % 7; // Thứ 2 = 0
  const start = new Date(s.getTime() - dow * DAY);
  return { start, end: new Date(start.getTime() + 7 * DAY) };
}

const remaining = (t) => Math.max(0, (t.estimateHours || 0) - (t.spentHours || 0));

const loadProject = (projectId, project) => project ?? prisma.project.findUnique({ where: { id: projectId } });

/** Số liệu tổng quan tính trực tiếp từ DB. Truyền sẵn `project` (đã tải khi kiểm quyền) để bớt một truy vấn. */
export async function projectOverview(projectId, { from, to, project: given } = {}) {
  const now = new Date();
  const sod = startOfDay(now);
  const [project, top] = await Promise.all([
    loadProject(projectId, given),
    prisma.task.findMany({ where: { project: projectId, parent: null }, orderBy: { number: 'asc' } }).then((r) => populate(r, 'blockedBy', 'task', { status: true, dueDate: true, key: true, title: true })),
  ]);
  const total = top.length;
  const done = top.filter((t) => t.status === 'done');
  const overdue = top.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate < sod);
  const blocked = top.filter((t) => t.status !== 'done' && (t.blockedBy || []).some((b) => b && b.status !== 'done'));
  const byStatus = { todo: 0, in_progress: 0, review: 0, done: 0 };
  for (const t of top) byStatus[t.status] += 1;

  const last7 = done.filter((t) => t.completedAt && t.completedAt >= new Date(sod.getTime() - 6 * DAY)).length;
  const prev7 = done.filter((t) => t.completedAt && t.completedAt < new Date(sod.getTime() - 6 * DAY) && t.completedAt >= new Date(sod.getTime() - 13 * DAY)).length;

  // Sprint & burndown
  // Sprint lưu JSONB nên ngày ở dạng chuỗi ISO
  const sprint = project.sprint?.start && project.sprint?.end ? { ...project.sprint, start: new Date(project.sprint.start), end: new Date(project.sprint.end) } : null;
  let burndown = null;
  if (sprint) {
    const sprintTasks = top.filter((t) => !t.sprint || t.sprint === sprint.name);
    const days = [];
    const n = Math.max(1, Math.round((startOfDay(sprint.end) - startOfDay(sprint.start)) / DAY));
    for (let i = 0; i <= n; i++) {
      const day = new Date(startOfDay(sprint.start).getTime() + i * DAY);
      const endOfDay = new Date(day.getTime() + DAY);
      const remainingCount = sprintTasks.filter((t) => !(t.status === 'done' && t.completedAt && t.completedAt < endOfDay)).length;
      days.push({
        date: day,
        ideal: Math.round((sprintTasks.length * (1 - i / n)) * 10) / 10,
        actual: day <= now ? remainingCount : null,
      });
    }
    burndown = { total: sprintTasks.length, days, daysLeft: Math.max(0, Math.ceil((startOfDay(sprint.end) - sod) / DAY)) };
  }

  let range = null;
  if (from && to) {
    range = {
      done: done.filter((t) => t.completedAt && t.completedAt >= from && t.completedAt <= to),
    };
  }

  return {
    project,
    total,
    done: done.length,
    progressPct: total ? Math.round((done.length / total) * 100) : 0,
    overdue,
    blocked,
    byStatus,
    velocity: { last7, prev7 },
    burndown,
    range,
    tasks: top,
  };
}

/** Tải công việc tuần này = giờ ước lượng chưa xong (đến hạn trong tuần hoặc đã quá hạn) / giờ khả dụng. */
export async function workload(projectId, given) {
  const project = await loadProject(projectId, given);
  const { end } = weekRange();
  const [tasks, memberships, users] = await Promise.all([
    prisma.task.findMany({ where: { project: projectId, status: { not: 'done' }, assignee: { not: null }, dueDate: { lt: end } } }),
    prisma.membership.findMany({ where: { workspace: project.workspace, user: { in: project.members } } }),
    prisma.user.findMany({ where: { id: { in: project.members } }, select: { id: true, name: true, email: true, title: true } }),
  ]);
  return users
    .map((u) => {
      const m = memberships.find((x) => x.user === u.id);
      const mine = tasks.filter((t) => t.assignee === u.id);
      const hours = Math.round(mine.reduce((s, t) => s + remaining(t), 0) * 10) / 10;
      const available = m?.weeklyHours ?? 20;
      return {
        user: u,
        role: m?.role,
        jobTitle: m?.title,
        hours,
        available,
        pct: available ? Math.round((hours / available) * 100) : 0,
        taskIds: mine.map((t) => t.id),
        tasks: mine.map((t) => ({ id: t.id, key: t.key, title: t.title })),
      };
    })
    .sort((a, b) => a.user.name.localeCompare(b.user.name, 'vi')); // sắp theo tên – không xếp hạng cá nhân
}

/**
 * Cảnh báo rủi ro theo QUY TẮC xác định (không dự đoán ML).
 * Mỗi cảnh báo có key ổn định để đánh dấu "đã xử lý".
 */
export async function riskAlerts(projectId, { project: given, load: givenLoad } = {}) {
  const project = await loadProject(projectId, given);
  const rules = project.riskRules || {};
  const now = new Date();
  const sod = startOfDay(now);
  // Việc chưa xong + tải tuần + danh sách đã xử lý: chạy song song
  const [tasks, load, resolved] = await Promise.all([
    prisma.task.findMany({ where: { project: projectId, status: { not: 'done' } }, orderBy: { number: 'asc' } }),
    rules.overload !== false ? (givenLoad ?? workload(projectId, project)) : null,
    prisma.riskResolution.findMany({ where: { project: projectId }, orderBy: { updatedAt: 'desc' } }).then((r) => populate(r, 'resolvedBy', 'user', { name: true })),
  ]);
  // Việc chưa xong đang bị chặn bởi từng việc – tính từ id thô trước khi nạp blockedBy
  const blockingOf = {};
  for (const t of tasks) for (const b of t.blockedBy) (blockingOf[b] ||= []).push(t);
  const [, subs] = await Promise.all([
    populateAll(tasks, [
      ['assignee', 'user', { name: true }],
      ['blockedBy', 'task', { key: true, title: true, status: true, dueDate: true }],
    ]),
    subtaskCounts(tasks.map((t) => t.id)),
  ]);
  const ref = (t) => ({ id: t.id, key: t.key, title: t.title });
  const alerts = [];

  if (rules.overdue !== false) {
    for (const t of tasks) {
      if (!t.dueDate) continue;
      const days = Math.floor((sod - startOfDay(t.dueDate)) / 86400000);
      if (days >= Math.max(1, rules.overdueDays ?? 1)) {
        const blocking = blockingOf[t.id] || [];
        alerts.push({
          key: `overdue:${t.id}:${startOfDay(t.dueDate).toISOString().slice(0, 10)}`,
          type: 'overdue',
          severity: blocking.length ? 'critical' : 'warning',
          rule: `Quá hạn ≥ ${Math.max(1, rules.overdueDays ?? 1)} ngày`,
          title: `${t.key} ${t.title} quá hạn ${days} ngày`,
          explanation: blocking.length
            ? `Công việc đã quá hạn ${days} ngày và đang chặn ${blocking.map((b) => b.key).join(', ')}. Nếu không xử lý, các việc phía sau sẽ tiếp tục bị trễ.`
            : `Công việc đã quá hạn ${days} ngày và chưa hoàn thành.`,
          tasks: [ref(t), ...blocking.map(ref)],
          owner: t.assignee,
        });
      }
    }
  }

  if (rules.blockedByOverdue !== false) {
    const groups = {};
    for (const t of tasks) {
      for (const b of t.blockedBy || []) {
        if (b && b.status !== 'done' && b.dueDate && b.dueDate < sod) (groups[b.id] ||= { blocker: b, tasks: [] }).tasks.push(t);
      }
    }
    for (const g of Object.values(groups)) {
      alerts.push({
        key: `chain:${g.blocker.id}:${g.tasks.map((t) => t.id).sort().join(',')}`,
        type: 'blocked',
        severity: 'critical',
        rule: 'Bị chặn bởi việc quá hạn',
        title: `${g.tasks.length} công việc đang bị chặn bởi một việc quá hạn`,
        explanation: `${g.tasks.map((t) => t.key).join(', ')} đang chờ ${g.blocker.key} (${g.blocker.title}) – việc này đã quá hạn.`,
        tasks: [...g.tasks.map(ref), ref(g.blocker)],
        owner: null,
      });
    }
  }

  if (rules.overload !== false) {
    const { start } = weekRange();
    for (const w of load) {
      if (w.pct > (rules.overloadPct ?? 100)) {
        alerts.push({
          key: `overload:${w.user.id}:${start.toISOString().slice(0, 10)}`,
          type: 'overload',
          severity: 'warning',
          rule: `Tải tuần > ${rules.overloadPct ?? 100}% giờ khả dụng`,
          title: `${w.user.name} đang ở mức ${w.pct}% tải tuần này (${w.hours}/${w.available} giờ)`,
          explanation: `Tổng giờ ước lượng chưa xong của các việc đến hạn trong tuần vượt giờ khả dụng. Cân nhắc giao lại hoặc dời hạn một số việc.`,
          tasks: w.tasks,
          owner: w.user,
        });
      }
    }
  }

  if (rules.dueSoon !== false) {
    for (const t of tasks) {
      if (!t.dueDate) continue;
      const hours = (t.dueDate - now) / 3600000;
      const s = subs[t.id];
      const pct = s?.total ? Math.round((s.done / s.total) * 100) : t.status === 'review' ? 90 : t.status === 'in_progress' ? 50 : 0;
      if (hours > 0 && hours <= 24 && pct < (rules.dueSoonProgressPct ?? 80)) {
        alerts.push({
          key: `duesoon:${t.id}:${t.dueDate.toISOString().slice(0, 10)}`,
          type: 'due_soon',
          severity: 'warning',
          rule: `Đến hạn trong 24 giờ và tiến độ < ${rules.dueSoonProgressPct ?? 80}%`,
          title: `${t.key} đến hạn trong 24 giờ${s?.total ? `, mới xong ${s.done}/${s.total} việc con` : ''}`,
          explanation: `Còn khoảng ${Math.round(hours)} giờ trước hạn, tiến độ ước tính ${pct}%.`,
          tasks: [ref(t)],
          owner: t.assignee,
        });
      }
    }
    for (const t of tasks) {
      if (t.status === 'review' && t.reviewSince) {
        const days = Math.floor((now - t.reviewSince) / 86400000);
        if (days >= (rules.reviewStaleDays ?? 3)) {
          alerts.push({
            key: `review:${t.id}:${t.reviewSince.toISOString().slice(0, 10)}`,
            type: 'review_stale',
            severity: 'warning',
            rule: `Chờ kiểm duyệt ≥ ${rules.reviewStaleDays ?? 3} ngày`,
            title: `${t.key} đang chờ kiểm duyệt ${days} ngày`,
            explanation: 'Công việc nằm ở cột Đang kiểm duyệt quá lâu, có thể đang thiếu người duyệt.',
            tasks: [ref(t)],
            owner: t.assignee,
          });
        }
      }
    }
  }

  const resolvedKeys = new Set(resolved.map((r) => r.key));
  const order = { critical: 0, warning: 1 };
  return {
    open: alerts.filter((a) => !resolvedKeys.has(a.key)).sort((a, b) => order[a.severity] - order[b.severity]),
    resolved: resolved.slice(0, 10),
    rules,
  };
}
