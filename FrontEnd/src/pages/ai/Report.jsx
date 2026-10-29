import { t as tr, useI18n } from '../../lib/i18n.js';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Field, Icon, Notice, Select, Spinner } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useApp, useLoad, useToast } from '../../lib/app.jsx';
import { dates } from '../../lib/dates.js';
import { History } from './Planner.jsx';
import { useLatestRequest, useProjectInfo } from '../../lib/hooks.js';

const DAY = 86400000;

export default function Report({ project, onUsage, disabled }) {
  useI18n();
  const toast = useToast();
  const { me } = useApp();
  const info = useProjectInfo(project._id);
  const canManage = !!info?.access?.canManage;
  const navigate = useNavigate();
  const [f, setF] = useState({ from: dates.dateKey(new Date(Date.now() - 6 * DAY)), to: dates.dateKey(new Date()), template: 'week' });
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [text, setText] = useState('');
  const beginRequest = useLatestRequest();
  const history = useLoad(() => api.get(`/projects/${project._id}/ai/reports`), [project._id, report?._id, report?.status]);

  const generate = async () => {
    const current = beginRequest();
    setBusy(true);
    setSaving(false);
    setError(null);
    try {
      const d = await api.post(`/projects/${project._id}/ai/reports`, f);
      if (current()) { setReport(d.report); setEditing(null); }
    } catch (e) {
      if (current()) setError(e);
    } finally {
      if (current()) setBusy(false);
      onUsage();
    }
  };
  const open = async (id) => {
    const current = beginRequest();
    setBusy(true);
    setSaving(false);
    setError(null);
    try {
      const d = await api.get(`/ai/reports/${id}`);
      if (current()) { setReport(d.report); setEditing(null); }
    } catch (e) {
      if (current()) setError(e);
    } finally {
      if (current()) setBusy(false);
    }
  };
  const save = async (body, msg) => {
    if (busy || saving) return false;
    const current = beginRequest();
    setSaving(true);
    try {
      const d = await api.patch(`/ai/reports/${report._id}`, body);
      if (!current()) return false;
      setReport(d.report);
      if (msg) toast(msg);
      return true;
    } catch (e) {
      if (current()) toast(e.message, 'error');
      return false;
    } finally {
      if (current()) setSaving(false);
    }
  };
  const saveSection = async (key) => {
    if (await save({ sections: [{ key, body: text }] })) setEditing(null);
  };
  const exportTxt = () => {
    const body = `${report.title}\n\n${report.sections.map((s) => `## ${s.title}\n${s.body}`).join('\n\n')}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }));
    a.download = `${report.title}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const s = report?.stats;
  const mine = report && (report.user?._id || report.user) === me?._id;

  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <div className="space-y-4">
        <div className="card space-y-4 p-4">
          <span className="flex items-center gap-1.5 text-label-lg font-semibold text-slate-900">
            <Icon name="tune" size={18} className="text-blue-600" />{tr(" Cấu hình báo cáo")}</span>
          <Field label={tr("Dự án")}>
            <input className="input" value={project.name} disabled />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={tr("Từ ngày")}>
              <input type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
            </Field>
            <Field label={tr("Đến ngày")} hint={tr("Tính hết ngày theo giờ Việt Nam (UTC+7)")}>
              <input type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
            </Field>
          </div>
          <Field label={tr("Mẫu báo cáo")}>
            <Select className="input" value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })}>
              <option value="week">{tr("Báo cáo tuần")}</option>
              <option value="sprint">{tr("Báo cáo Sprint")}</option>
              <option value="lecturer">{tr("Báo cáo cho giảng viên")}</option>
            </Select>
          </Field>
          <Notice tone="warn">{tr("Số liệu được tính trực tiếp từ dữ liệu dự án, AI chỉ diễn giải.")}</Notice>
          {!canManage && <Notice>{tr("Chỉ PM, Owner hoặc Admin của dự án đang hoạt động được tạo, sửa và chia sẻ báo cáo.")}</Notice>}
          <button className="btn-primary h-10 w-full" onClick={generate} disabled={busy || disabled || !canManage}>
            {busy ? <Spinner /> : <Icon name="auto_awesome" size={18} />}{tr("Tạo báo cáo nháp")}</button>
        </div>
        {error && <Notice tone={error.status === 429 ? 'warn' : 'danger'}>{error.message}</Notice>}
        {s && (
          <div className="card p-4">
            <p className="mb-3 flex items-center justify-between text-label-sm uppercase tracking-wider text-slate-500">{tr("Số liệu kiểm chứng ")}<span className="chip border-emerald-200 bg-emerald-50 normal-case tracking-normal text-emerald-700">{tr("Từ DB")}</span>
            </p>
            {[
              [tr("Hoàn thành"), tr("{0} việc", [s.done]), 'text-emerald-600'],
              [tr("Quá hạn"), tr("{0} việc", [s.overdue]), 'text-rose-600'],
              [tr("Bị chặn"), tr("{0} việc", [s.blocked]), 'text-amber-600'],
              [tr("Tiến độ dự án"), `${s.progressPct}%`, 'text-blue-700'],
            ].map(([k, v, c]) => (
              <div key={k} className="flex items-center justify-between border-b border-slate-100 py-2 text-body-sm last:border-0">
                <span className="flex items-center gap-2 text-slate-600">
                  <Icon name="verified" size={16} className="text-emerald-500" /> {k}
                </span>
                <b className={c}>{v}</b>
              </div>
            ))}
            <p className="mt-2 text-label-md font-normal text-slate-400">{tr("Số liệu tính trực tiếp từ dữ liệu, không do AI ước đoán.")}</p>
          </div>
        )}
        <History items={(history.data?.reports || []).map((r) => ({ ...r, count: undefined }))} error={history.error} loading={history.loading} onRetry={history.reload} onOpen={open} activeId={report?._id} empty={tr("Chưa có báo cáo đã lưu")} />
      </div>

      <div className="min-w-0">
        {!report ? (
          <div className="card flex flex-col items-center justify-center px-6 py-16 text-center">
            <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-50 text-purple-500">
              <Icon name="summarize" size={30} />
            </span>
            <p className="text-headline-sm text-slate-900">{tr("Chọn khoảng ngày và tạo báo cáo tiến độ nháp")}</p>
            <p className="mt-1 max-w-md text-body-sm text-slate-500">{tr("Báo cáo tổng hợp việc đã xong, đang chậm và bị chặn – mỗi nhận định kèm liên kết tới công việc nguồn. Bạn sửa trước khi lưu và chia sẻ nội bộ.")}</p>
          </div>
        ) : (
          <div className="pb-24">
            <Notice tone="warn" className="mb-3">{tr("Báo cáo lưu số liệu tại thời điểm tạo.")}{' '}
              {report.sourceState === 'changed'
                ? tr("Nguồn dự án đã thay đổi; hãy tạo báo cáo mới trước khi sử dụng số liệu hiện tại.")
                : report.sourceState === 'unknown'
                  ? tr("Bản cũ chưa có thông tin phiên bản nguồn.")
                  : tr("Số liệu quá hạn có thể thay đổi theo thời gian.")}{' '}
              {report.missingSources > 0 ? tr("{0} công việc nguồn đã bị xóa.", [report.missingSources]) : ''}
            </Notice>
            <div className="card mb-3 flex flex-wrap items-center gap-3 px-4 py-3">
              <input
                key={report._id}
                readOnly={!canManage || !mine || busy || saving}
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-headline-sm text-slate-900 focus:ring-0"
                defaultValue={report.title}
                onBlur={(e) => canManage && mine && e.target.value !== report.title && save({ title: e.target.value })}
              />
              <span className={`chip ${report.status === 'shared' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                {report.status === 'shared' ? tr("Đã chia sẻ nội bộ") : tr("● Nháp – chưa chia sẻ")}
              </span>
              <span className="text-label-md font-normal text-slate-500">{tr("Dựa trên ")}{report.sourceTasks?.length || 0}{tr(" công việc nguồn")}</span>
            </div>
            <div className="space-y-3">
              {report.sections.map((sec) => (
                <div
                  key={sec.key}
                  className={`card p-4 ${sec.key === 'late' ? 'border-l-4 border-l-rose-400' : sec.key === 'blocked' ? 'border-l-4 border-l-amber-400' : sec.key === 'done' ? 'border-l-4 border-l-emerald-400' : ''}`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-label-lg font-semibold text-slate-900">
                      {sec.title}
                      {sec.aiSuggested && <span className="chip border-purple-200 bg-purple-50 text-purple-700">{tr("Gợi ý AI")}</span>}
                    </h3>
                    {canManage && mine && editing !== sec.key && (
                      <button className="icon-btn h-7 w-7" disabled={busy || saving} onClick={() => (setEditing(sec.key), setText(sec.body))} title={tr("Sửa")}>
                        <Icon name="edit" size={16} />
                      </button>
                    )}
                  </div>
                  {editing === sec.key ? (
                    <>
                      <textarea className="textarea min-h-[120px]" disabled={busy || saving} value={text} onChange={(e) => setText(e.target.value)} />
                      <div className="mt-2 flex justify-end gap-2">
                        <button className="btn-outline btn-sm" disabled={saving} onClick={() => setEditing(null)}>{tr("Hủy")}</button>
                        <button className="btn-primary btn-sm" onClick={() => saveSection(sec.key)} disabled={saving || busy}>{tr("Lưu sửa")}</button>
                      </div>
                    </>
                  ) : (
                    <p className="whitespace-pre-wrap text-body-sm text-slate-700">{sec.body}</p>
                  )}
                  {sec.refs?.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {sec.refs.map((t) => (
                        <button
                          key={t._id}
                          onClick={() => navigate({ search: `?task=${t._id}` })}
                          className="chip border-slate-200 bg-white font-mono text-blue-700 hover:border-blue-300"
                          title={t.title}
                        >
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
                <Icon name="link" size={14} />{tr(" Mỗi nhận định đều có liên kết tới công việc nguồn.")}</span>
              <button className="btn-outline" onClick={exportTxt}>
                <Icon name="download" size={16} />{tr(" Xuất tệp")}</button>
              <button className="btn-outline" onClick={generate} disabled={busy || disabled || !canManage}>
                <Icon name="refresh" size={16} />{tr(" Tạo lại")}</button>
              {report.status !== 'shared' && mine && canManage && (
                <button className="btn-primary" onClick={() => save({ share: true }, tr("Đã lưu & chia sẻ báo cáo trong dự án"))} disabled={saving || busy}>
                  {saving ? <Spinner /> : <Icon name="share" size={16} />}{tr(" Lưu & chia sẻ nội bộ")}</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
