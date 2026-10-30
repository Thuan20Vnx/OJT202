import { t as tr, useI18n } from '../../lib/i18n.js';
import { useRef, useState } from 'react';
import { Avatar, ErrorBox, Icon, Notice, PageLoader, Pagination, Progress, Select, Spinner, StatCard, Toggle } from '../../components/ui.jsx';
import { api, download, qs } from '../../lib/api.js';
import { useApp, useLoad, useToast } from '../../lib/app.jsx';
import { fmtTime, fmtDate } from '../../lib/format.js';

const getFeatures = () => [
  ['planner', tr("Lập kế hoạch")],
  ['report', tr("Báo cáo tiến độ")],
  ['qa', tr("Hỏi đáp dự án")],
  ['risk', tr("Diễn giải cảnh báo rủi ro")],
  ['meeting', tr("Ghi chú họp → action items")],
];
const STATUS = {
  get pending() { return [tr("Đang xử lý"), 'border-sky-200 bg-sky-50 text-sky-700', tr("Đã tính vào hạn mức hôm nay")]; },
  get success() { return [tr("Thành công"), 'border-emerald-200 bg-emerald-50 text-emerald-700']; },
  get retried_success() { return [tr("Thành công"), 'border-emerald-200 bg-emerald-50 text-emerald-700', tr("Đã thử lại 1 lần sau khi quá thời gian")]; },
  get timeout() { return [tr("Quá thời gian"), 'border-amber-200 bg-amber-50 text-amber-700', tr("Đã thử lại 1 lần")]; },
  get error() { return [tr("Lỗi"), 'border-rose-200 bg-rose-50 text-rose-700']; },
  get quota_exceeded() { return [tr("Vượt hạn mức"), 'border-slate-200 bg-slate-100 text-slate-600']; },
  get disabled() { return [tr("Đang tắt"), 'border-slate-200 bg-slate-100 text-slate-600']; },
};
const featureLabels = () => Object.fromEntries(getFeatures());

export default function AiSettings() {
  useI18n();
  const { ws, role } = useApp();
  const toast = useToast();
  const isAdmin = ['owner', 'admin'].includes(role);
  const wsId = ws.workspace._id;
  const { data, loading, error, reload, setData } = useLoad(() => api.get(`/workspaces/${wsId}/ai`), [wsId]);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const calls = useLoad(() => (isAdmin ? api.get(`/workspaces/${wsId}/ai/calls${qs({ page, status, limit: 10 })}`) : Promise.resolve(null)), [wsId, page, status, isAdmin]);
  const [draft, setDraft] = useState({ limit: null, timeout: null });
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const pending = useRef(false);
  const exportPending = useRef(false);

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const s = data.settings;
  const t = data.today;
  const limit = draft.limit ?? s.dailyLimit;
  const timeout = draft.timeout ?? s.timeoutSec;

  const patch = async (body, msg = tr("Đã lưu cài đặt AI")) => {
    if (pending.current || !isAdmin) return;
    pending.current = true;
    setSaving(true);
    setActionError(null);
    try {
      const d = await api.patch(`/workspaces/${wsId}/ai`, body);
      setData((x) => ({ ...x, settings: d.settings }));
      setDraft((current) => ({
        limit: body.dailyLimit === undefined ? current.limit : null,
        timeout: body.timeoutSec === undefined ? current.timeout : null,
      }));
      toast(msg);
    } catch (e) {
      setActionError(e);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  const saveLimits = () => {
    if (String(limit).trim() === '' || !Number.isInteger(Number(limit)) || Number(limit) < 0 || Number(limit) > 10000) {
      setActionError(new Error(tr("Nhập hạn mức nguyên từ 0 đến 10.000 lượt/ngày")));
      return;
    }
    if (String(timeout).trim() === '' || !Number.isInteger(Number(timeout)) || Number(timeout) < 5 || Number(timeout) > 120) {
      setActionError(new Error(tr("Nhập thời gian chờ nguyên từ 5 đến 120 giây")));
      return;
    }
    return patch({ dailyLimit: Number(limit), timeoutSec: Number(timeout) });
  };
  const exportCsv = async () => {
    if (exportPending.current) return;
    exportPending.current = true;
    setExporting(true);
    setActionError(null);
    try {
      await download(`/workspaces/${wsId}/ai/calls.csv`, 'nhat-ky-ai.csv');
    } catch (e) {
      setActionError(e);
    } finally {
      exportPending.current = false;
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <ErrorBox error={actionError} />
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <span className={`chip ${s.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${s.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />
          {s.enabled ? tr("Đang hoạt động") : tr("Đang tắt")}
        </span>
        <span className="text-body-sm text-slate-600">{tr("Nhà cung cấp:")}{' '}
          <b>
            {data.provider.type === 'anthropic'
              ? `Anthropic · ${data.provider.model}`
              : data.provider.type === 'local'
                ? tr("Bộ AI nội bộ (quy tắc, không gọi mạng)")
                : tr("Không kết nối được AIService – kiểm tra dịch vụ AI đã chạy chưa")}
          </b>
        </span>
        <div className="ml-auto flex items-center gap-2 text-body-sm">
          <span className="text-slate-600">{tr("Trợ lý AI toàn nhóm")}</span>
          <Toggle checked={s.enabled} disabled={!isAdmin || saving} onChange={(v) => patch({ enabled: v }, v ? tr("Đã bật Trợ lý AI") : tr("Đã tắt Trợ lý AI"))} label={tr("Bật/tắt AI")} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={tr("Lượt đã dùng")} value={`${t.used}/${s.dailyLimit}`} sub={tr("Hôm nay")} icon="bolt" tone="purple">
          <Progress value={(t.used / Math.max(1, s.dailyLimit)) * 100} tone="bg-purple-500" className="mt-2" />
        </StatCard>
        <StatCard label={tr("Token đã dùng")} value={t.tokens >= 1000 ? `${(t.tokens / 1000).toFixed(1)}K` : t.tokens} sub={tr("Vào + ra, hôm nay")} icon="token" tone="blue" />
        <StatCard label={tr("Độ trễ trung bình")} value={tr("{0} giây", [(t.avgLatencyMs / 1000).toFixed(1)])} sub={tr("Các lượt thành công")} icon="timer" tone="green" />
        <StatCard label={tr("Tỉ lệ lỗi")} value={`${t.total ? Math.round((t.errors / t.total) * 100) : 0}%`} sub={tr("{0} lỗi hôm nay", [t.errors])} icon="error" tone="red" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <div className="card space-y-3 p-4">
            <p className="flex items-center gap-1.5 text-label-lg font-semibold text-slate-900">
              <Icon name="speed" size={18} className="text-blue-600" />{tr(" Hạn mức sử dụng")}</p>
            <label className="block">
              <span className="label">{tr("Số lượt tối đa mỗi ngày")}</span>
              <div className="flex gap-2">
                <input type="number" min="0" max="10000" className="input" value={limit} disabled={!isAdmin || saving} onChange={(e) => setDraft((d) => ({ ...d, limit: e.target.value }))} />
                <span className="flex items-center text-body-sm text-slate-500">{tr("lượt/ngày")}</span>
              </div>
            </label>
            <p className="text-label-md font-normal text-slate-400">{tr("Đặt lại lúc 00:00 mỗi ngày. Hết hạn mức thì các tính năng AI tạm dừng, CRUD vẫn hoạt động.")}</p>
            <p className="section-label pt-1">{tr("Bật/tắt theo tính năng")}</p>
            {getFeatures().map(([k, l]) => (
              <div key={k} className="flex items-center justify-between text-body-sm">
                <span className="text-slate-700">{l}</span>
                <Toggle checked={s.features[k] !== false} disabled={!isAdmin || saving} onChange={(v) => patch({ features: { [k]: v } })} label={l} />
              </div>
            ))}
          </div>
          <div className="card space-y-3 p-4">
            <p className="flex items-center gap-1.5 text-label-lg font-semibold text-slate-900">
              <Icon name="timer" size={18} className="text-blue-600" />{tr(" Xử lý lỗi & Timeout")}</p>
            <label className="block">
              <span className="label">{tr("Thời gian chờ tối đa")}</span>
              <div className="flex gap-2">
                <input type="number" min="5" max="120" className="input" value={timeout} disabled={!isAdmin || saving} onChange={(e) => setDraft((d) => ({ ...d, timeout: e.target.value }))} />
                <span className="flex items-center text-body-sm text-slate-500">{tr("giây")}</span>
              </div>
            </label>
            <div className="flex items-center justify-between text-body-sm">
              <span className="text-slate-700">{tr("Thử lại khi quá thời gian")}</span>
              <span className="chip border-slate-200 bg-slate-50 text-slate-600">{tr("Tối đa 1 lần (cố định)")}</span>
            </div>
            <Notice tone="info">{tr("Khi AI lỗi, các chức năng tạo/sửa công việc vẫn hoạt động bình thường.")}</Notice>
            {isAdmin && (
              <button className="btn-primary w-full" disabled={saving} onClick={saveLimits}>
                {saving && <Spinner />}{tr("Lưu thay đổi")}</button>
            )}
          </div>
        </div>
        <div className="card min-w-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
            <p className="flex items-center gap-1.5 text-label-lg font-semibold text-slate-900">
              <Icon name="receipt_long" size={18} className="text-blue-600" />{tr(" Nhật ký gọi AI")}</p>
            {isAdmin && (
              <>
                <Select className="input ml-auto h-8 w-auto py-0 text-body-sm" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
                  <option value="">{tr("Tất cả trạng thái")}</option>
                  {Object.entries(STATUS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v[0]}
                      {k === 'retried_success' ? tr(" (thử lại)") : ''}
                    </option>
                  ))}
                </Select>
                <button className="btn-outline btn-sm" disabled={exporting} onClick={exportCsv}>
                  <Icon name="download" size={16} />{tr(" Xuất CSV")}</button>
              </>
            )}
          </div>
          {!isAdmin ? (
            <p className="p-6 text-center text-body-sm text-slate-500">{tr("Chỉ Owner/Admin xem được nhật ký gọi AI.")}</p>
          ) : calls.loading && !calls.data ? (
            <PageLoader />
          ) : calls.error ? (
            <div className="p-4"><ErrorBox error={calls.error} onRetry={calls.reload} /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-slate-100">
                  <tr>
                    {[tr("Thời gian"), tr("Người dùng"), tr("Tính năng"), 'Model', 'Token', tr("Độ trễ"), tr("Trạng thái")].map((h) => (
                      <th key={h} className="table-th">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(calls.data?.items || []).map((c) => {
                    const st = STATUS[c.status] || [c.status, ''];
                    return (
                      <tr key={c._id} className="hover:bg-slate-50">
                        <td className="table-td whitespace-nowrap font-mono text-label-md text-slate-500">
                          {fmtDate(c.createdAt)} {fmtTime(c.createdAt)}
                        </td>
                        <td className="table-td whitespace-nowrap">
                          <span className="flex items-center gap-2">
                            <Avatar user={c.user} size={22} /> {c.user?.name}
                          </span>
                        </td>
                        <td className="table-td whitespace-nowrap">{featureLabels()[c.feature]}</td>
                        <td className="table-td whitespace-nowrap">
                          <span className="chip border-slate-200 bg-slate-50 font-mono text-slate-600">{c.model}</span>
                        </td>
                        <td className="table-td whitespace-nowrap text-slate-600">{(c.inputTokens + c.outputTokens).toLocaleString('vi-VN')}</td>
                        <td className={`table-td whitespace-nowrap ${c.latencyMs > 10000 ? 'text-amber-600' : 'text-slate-600'}`}>{(c.latencyMs / 1000).toFixed(1)}s</td>
                        <td className="table-td whitespace-nowrap">
                          <span className={`chip ${st[1]}`} title={st[2] || c.error || ''}>
                            {st[0]}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {calls.data && <Pagination page={page} total={calls.data.total} limit={10} onPage={setPage} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
