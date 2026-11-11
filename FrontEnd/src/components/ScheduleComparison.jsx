import { isoDate } from '../lib/format.js';

const day = (value) => value ? Date.parse(`${isoDate(value)}T00:00:00Z`) : null;
export function scheduleDomain(tasks) {
  const days = tasks.flatMap((t) => [t.plannedStartDate, t.dueDate, t.actualStartDate, t.actualEndDate, ...(t.actualStartDate && !t.actualEndDate && t.status !== 'done' ? [new Date()] : [])]).filter(Boolean).map(day);
  if (!days.length) return [day(new Date()), day(new Date()) + 86400000];
  const from = Math.min(...days), to = Math.max(...days);
  return [from, Math.max(to, from + 86400000)];
}

export default function ScheduleComparison({ task, domain }) {
  const [from, to] = domain || scheduleDomain([task]);
  const line = (label, start, end, color, ongoing = false) => {
    const a = day(start), b = day(end);
    const startAt = a ?? b;
    const finishAt = b ?? (a && ongoing ? day(new Date()) : a);
    const left = startAt == null ? 0 : Math.max(0, Math.min(98, (startAt - from) / (to - from) * 100));
    const width = Math.max(2, Math.min(100 - left, ((finishAt ?? startAt) - startAt) / (to - from) * 100));
    const text = `${label}: ${start ? isoDate(start) : 'Chưa có ngày bắt đầu'} → ${end ? isoDate(end) : ongoing && start ? 'Đang thực hiện' : 'Chưa có ngày kết thúc'}`;
    return <div className="space-y-1" key={label}>
      <p className="text-label-md text-slate-600">{text}</p>
      <div className="relative h-3 rounded bg-slate-100" role="img" aria-label={text}>
        {startAt != null && <span className={`absolute h-3 rounded ${color}`} style={{ left: `${left}%`, width: `${width}%`, ...(a == null || b == null ? { opacity: 0.65 } : {}) }} />}
      </div>
    </div>;
  };
  const delay = task.dueDate && task.actualEndDate ? Math.round((day(task.actualEndDate) - day(task.dueDate)) / 86400000) : null;
  const late = task.status !== 'done' && task.dueDate && new Date(task.dueDate) < new Date();
  return <div className="space-y-2" data-testid="schedule-comparison">
    {line('Kế hoạch', task.plannedStartDate, task.dueDate, 'bg-blue-500')}
    {line('Thực tế', task.actualStartDate, task.actualEndDate, task.status === 'done' ? 'bg-emerald-500' : 'bg-amber-500', task.status !== 'done')}
    {delay != null && <p className={`text-label-md ${delay > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{delay > 0 ? `Kết thúc trễ ${delay} ngày` : delay < 0 ? `Kết thúc sớm ${-delay} ngày` : 'Kết thúc đúng ngày kế hoạch'}</p>}
    {late && !task.actualEndDate && <p className="text-label-md font-semibold text-rose-700">Đã qua hạn kế hoạch, chưa ghi nhận kết thúc thực tế</p>}
  </div>;
}
