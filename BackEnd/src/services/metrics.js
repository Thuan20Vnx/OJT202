import { createHash } from 'node:crypto';
import { populate, populateAll, prisma, subtaskCounts } from '../db.js';
import { startOfDay, weekRange } from '../utils/dates.js';
import { capacityWeek, currentCapacityWeek } from './capacity.js';
export { startOfDay, weekRange } from '../utils/dates.js';

const DAY = 86400000;
const RISK_ENGINE_VERSION = 'taskflow-risk-v2';

const remaining = (t) => t.remainingHours ?? Math.max(0, (t.estimateHours || 0) - (t.spentHours || 0));

const loadProject = (projectId, project) => project ?? prisma.project.findUnique({ where: { id: projectId } });

/** Số liệu tổng quan tính trực tiếp từ DB. Truyền sẵn `project` (đã tải khi kiểm quyền) để bớt một truy vấn. */
export async function projectOverview(projectId, { from, to, project: given, now = new Date() } = {}) {
  const sod = startOfDay(now);
  const [project, top] = await Promise.all([
    loadProject(projectId, given),
    prisma.task
      .findMany({ where: { deletedAt: null, project: projectId, parent: null }, orderBy: { number: 'asc' } })
      .then((r) => populate(r, 'blockedBy', 'task', { status: true, dueDate: true, key: true, title: true })),
  ]);
  const total = top.length;
  const done = top.filter((t) => t.status === 'done');
  const overdue = top.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate < now);
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
    const n = Math.max(0, Math.round((startOfDay(sprint.end) - startOfDay(sprint.start)) / DAY));
    // Bound work for legacy/imported date ranges too; long sprints are sampled,
    // retaining both endpoints instead of blocking the server with millions of days.
    const stride = Math.max(1, Math.ceil(n / 366));
    const indices = Array.from({ length: Math.floor(n / stride) + 1 }, (_, i) => i * stride);
    if (indices.at(-1) !== n) indices.push(n);
    for (const i of indices) {
      const day = new Date(startOfDay(sprint.start).getTime() + i * DAY);
      const endOfDay = new Date(day.getTime() + DAY);
      const remainingCount = sprintTasks.filter((t) => !(t.status === 'done' && t.completedAt && t.completedAt < endOfDay)).length;
      days.push({
        date: day,
        ideal: n ? Math.round(sprintTasks.length * (1 - i / n) * 10) / 10 : 0,
        actual: day <= now ? remainingCount : null,
      });
    }
    burndown = { total: sprintTasks.length, days, sampled: stride > 1, daysLeft: Math.max(0, Math.ceil((startOfDay(sprint.end) - sod) / DAY)) };
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
export async function workload(projectId, given, now = new Date(), db = prisma) {
  const project = await loadProject(projectId, given);
  const { end } = weekRange(now);
  const week = currentCapacityWeek(now);
  const [tasks, memberships, users, capacities, projectMembers] = await Promise.all([
    db.task.findMany({ where: { deletedAt: null, project: projectId, status: { not: 'done' }, assignee: { not: null }, subtasks: { none: { deletedAt: null } } } }),
    db.membership.findMany({ where: { workspace: project.workspace, user: { in: project.members } } }),
    db.user.findMany({ where: { id: { in: project.members } }, select: { id: true, name: true, email: true, title: true } }),
    db.weeklyCapacity.findMany({ where: { workspace: project.workspace, user: { in: project.members }, weekStart: capacityWeek(week) } }),
    db.projectMember.findMany({ where: { project: projectId } }),
  ]);
  return users
    .map((u) => {
      const m = memberships.find((x) => x.user === u.id);
      const all = tasks.filter((t) => t.assignee === u.id);
      const mine = all.filter((t) => t.dueDate && t.dueDate < end);
      const hours = mine.reduce((s, t) => s + remaining(t), 0);
      const capacity = capacities.find((c) => c.user === u.id);
      const available = capacity?.hours ?? m?.weeklyHours ?? 20;
      return {
        user: u,
        role: m?.role,
        projectRole: projectMembers.find((p) => p.user === u.id)?.role,
        jobTitle: m?.title,
        hours,
        available,
        weekStart: week,
        capacityVersion: capacity?.version ?? 0,
        capacitySource: capacity ? 'week' : 'default',
        // Không có mẫu số thì tỷ lệ không xác định, tuyệt đối không ghi 0% khi còn việc.
        pct: available > 0 ? Math.round((hours / available) * 100) : hours > 0 ? null : 0,
        overloaded: hours > available,
        missingEstimates: mine.filter((t) => t.remainingHours == null && t.estimateHours == null).length,
        missingDeadlines: all.filter((t) => !t.dueDate).length,
        taskIds: mine.map((t) => t.id),
        tasks: mine.map((t) => ({ id: t.id, key: t.key, title: t.title })),
      };
    })
    .sort((a, b) => a.user.name.localeCompare(b.user.name, 'vi')); // sắp theo tên – không xếp hạng cá nhân
}

/**
 * Cảnh báo rủi ro theo QUY TẮC xác định (không dự đoán ML).
 * Key nhận diện quy tắc; sourceVersion nhận diện đúng đầu vào đã được xem xét.
 * Thời điểm đọc không nằm trong hash: cùng nguồn không tạo phiên bản giả mỗi lần refresh.
 */
export async function riskAlerts(projectId, { project: given, load: givenLoad, now = new Date(), db = prisma } = {}) {
  const project = await loadProject(projectId, given);
  const rules = project.riskRules || {};
  // Việc chưa xong + tải tuần + danh sách đã xử lý: chạy song song
  const [tasks, load, resolved] = await Promise.all([
    db.task.findMany({ where: { deletedAt: null, project: projectId, status: { not: 'done' } }, orderBy: { number: 'asc' } }),
    rules.overload !== false ? (givenLoad ?? workload(projectId, project, now, db)) : null,
    db.riskResolution.findMany({ where: { project: projectId }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] }).then((r) => populate(r, 'resolvedBy', 'user', { name: true }, db)),
  ]);
  // Việc chưa xong đang bị chặn bởi từng việc – tính từ id thô trước khi nạp blockedBy
  const blockingOf = {};
  for (const t of tasks) for (const b of t.blockedBy) (blockingOf[b] ||= []).push(t);
  const [, subs] = await Promise.all([
    populateAll(tasks, [
      ['assignee', 'user', { name: true }],
      ['blockedBy', 'task', { key: true, title: true, status: true, dueDate: true, project: true, version: true }],
    ], db),
    subtaskCounts(tasks.map((t) => t.id), db),
  ]);
  for (const t of tasks) t.blockedBy = t.blockedBy.filter((b) => b.project === projectId);
  const ref = (t) => ({ id: t.id, key: t.key, title: t.title });
  const alerts = [];

  if (rules.overdue !== false) {
    for (const t of tasks) {
      if (!t.dueDate) continue;
      const elapsed = now - t.dueDate;
      const days = Math.floor(elapsed / DAY);
      const threshold = Math.max(0, rules.overdueDays ?? 1);
      if (elapsed > 0 && elapsed >= threshold * DAY) {
        const blocking = blockingOf[t.id] || [];
        const duration = days > 0 ? `${days} ngày` : 'dưới 1 ngày';
        alerts.push({
          key: `overdue:${t.id}:${t.dueDate.toISOString()}`,
          type: 'overdue',
          severity: blocking.length ? 'critical' : 'warning',
          rule: threshold === 0 ? 'Đã quá hạn' : `Quá hạn ≥ ${threshold} ngày`,
          title: `${t.key} ${t.title} quá hạn ${duration}`,
          explanation: blocking.length
            ? `Công việc đã quá hạn ${duration} và đang chặn ${blocking.map((b) => b.key).join(', ')}. Nếu không xử lý, các việc phía sau sẽ tiếp tục bị trễ.`
            : `Công việc đã quá hạn ${duration} và chưa hoàn thành.`,
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
        if (b && b.status !== 'done' && b.dueDate && b.dueDate < now) (groups[b.id] ||= { blocker: b, tasks: [] }).tasks.push(t);
      }
    }
    for (const g of Object.values(groups)) {
      alerts.push({
        key: `chain:${g.blocker.id}:${g.tasks
          .map((t) => t.id)
          .sort()
          .join(',')}`,
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
    const { start } = weekRange(now);
    for (const w of load) {
      if (w.hours > (w.available * (rules.overloadPct ?? 100)) / 100) {
        alerts.push({
          key: `overload:${w.user.id}:${start.toISOString().slice(0, 10)}`,
          type: 'overload',
          severity: 'warning',
          rule: `Tải tuần > ${rules.overloadPct ?? 100}% giờ khả dụng`,
          title:
            w.available === 0
              ? `${w.user.name} còn ${w.hours} giờ công việc nhưng không có giờ khả dụng`
              : `${w.user.name} đang ở mức ${w.pct}% tải tuần này (${w.hours}/${w.available} giờ)`,
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

  const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const taskInput = (t) => ({
    id: t.id, key: t.key, title: t.title, version: t.version, status: t.status,
    dueDate: t.dueDate, assignee: t.assignee?.id ?? null, estimateHours: t.estimateHours,
    remainingHours: t.remainingHours, spentHours: t.spentHours, reviewSince: t.reviewSince,
    blockedBy: t.blockedBy.map((b) => ({ id: b.id, version: b.version, status: b.status, dueDate: b.dueDate })).sort((a, b) => a.id.localeCompare(b.id)),
    subtasks: subs[t.id] ?? { total: 0, done: 0 },
  });
  const taskInputs = new Map(tasks.map((t) => [t.id, taskInput(t)]));
  const thresholds = Object.fromEntries(Object.entries(rules).sort(([a], [b]) => a.localeCompare(b)));
  const versioned = alerts.map((alert) => {
    const w = alert.type === 'overload' ? load.find((x) => x.user.id === alert.owner.id) : null;
    const inputs = alert.tasks.map((r) => taskInputs.get(r.id)).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
    const snapshot = JSON.parse(JSON.stringify({
      ruleVersion: RISK_ENGINE_VERSION, thresholdsVersion: project.riskRulesVersion, thresholds, projectId, type: alert.type, rule: alert.rule,
      tasks: inputs, owner: alert.owner ? { id: alert.owner.id, name: alert.owner.name } : null,
      ...(w && { capacity: { user: w.user.id, weekStart: w.weekStart, hours: w.hours, available: w.available, version: w.capacityVersion, source: w.capacitySource } }),
    }));
    return { ...alert, sourceVersion: hash(snapshot), snapshot, generatedAt: now.toISOString() };
  });
  const versions = new Map(versioned.map((a) => [a.key, a.sourceVersion]));
  const activeResolution = (r) => Boolean(r.reason?.trim() && r.sourceVersion && versions.get(r.key) === r.sourceVersion);
  const resolvedKeys = new Set(resolved.filter(activeResolution).map((r) => r.key));
  const order = { critical: 0, warning: 1 };
  return {
    open: versioned.filter((a) => !resolvedKeys.has(a.key)).sort((a, b) => order[a.severity] - order[b.severity]),
    resolved: resolved.slice(0, 10).map((r) => ({ ...r, current: activeResolution(r) })),
    rules,
    rulesVersion: project.riskRulesVersion,
    engineVersion: RISK_ENGINE_VERSION,
  };
}
