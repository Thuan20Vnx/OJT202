import { useNavigate } from 'react-router-dom';
import { Empty, ErrorBox, Icon, PageHeader, PageLoader, Progress } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useApp, useLoad } from '../lib/app.jsx';
import { fmtProjectDate as fmtDate } from '../lib/format.js';
import { t as tr, useI18n } from '../lib/i18n.js';

export default function Mentoring() {
  useI18n();
  const { setWsId, setProjectId } = useApp();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api.get('/me/mentoring'), []);
  if (loading && !data) return <PageLoader />;
  if (error) return <div className="p-6"><ErrorBox error={error} onRetry={reload} /></div>;
  const open = (workspace, project, path) => {
    setWsId(workspace);
    setProjectId(project);
    navigate(path);
  };
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">
      <PageHeader title={tr('Các nhóm hướng dẫn')} subtitle={tr('Theo dõi tiến độ mọi nhóm bạn được mời làm giảng viên. Bạn có thể xem và bình luận, không sửa được công việc.')} />
      {!data.groups.length && <Empty icon="school" title={tr('Bạn chưa hướng dẫn nhóm nào')} />}
      {data.groups.map((g) => (
        <section key={g.workspace._id} className="space-y-3">
          <h2 className="text-headline-sm text-slate-900">{g.workspace.name}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {g.projects.map((p) => (
              <article key={p._id} className="card space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-slate-900">{p.name}</h3>
                    <p className="text-label-md font-normal text-slate-500">{p.sprint?.name ? `${p.sprint.name}${p.sprint.end ? ` · ${tr('kết thúc')} ${fmtDate(p.sprint.end)}` : ''}` : tr('Chưa có Sprint đang chạy')}</p>
                  </div>
                  <span className="text-right font-semibold tabular-nums text-blue-700">{p.progressPct}%</span>
                </div>
                <Progress value={p.progressPct} />
                <dl className="grid grid-cols-3 gap-2 text-center text-body-sm">
                  <div><dd className="font-semibold tabular-nums text-slate-900">{p.done}/{p.total}</dd><dt className="text-label-sm text-slate-500">{tr('Việc xong')}</dt></div>
                  <div><dd className={`font-semibold tabular-nums ${p.overdue ? 'text-rose-700' : 'text-slate-900'}`}>{p.overdue}</dd><dt className="text-label-sm text-slate-500">{tr('Quá hạn')}</dt></div>
                  <div><dd className={`font-semibold tabular-nums ${p.openIssues ? 'text-amber-700' : 'text-slate-900'}`}>{p.openIssues}</dd><dt className="text-label-sm text-slate-500">{tr('Vấn đề mở')}</dt></div>
                </dl>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-outline btn-sm" onClick={() => open(g.workspace._id, p._id, '/overview')}><Icon name="dashboard" size={14} />{tr(' Tổng quan')}</button>
                  <button className="btn-outline btn-sm" onClick={() => open(g.workspace._id, p._id, '/contributions')}><Icon name="groups" size={14} />{tr(' Đóng góp')}</button>
                </div>
              </article>
            ))}
            {!g.projects.length && <p className="text-body-sm text-slate-500">{tr('Nhóm chưa có dự án nào.')}</p>}
          </div>
        </section>
      ))}
    </div>
  );
}
