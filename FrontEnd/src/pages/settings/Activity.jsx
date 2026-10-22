import { Fragment, useState } from 'react';
import { Avatar, Empty, Icon, Modal, Notice, PageLoader, Pagination, Select } from '../../components/ui.jsx';
import { api, download, qs } from '../../lib/api.js';
import { useApp, useLoad } from '../../lib/app.jsx';
import { fmtDate, fmtTime, isoDate } from '../../lib/format.js';

const TONE = (a) =>
  /Xóa|Gỡ/.test(a)
    ? 'border-rose-200 bg-rose-50 text-rose-700'
    : /Phân quyền|Tham gia/.test(a)
      ? 'border-purple-200 bg-purple-50 text-purple-700'
      : /Tạo|Tải/.test(a)
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : /trạng thái|Duyệt/.test(a)
          ? 'border-blue-200 bg-blue-50 text-blue-700'
          : 'border-amber-200 bg-amber-50 text-amber-700';

const show = (v) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const COLS = [
  ['time', 'Thời gian'],
  ['actor', 'Người thực hiện'],
  ['action', 'Hành động'],
  ['entity', 'Đối tượng'],
  ['before', 'Giá trị cũ'],
  ['after', 'Giá trị mới'],
  ['project', 'Dự án'],
];

export default function Activity() {
  const { ws, projects } = useApp();
  const wsId = ws.workspace._id;
  const [f, setF] = useState({ search: '', actor: '', action: '', entityType: '', project: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [open, setOpen] = useState(null);
  const [exporting, setExporting] = useState(false);
  const members = useLoad(() => api.get(`/workspaces/${wsId}/members`), [wsId]);
  const { data, loading } = useLoad(() => api.get(`/workspaces/${wsId}/activity${qs({ ...f, page, limit })}`), [wsId, JSON.stringify(f), page, limit]);
  const set = (k, v) => (setF((s) => ({ ...s, [k]: v })), setPage(1));
  const active = Object.values(f).some(Boolean);

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input h-9 pl-8 text-body-sm" placeholder="Tìm theo mã công việc hoặc nội dung" value={f.search} onChange={(e) => set('search', e.target.value)} />
        </div>
        <Select className="input h-9 w-auto text-body-sm" value={f.actor} onChange={(e) => set('actor', e.target.value)}>
          <option value="">Người thực hiện</option>
          {(members.data?.members || []).map((m) => (
            <option key={m.user._id} value={m.user._id}>
              {m.user.name}
            </option>
          ))}
        </Select>
        <Select className="input h-9 w-auto text-body-sm" value={f.action} onChange={(e) => set('action', e.target.value)}>
          <option value="">Loại hành động</option>
          {(data?.actions || []).map((a) => (
            <option key={a}>{a}</option>
          ))}
        </Select>
        <Select className="input h-9 w-auto text-body-sm" value={f.entityType} onChange={(e) => set('entityType', e.target.value)}>
          <option value="">Đối tượng</option>
          {[
            ['task', 'Công việc'],
            ['project', 'Dự án'],
            ['member', 'Thành viên'],
            ['file', 'Tệp'],
            ['ai', 'AI'],
          ].map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Select className="input h-9 w-auto text-body-sm" value={f.project} onChange={(e) => set('project', e.target.value)}>
          <option value="">Dự án</option>
          {projects.map((p) => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </Select>
        <input type="date" className="input h-9 w-auto text-body-sm" value={f.from} onChange={(e) => set('from', e.target.value)} title="Từ ngày" />
        <input type="date" className="input h-9 w-auto text-body-sm" value={f.to} onChange={(e) => set('to', e.target.value)} title="Đến ngày" />
        {active && (
          <button className="btn-ghost btn-sm" onClick={() => setF({ search: '', actor: '', action: '', entityType: '', project: '', from: '', to: '' })}>
            Đặt lại
          </button>
        )}
        <button className="btn-primary ml-auto" onClick={() => setExporting(true)}>
          <Icon name="download" size={16} /> Xuất CSV
        </button>
      </div>
      {loading && !data ? (
        <PageLoader />
      ) : !data.items.length ? (
        <Empty icon="history" title="Không có bản ghi" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-100">
              <tr>
                {['Thời gian', 'Người thực hiện', 'Hành động', 'Đối tượng', 'Thay đổi', 'Dự án'].map((h) => (
                  <th key={h} className="table-th">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((a) => (
                <Fragment key={a._id}>
                  <tr className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(open === a._id ? null : a._id)}>
                    <td className="table-td whitespace-nowrap">
                      <p className="font-medium text-slate-800">{fmtDate(a.createdAt, { year: true })}</p>
                      <p className="font-mono text-label-md text-slate-400">{fmtTime(a.createdAt)}</p>
                    </td>
                    <td className="table-td whitespace-nowrap">
                      <span className="flex items-center gap-2">
                        <Avatar user={a.actor} size={24} /> {a.actor?.name || 'Hệ thống'}
                      </span>
                    </td>
                    <td className="table-td whitespace-nowrap">
                      <span className={`chip ${TONE(a.action)}`}>{a.action}</span>
                    </td>
                    <td className="table-td max-w-[280px] truncate text-blue-700">{a.entityLabel}</td>
                    <td className="table-td max-w-[260px]">
                      {a.before != null && <span className="mr-1 text-slate-400 line-through">{show(a.before).slice(0, 40)}</span>}
                      {a.before != null && a.after != null && <span className="text-slate-400">→ </span>}
                      {a.after != null && <b className="text-slate-800">{show(a.after).slice(0, 40)}</b>}
                    </td>
                    <td className="table-td whitespace-nowrap text-slate-500">{a.project?.name || '—'}</td>
                  </tr>
                  {open === a._id && (
                    <tr className="bg-slate-50">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded-lg border border-rose-200 bg-white p-3">
                            <p className="section-label mb-1 text-rose-600">Giá trị trước</p>
                            <pre className="whitespace-pre-wrap font-mono text-[12px] text-slate-700">{show(a.before)}</pre>
                          </div>
                          <div className="rounded-lg border border-emerald-200 bg-white p-3">
                            <p className="section-label mb-1 text-emerald-600">Giá trị sau</p>
                            <pre className="whitespace-pre-wrap font-mono text-[12px] text-slate-700">{show(a.after)}</pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <Pagination page={page} total={data.total} limit={limit} onPage={setPage} onLimit={(n) => (setLimit(n), setPage(1))} />
        </div>
      )}
      <ExportModal open={exporting} onClose={() => setExporting(false)} wsId={wsId} filters={f} total={data?.total} />
    </div>
  );
}

function ExportModal({ open, onClose, wsId, filters, total }) {
  const [from, setFrom] = useState(filters.from || isoDate(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(filters.to || isoDate(new Date()));
  const [cols, setCols] = useState(COLS.map((c) => c[0]));
  const go = () => {
    download(`/workspaces/${wsId}/activity.csv${qs({ ...filters, from, to, columns: cols.join(',') })}`, `nhat-ky-${from}-${to}.csv`);
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Xuất nhật ký ra CSV"
      subtitle="Tải nhật ký truy vết để báo cáo tiến độ và nghiệm thu"
      icon="download"
      footer={
        <>
          <button className="btn-outline" onClick={onClose}>
            Hủy
          </button>
          <button className="btn-primary" onClick={go} disabled={!cols.length}>
            <Icon name="download" size={16} /> Xuất CSV{total != null ? ` (${total} dòng)` : ''}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="label">Từ ngày</span>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            <span className="label">Đến ngày</span>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div>
          <span className="label">Chọn cột cần xuất</span>
          <div className="grid grid-cols-2 gap-2">
            {COLS.map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-body-sm">
                <input type="checkbox" className="form-checkbox rounded text-blue-600" checked={cols.includes(k)} onChange={() => setCols(cols.includes(k) ? cols.filter((x) => x !== k) : [...cols, k])} />
                {l}
              </label>
            ))}
          </div>
        </div>
        <Notice tone="info">Phạm vi: chỉ dữ liệu bạn có quyền xem (theo phân quyền của workspace).</Notice>
        <Notice tone="warn">Bảo mật: các ô bắt đầu bằng =, +, -, @ sẽ được thêm dấu ' để tránh chèn công thức khi mở bằng Excel.</Notice>
      </div>
    </Modal>
  );
}
