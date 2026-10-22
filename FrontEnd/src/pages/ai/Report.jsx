import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Field, Icon, Notice, Select, Spinner } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useApp, useLoad, useToast } from '../../lib/app.jsx';
import { isoDate } from '../../lib/format.js';
import { History } from './Planner.jsx';

const DAY = 86400000;

export default function Report({ project, onUsage, disabled }) {
  const toast = useToast();
  const { me } = useApp();
  const navigate = useNavigate();
  const [f, setF] = useState({ from: isoDate(new Date(Date.now() - 6 * DAY)), to: isoDate(new Date()), template: 'week' });
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [text, setText] = useState('');
  const history = useLoad(() => api.get(`/projects/${project._id}/ai/reports`), [project._id, report?._id, report?.status]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await api.post(`/projects/${project._id}/ai/reports`, f);
      setReport(d.report);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      onUsage();
    }
  };
  const open = async (id) => setReport((await api.get(`/ai/reports/${id}`)).report);
  const save = async (body, msg) => {
    setSaving(true);
    try {
      const d = await api.patch(`/ai/reports/${report._id}`, body);
      setReport(d.report);
      if (msg) toast(msg);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  const saveSection = async (key) => {
    await save({ sections: [{ key, body: text }] });
    setEditing(null);
  };
  const exportTxt = () => {
    const body = `${report.title}\n\n${report.sections.map((s) => `## ${s.title}\n${s.body}`).join('\n\n')}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }));
    a.download = `${report.title}.txt`;
    a.click();
  };
  const s = report?.stats;
  const mine = report && (report.user?._id || report.user) === me?._id;

  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <div className="space-y-4">
        <div className="card space-y-4 p-4">
          <span className="flex items-center gap-1.5 text-label-lg font-semibold text-slate-900">
            <Icon name="tune" size={18} className="text-blue-600" /> Cấu hình báo cáo
          </span>
          <Field label="Dự án">
            <input className="input" value={project.name} disabled />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Từ ngày">
              <input type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
            </Field>
            <Field label="Đến ngày">
              <input type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
            </Field>
          </div>
          <Field label="Mẫu báo cáo">
            <Select className="input" value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })}>
              <option value="week">Báo cáo tuần</option>
              <option value="sprint">Báo cáo Sprint</option>
              <option value="lecturer">Báo cáo cho giảng viên</option>
            </Select>
          </Field>
          <Notice tone="warn">Số liệu được tính trực tiếp từ dữ liệu dự án, AI chỉ diễn giải.</Notice>
          <button className="btn-primary h-10 w-full" onClick={generate} disabled={busy || disabled}>
            {busy ? <Spinner /> : <Icon name="auto_awesome" size={18} />}
            Tạo báo cáo nháp
          </button>
        </div>
        {error && <Notice tone={error.status === 429 ? 'warn' : 'danger'}>{error.message}</Notice>}
        {s && (
          <div className="card p-4">
            <p className="mb-3 flex items-center justify-between text-label-sm uppercase tracking-wider text-slate-500">
              Số liệu kiểm chứng <span className="chip border-emerald-200 bg-emerald-50 normal-case tracking-normal text-emerald-700">Từ DB</span>
            </p>
            {[
              ['Hoàn thành', `${s.done} việc`, 'text-emerald-600'],
              ['Quá hạn', `${s.overdue} việc`, 'text-rose-600'],
              ['Bị chặn', `${s.blocked} việc`, 'text-amber-600'],
              ['Tiến độ dự án', `${s.progressPct}%`, 'text-blue-700'],
            ].map(([k, v, c]) => (
              <div key={k} className="flex items-center justify-between border-b border-slate-100 py-2 text-body-sm last:border-0">
                <span className="flex items-center gap-2 text-slate-600">
                  <Icon name="verified" size={16} className="text-emerald-500" /> {k}
                </span>
                <b className={c}>{v}</b>
              </div>
            ))}
            <p className="mt-2 text-label-md font-normal text-slate-400">Số liệu tính trực tiếp từ dữ liệu, không do AI ước đoán.</p>
          </div>
        )}
        <History items={(history.data?.reports || []).map((r) => ({ ...r, count: undefined }))} onOpen={open} activeId={report?._id} empty="Chưa có báo cáo đã lưu" />
      </div>

      <div className="min-w-0">
        {!report ? (
          <div className="card flex flex-col items-center justify-center px-6 py-16 text-center">
            <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-50 text-purple-500">
              <Icon name="summarize" size={30} />
            </span>
            <p className="text-headline-sm text-slate-900">Chọn khoảng ngày và tạo báo cáo tiến độ nháp</p>
            <p className="mt-1 max-w-md text-body-sm text-slate-500">Báo cáo tổng hợp việc đã xong, đang chậm và bị chặn – mỗi nhận định kèm liên kết tới công việc nguồn. Bạn sửa trước khi lưu và chia sẻ nội bộ.</p>
          </div>
        ) : (
          <div className="pb-24">
            <div className="card mb-3 flex flex-wrap items-center gap-3 px-4 py-3">
              <input className="min-w-0 flex-1 border-0 bg-transparent p-0 text-headline-sm text-slate-900 focus:ring-0" defaultValue={report.title} onBlur={(e) => e.target.value !== report.title && save({ title: e.target.value })} />
              <span className={`chip ${report.status === 'shared' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                {report.status === 'shared' ? 'Đã chia sẻ nội bộ' : '● Nháp – chưa chia sẻ'}
              </span>
              <span className="text-label-md font-normal text-slate-500">Dựa trên {report.sourceTasks?.length || 0} công việc nguồn</span>
            </div>
            <div className="space-y-3">
              {report.sections.map((sec) => (
                <div key={sec.key} className={`card p-4 ${sec.key === 'late' ? 'border-l-4 border-l-rose-400' : sec.key === 'blocked' ? 'border-l-4 border-l-amber-400' : sec.key === 'done' ? 'border-l-4 border-l-emerald-400' : ''}`}>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-label-lg font-semibold text-slate-900">
                      {sec.title}
                      {sec.aiSuggested && <span className="chip border-purple-200 bg-purple-50 text-purple-700">Gợi ý AI</span>}
                    </h3>
                    {editing !== sec.key && (
                      <button className="icon-btn h-7 w-7" onClick={() => (setEditing(sec.key), setText(sec.body))} title="Sửa">
                        <Icon name="edit" size={16} />
                      </button>
                    )}
                  </div>
                  {editing === sec.key ? (
                    <>
                      <textarea className="textarea min-h-[120px]" value={text} onChange={(e) => setText(e.target.value)} />
                      <div className="mt-2 flex justify-end gap-2">
                        <button className="btn-outline btn-sm" onClick={() => setEditing(null)}>
                          Hủy
                        </button>
                        <button className="btn-primary btn-sm" onClick={() => saveSection(sec.key)} disabled={saving}>
                          Lưu sửa
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="whitespace-pre-wrap text-body-sm text-slate-700">{sec.body}</p>
                  )}
                  {sec.refs?.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {sec.refs.map((t) => (
                        <button key={t._id} onClick={() => navigate({ search: `?task=${t._id}` })} className="chip border-slate-200 bg-white font-mono text-blue-700 hover:border-blue-300" title={t.title}>
                          {t.key}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="sticky bottom-0 mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-pop">
              <span className="mr-auto flex items-center gap-1.5 text-label-md font-normal text-slate-500">
                <Icon name="link" size={14} /> Mỗi nhận định đều có liên kết tới công việc nguồn.
              </span>
              <button className="btn-outline" onClick={exportTxt}>
                <Icon name="download" size={16} /> Xuất tệp
              </button>
              <button className="btn-outline" onClick={generate} disabled={busy}>
                <Icon name="refresh" size={16} /> Tạo lại
              </button>
              {report.status !== 'shared' && mine && (
                <button className="btn-primary" onClick={() => save({ share: true }, 'Đã lưu & chia sẻ báo cáo trong dự án')} disabled={saving}>
                  {saving ? <Spinner /> : <Icon name="share" size={16} />} Lưu & chia sẻ nội bộ
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
