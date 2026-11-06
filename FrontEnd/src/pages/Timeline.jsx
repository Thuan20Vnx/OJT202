import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApp, useLoad } from '../lib/app.jsx';
import { useDebouncedValue, useSocketEvent } from '../lib/hooks.js';
import { WORK_TYPES, hoursText } from '../lib/delivery.js';
import { Empty, ErrorBox, PageHeader, PageLoader, Pagination, PriorityChip, StatusChip } from '../components/ui.jsx';
import ScheduleComparison, { scheduleDomain } from '../components/ScheduleComparison.jsx';

export default function Timeline() {
  const { project } = useApp();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const query = useDebouncedValue(search);
  const { data, loading, error, reload } = useLoad(() => project ? api.get(`/projects/${project._id}/delivery-timeline?page=${page}&limit=20&search=${encodeURIComponent(query)}`) : Promise.resolve(null), [project?._id, page, query]);
  useSocketEvent('board:refresh', reload, [reload]);
  useSocketEvent('task:changed', reload, [reload]);
  if (!project) return <Empty title="Chọn một dự án để xem tiến độ" />;
  const domain = scheduleDomain(data?.tasks || []);
  return <div className="space-y-5 p-4 lg:p-6">
    <PageHeader title="Kế hoạch & thực tế" subtitle={`${project.name} · Hai thanh dùng chung thang ngày trong trang hiện tại. Khoảng thiếu ngày chỉ là mốc, chưa phải thời lượng đã xác nhận.`} />
    <input className="input max-w-md" aria-label="Tìm công việc trên tiến độ" placeholder="Tìm tên hoặc mã công việc…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
    {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <PageLoader /> : <>
      {!data?.tasks.length && <Empty title="Chưa có công việc phù hợp" />}
      {data?.tasks.map((t) => <article key={t._id} className="card grid gap-4 p-4 lg:grid-cols-[minmax(180px,1fr)_2fr_120px]">
        <div><button className="text-left font-semibold text-blue-700 hover:underline" onClick={() => navigate(`?task=${t._id}`)}>{t.key} · {t.title}</button><p className="my-2 text-body-sm text-slate-500">{WORK_TYPES[t.workType]}{t.parent ? ' · Công việc con' : ''}</p><div className="flex gap-2"><StatusChip status={t.status} /><PriorityChip priority={t.priority} /></div></div>
        <ScheduleComparison task={t} domain={domain} />
        <div className="text-right tabular-nums"><p className="font-semibold">{t.progressPct}%</p><p className="text-label-md text-slate-500">Tiến độ báo cáo</p><p className="mt-3">{hoursText(t.spentHours)} / {t.estimateHours == null ? '?' : hoursText(t.estimateHours)} h</p><p className="text-label-md text-slate-500">Đã làm / ước lượng{t.estimateHours == null ? ' chưa có' : ''}</p></div>
      </article>)}
      {data && <Pagination page={page} total={data.total} limit={20} onPage={setPage} />}
    </>}
  </div>;
}
