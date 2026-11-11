import { useState } from 'react';
import { Avatar, Empty, ErrorBox, Icon, PageHeader, PageLoader, Select } from '../components/ui.jsx';
import { api, download } from '../lib/api.js';
import { useApp, useLoad } from '../lib/app.jsx';
import { useSocketEvent } from '../lib/hooks.js';
import { t as tr, useI18n } from '../lib/i18n.js';

export default function Contributions() {
  useI18n();
  const { project } = useApp();
  const [sprint, setSprint] = useState('');
  const query = sprint ? `?sprint=${sprint}` : '';
  const { data, error, loading, reload } = useLoad(() => (project ? api.get(`/projects/${project._id}/contributions${query}`) : Promise.resolve(null)), [project?._id, query]);
  const sprints = useLoad(() => (project ? api.get(`/projects/${project._id}/sprints`) : Promise.resolve(null)), [project?._id]);
  useSocketEvent('board:refresh', () => reload(), [reload]);
  if (!project) return <Empty icon="folder_off" title={tr('Chọn dự án để xem đóng góp')} />;
  if (loading && !data) return <PageLoader />;
  if (error) return <div className="p-6"><ErrorBox error={error} onRetry={reload} /></div>;
  const sprintName = sprints.data?.sprints.find((s) => s._id === sprint)?.name;
  const columns = [tr('Được giao'), tr('Đã xong'), tr('Đúng hạn'), tr('Trễ'), tr('Đang quá hạn'), tr('Giờ phân bổ'), tr('Giờ đã ghi'), tr('Ngày ghi nhật ký'), tr('Tỷ trọng giờ'), tr('Bình luận'), tr('Vấn đề đã xử lý')];
  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 lg:p-6">
      <PageHeader
        title={tr('Đóng góp thành viên')}
        subtitle={`${project.name}${sprintName ? ` · ${sprintName}` : ''} · ${tr('Số liệu từ công việc và nhật ký hằng ngày, sắp theo tên, không xếp hạng.')}`}
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <button className="btn-outline" onClick={() => download(`/projects/${project._id}/contributions.csv${query}`, 'dong-gop-thanh-vien.csv')}><Icon name="download" size={16} />{tr(' Xuất CSV')}</button>
            <button className="btn-outline" onClick={() => window.print()}><Icon name="print" size={16} />{tr(' In / Lưu PDF')}</button>
          </div>
        }
      />
      <div className="no-print">
        <Select aria-label={tr('Phạm vi')} className="input h-8 w-auto py-0 text-body-sm" value={sprint} onChange={(e) => setSprint(e.target.value)}>
          <option value="">{tr('Toàn dự án')}</option>
          {(sprints.data?.sprints || []).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
        </Select>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-100">
            <tr>
              <th className="table-th">{tr('Thành viên')}</th>
              {columns.map((c) => <th key={c} className="table-th text-right">{c}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.rows.map((r) => (
              <tr key={r.user._id}>
                <td className="table-td"><div className="flex items-center gap-2"><Avatar user={r.user} size={28} /><span className="whitespace-nowrap font-semibold text-slate-900">{r.user.name}</span></div></td>
                {[r.assigned, r.done, r.doneOnTime, r.doneLate, r.overdue, r.plannedHours, r.loggedHours, r.logDays, `${r.sharePct}%`, r.comments, r.issuesResolved].map((v, i) => (
                  <td key={columns[i]} className="table-td text-right tabular-nums">{typeof v === 'number' ? Number(v.toFixed(2)) : v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!data.rows.length && <Empty icon="group" title={tr('Chưa có thành viên')} />}
      </div>
      <p className="text-body-sm text-slate-500">
        {tr('Tổng {0} giờ đã ghi trên {1} công việc', [Number(data.totalHours.toFixed(2)), data.totalTasks])}
        {data.unassigned > 0 && tr('; {0} việc chưa giao', [data.unassigned])}.
        {' '}{tr('Việc có nhiều người được tính cho từng người tham gia; giờ nhập trước khi có nhật ký không thuộc về cá nhân nào.')}
      </p>
    </div>
  );
}
