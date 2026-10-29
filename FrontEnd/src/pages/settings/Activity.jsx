import { t as tr, useI18n } from '../../lib/i18n.js';
import { Fragment, useState } from 'react';
import { Avatar, Empty, ErrorBox, Icon, Modal, Notice, PageLoader, Pagination, Select } from '../../components/ui.jsx';
import { api, download, qs } from '../../lib/api.js';
import { useApp, useLoad } from '../../lib/app.jsx';
import { fmtDate, fmtTime, isoDate } from '../../lib/format.js';

const TONE = (a) =>
  (/Xóa|Gỡ/.test(a)
    ? 'border-rose-200 bg-rose-50 text-rose-700'
    : /Phân quyền|Tham gia/.test(a)
      ? 'border-purple-200 bg-purple-50 text-purple-700'
      : /Tạo|Tải/.test(a)
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : /trạng thái|Duyệt/.test(a)
          ? 'border-blue-200 bg-blue-50 text-blue-700'
          : 'border-amber-200 bg-amber-50 text-amber-700');

const show = (v) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const getColumns = () => [
  ['time', tr("Thời gian")],
  ['actor', tr("Người thực hiện")],
  ['action', tr("Hành động")],
  ['entity', tr("Đối tượng")],
  ['before', tr("Giá trị cũ")],
  ['after', tr("Giá trị mới")],
  ['project', tr("Dự án")],
];

export default function Activity() {
  useI18n();
  const { ws, projects } = useApp();
  const wsId = ws.workspace._id;
  const [f, setF] = useState({ search: '', actor: '', action: '', entityType: '', project: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [open, setOpen] = useState(null);
  const [exporting, setExporting] = useState(false);
  const members = useLoad(() => api.get(`/workspaces/${wsId}/members`), [wsId]);
  const { data, loading, error, reload } = useLoad(() => api.get(`/workspaces/${wsId}/activity${qs({ ...f, page, limit })}`), [wsId, JSON.stringify(f), page, limit]);
  const set = (k, v) => (setF((s) => ({ ...s, [k]: v })), setPage(1));
  const active = Object.values(f).some(Boolean);

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input h-9 pl-8 text-body-sm" placeholder={tr("Tìm theo mã công việc hoặc nội dung")} value={f.search} onChange={(e) => set('search', e.target.value)} />
        </div>
        <Select className="input h-9 w-auto text-body-sm" value={f.actor} onChange={(e) => set('actor', e.target.value)}>
          <option value="">{tr("Người thực hiện")}</option>
          {(members.data?.members || []).map((m) => (
            <option key={m.user._id} value={m.user._id}>
              {m.user.name}
            </option>
          ))}
        </Select>
        <Select className="input h-9 w-auto text-body-sm" value={f.action} onChange={(e) => set('action', e.target.value)}>
          <option value="">{tr("Loại hành động")}</option>
          {(data?.actions || []).map((a) => (
            <option key={a}>{a}</option>
          ))}
        </Select>
        <Select className="input h-9 w-auto text-body-sm" value={f.entityType} onChange={(e) => set('entityType', e.target.value)}>
          <option value="">{tr("Đối tượng")}</option>
          {[
            ['task', tr("Công việc")],
            ['project', tr("Dự án")],
            ['member', tr("Thành viên")],
            ['file', tr("Tệp")],
            ['ai', 'AI'],
          ].map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Select className="input h-9 w-auto text-body-sm" value={f.project} onChange={(e) => set('project', e.target.value)}>
          <option value="">{tr("Dự án")}</option>
          {projects.map((p) => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </Select>
        <input type="date" className="input h-9 w-auto text-body-sm" value={f.from} onChange={(e) => set('from', e.target.value)} title={tr("Từ ngày")} />
        <input type="date" className="input h-9 w-auto text-body-sm" value={f.to} onChange={(e) => set('to', e.target.value)} title={tr("Đến ngày")} />
        {active && (
          <button className="btn-ghost btn-sm" onClick={() => { setF({ search: '', actor: '', action: '', entityType: '', project: '', from: '', to: '' }); setPage(1); }}>{tr("Đặt lại")}</button>
        )}
        <button className="btn-primary ml-auto" onClick={() => setExporting(true)}>
          <Icon name="download" size={16} />{tr(" Xuất CSV")}</button>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <PageLoader />
      ) : error && !data ? null : !data?.items?.length ? (
        <Empty icon="history" title={tr("Không có bản ghi")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-100">
              <tr>
                {[tr("Thời gian"), tr("Người thực hiện"), tr("Hành động"), tr("Đối tượng"), tr("Thay đổi"), tr("Dự án")].map((h) => (
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
                        <Avatar user={a.actor} size={24} /> {a.actor?.name || tr("Hệ thống")}
                      </span>
                    </td>
                    <td className="table-td whitespace-nowrap">
                      <span className={`chip ${TONE(a.action)}`}>{tr(a.action)}</span>
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
                            <p className="section-label mb-1 text-rose-600">{tr("Giá trị trước")}</p>
                            <pre className="whitespace-pre-wrap font-mono text-[12px] text-slate-700">{show(a.before)}</pre>
                          </div>
                          <div className="rounded-lg border border-emerald-200 bg-white p-3">
                            <p className="section-label mb-1 text-emerald-600">{tr("Giá trị sau")}</p>
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
      {exporting && <ExportModal open onClose={() => setExporting(false)} wsId={wsId} filters={f} total={data?.total} />}
    </div>
  );
}

function ExportModal({ open, onClose, wsId, filters, total }) {
  useI18n();
  const [from, setFrom] = useState(filters.from || isoDate(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(filters.to || isoDate(new Date()));
  const [cols, setCols] = useState(getColumns().map((c) => c[0]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await download(`/workspaces/${wsId}/activity.csv${qs({ ...filters, from, to, columns: cols.join(',') })}`, `nhat-ky-${from}-${to}.csv`);
      onClose();
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  };
  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onClose(); }}
      title={tr("Xuất nhật ký ra CSV")}
      subtitle={tr("Tải nhật ký truy vết để báo cáo tiến độ và nghiệm thu")}
      icon="download"
      footer={
        <>
          <button className="btn-outline" onClick={onClose} disabled={busy}>{tr("Hủy")}</button>
          <button className="btn-primary" onClick={go} disabled={busy || !cols.length || !from || !to || from > to}>
            <Icon name="download" size={16} /> {busy ? tr("Đang xuất…") : tr("Xuất CSV")}{total != null ? tr(" ({0} dòng)", [total]) : ''}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBox error={error} />
        {from && to && from > to && <Notice tone="warn">{tr("Ngày kết thúc phải từ ngày bắt đầu trở đi.")}</Notice>}
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="label">{tr("Từ ngày")}</span>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            <span className="label">{tr("Đến ngày")}</span>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div>
          <span className="label">{tr("Chọn cột cần xuất")}</span>
          <div className="grid grid-cols-2 gap-2">
            {getColumns().map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-body-sm">
                <input type="checkbox" className="form-checkbox rounded text-blue-600" checked={cols.includes(k)} onChange={() => setCols(cols.includes(k) ? cols.filter((x) => x !== k) : [...cols, k])} />
                {l}
              </label>
            ))}
          </div>
        </div>
        <Notice tone="info">{tr("Phạm vi: chỉ dữ liệu bạn có quyền xem (theo phân quyền của workspace).")}</Notice>
        <Notice tone="warn">{tr("Bảo mật: các ô bắt đầu bằng =, +, -, @ sẽ được thêm dấu ' để tránh chèn công thức khi mở bằng Excel.")}</Notice>
      </div>
    </Modal>
  );
}
