import { useEffect, useState } from 'react';
import { Avatar, Icon, Notice, PageLoader, Pagination, Progress, Select, Spinner, StatCard, Toggle } from '../../components/ui.jsx';
import { api, download, qs } from '../../lib/api.js';
import { useApp, useLoad, useToast } from '../../lib/app.jsx';
import { fmtTime, fmtDate } from '../../lib/format.js';

const FEATURES = [
  ['planner', 'Lập kế hoạch'],
  ['report', 'Báo cáo tiến độ'],
  ['qa', 'Hỏi đáp dự án'],
  ['risk', 'Diễn giải cảnh báo rủi ro'],
  ['meeting', 'Ghi chú họp → action items'],
];
const STATUS = {
  success: ['Thành công', 'border-emerald-200 bg-emerald-50 text-emerald-700'],
  retried_success: ['Thành công', 'border-emerald-200 bg-emerald-50 text-emerald-700', 'Đã thử lại 1 lần sau khi quá thời gian'],
  timeout: ['Quá thời gian', 'border-amber-200 bg-amber-50 text-amber-700', 'Đã thử lại 1 lần'],
  error: ['Lỗi', 'border-rose-200 bg-rose-50 text-rose-700'],
  quota_exceeded: ['Vượt hạn mức', 'border-slate-200 bg-slate-100 text-slate-600'],
  disabled: ['Đang tắt', 'border-slate-200 bg-slate-100 text-slate-600'],
};
const FEATURE_LABEL = Object.fromEntries(FEATURES);

export default function AiSettings() {
  const { ws, role } = useApp();
  const toast = useToast();
  const isAdmin = ['owner', 'admin'].includes(role);
  const wsId = ws.workspace._id;
  const { data, loading, setData } = useLoad(() => api.get(`/workspaces/${wsId}/ai`), [wsId]);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const calls = useLoad(() => (isAdmin ? api.get(`/workspaces/${wsId}/ai/calls${qs({ page, status, limit: 10 })}`) : Promise.resolve(null)), [wsId, page, status, isAdmin]);
  const [limit, setLimit] = useState('');
  const [timeout, setTimeoutSec] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data) {
      setLimit(data.settings.dailyLimit);
      setTimeoutSec(data.settings.timeoutSec);
    }
  }, [data]);

  if (loading && !data) return <PageLoader />;
  const s = data.settings;
  const t = data.today;

  const patch = async (body, msg = 'Đã lưu cài đặt AI') => {
    setSaving(true);
    try {
      const d = await api.patch(`/workspaces/${wsId}/ai`, body);
      setData((x) => ({ ...x, settings: d.settings }));
      toast(msg);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <span className={`chip ${s.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${s.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />
          {s.enabled ? 'Đang hoạt động' : 'Đang tắt'}
        </span>
        <span className="text-body-sm text-slate-600">
          Nhà cung cấp:{' '}
          <b>
            {data.provider.type === 'anthropic'
              ? `Anthropic · ${data.provider.model}`
              : data.provider.type === 'local'
                ? 'Bộ AI nội bộ (quy tắc, không gọi mạng)'
                : 'Không kết nối được AIService – kiểm tra dịch vụ AI đã chạy chưa'}
          </b>
        </span>
        <div className="ml-auto flex items-center gap-2 text-body-sm">
          <span className="text-slate-600">Trợ lý AI toàn nhóm</span>
          <Toggle checked={s.enabled} disabled={!isAdmin || saving} onChange={(v) => patch({ enabled: v }, v ? 'Đã bật Trợ lý AI' : 'Đã tắt Trợ lý AI')} label="Bật/tắt AI" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Lượt đã dùng" value={`${t.used}/${s.dailyLimit}`} sub="Hôm nay" icon="bolt" tone="purple">
          <Progress value={(t.used / Math.max(1, s.dailyLimit)) * 100} tone="bg-purple-500" className="mt-2" />
        </StatCard>
        <StatCard label="Token đã dùng" value={t.tokens >= 1000 ? `${(t.tokens / 1000).toFixed(1)}K` : t.tokens} sub="Vào + ra, hôm nay" icon="token" tone="blue" />
        <StatCard label="Độ trễ trung bình" value={`${(t.avgLatencyMs / 1000).toFixed(1)} giây`} sub="Các lượt thành công" icon="timer" tone="green" />
        <StatCard label="Tỉ lệ lỗi" value={`${t.total ? Math.round((t.errors / t.total) * 100) : 0}%`} sub={`${t.errors} lỗi hôm nay`} icon="error" tone="red" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <div className="card space-y-3 p-4">
            <p className="flex items-center gap-1.5 text-label-lg font-semibold text-slate-900">
              <Icon name="speed" size={18} className="text-blue-600" /> Hạn mức sử dụng
            </p>
            <label className="block">
              <span className="label">Số lượt tối đa mỗi ngày</span>
              <div className="flex gap-2">
                <input type="number" min="0" className="input" value={limit} disabled={!isAdmin} onChange={(e) => setLimit(e.target.value)} />
                <span className="flex items-center text-body-sm text-slate-500">lượt/ngày</span>
              </div>
            </label>
            <p className="text-label-md font-normal text-slate-400">Đặt lại lúc 00:00 mỗi ngày. Hết hạn mức thì các tính năng AI tạm dừng, CRUD vẫn hoạt động.</p>
            <p className="section-label pt-1">Bật/tắt theo tính năng</p>
            {FEATURES.map(([k, l]) => (
              <div key={k} className="flex items-center justify-between text-body-sm">
                <span className="text-slate-700">{l}</span>
                <Toggle checked={s.features[k] !== false} disabled={!isAdmin || saving} onChange={(v) => patch({ features: { [k]: v } })} label={l} />
              </div>
            ))}
          </div>
          <div className="card space-y-3 p-4">
            <p className="flex items-center gap-1.5 text-label-lg font-semibold text-slate-900">
              <Icon name="timer" size={18} className="text-blue-600" /> Xử lý lỗi & Timeout
            </p>
            <label className="block">
              <span className="label">Thời gian chờ tối đa</span>
              <div className="flex gap-2">
                <input type="number" min="5" max="120" className="input" value={timeout} disabled={!isAdmin} onChange={(e) => setTimeoutSec(e.target.value)} />
                <span className="flex items-center text-body-sm text-slate-500">giây</span>
              </div>
            </label>
            <div className="flex items-center justify-between text-body-sm">
              <span className="text-slate-700">Thử lại khi quá thời gian</span>
              <span className="chip border-slate-200 bg-slate-50 text-slate-600">Tối đa 1 lần (cố định)</span>
            </div>
            <Notice tone="info">Khi AI lỗi, các chức năng tạo/sửa công việc vẫn hoạt động bình thường.</Notice>
            {isAdmin && (
              <button className="btn-primary w-full" disabled={saving} onClick={() => patch({ dailyLimit: Number(limit), timeoutSec: Number(timeout) })}>
                {saving && <Spinner />}Lưu thay đổi
              </button>
            )}
          </div>
        </div>
        <div className="card min-w-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
            <p className="flex items-center gap-1.5 text-label-lg font-semibold text-slate-900">
              <Icon name="receipt_long" size={18} className="text-blue-600" /> Nhật ký gọi AI
            </p>
            {isAdmin && (
              <>
                <Select className="input ml-auto h-8 w-auto py-0 text-body-sm" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
                  <option value="">Tất cả trạng thái</option>
                  {Object.entries(STATUS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v[0]}
                      {k === 'retried_success' ? ' (thử lại)' : ''}
                    </option>
                  ))}
                </Select>
                <button className="btn-outline btn-sm" onClick={() => download(`/workspaces/${wsId}/ai/calls.csv`, 'nhat-ky-ai.csv')}>
                  <Icon name="download" size={16} /> Xuất CSV
                </button>
              </>
            )}
          </div>
          {!isAdmin ? (
            <p className="p-6 text-center text-body-sm text-slate-500">Chỉ Owner/Admin xem được nhật ký gọi AI.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-slate-100">
                  <tr>
                    {['Thời gian', 'Người dùng', 'Tính năng', 'Model', 'Token', 'Độ trễ', 'Trạng thái'].map((h) => (
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
                        <td className="table-td whitespace-nowrap">{FEATURE_LABEL[c.feature]}</td>
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
