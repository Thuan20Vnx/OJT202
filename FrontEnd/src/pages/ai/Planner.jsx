import { t as tr, useI18n } from '../../lib/i18n.js';
import { useState } from 'react';
import { ErrorBox, Field, Icon, Notice, Spinner } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useLoad, useToast } from '../../lib/app.jsx';
import { isoDate, timeAgo } from '../../lib/format.js';
import { useLatestRequest, useProjectInfo } from '../../lib/hooks.js';
import DraftItems from './DraftItems.jsx';

export function History({ items, onOpen, activeId, error, loading, onRetry, empty = tr("Chưa có lịch sử") }) {
  useI18n();
  return (
    <div className="card p-4">
      <p className="section-label mb-2 flex items-center justify-between">{tr("Lịch sử gần đây ")}<Icon name="history" size={16} />
      </p>
      <ErrorBox error={error} onRetry={onRetry} />
      {loading && !items.length && <Spinner />}
      <div className="space-y-1.5">
        {items.map((d) => (
          <button
            key={d._id}
            onClick={() => onOpen(d._id)}
            className={`w-full rounded-lg border px-3 py-2 text-left transition-colors hover:bg-slate-50 ${activeId === d._id ? 'border-blue-300 bg-blue-50/50' : 'border-slate-100'}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="line-clamp-2 text-body-sm font-medium text-slate-800">{d.title}</span>
              <span
                className={`chip shrink-0 ${d.status === 'approved' || d.status === 'shared' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : d.status === 'discarded' ? 'border-slate-200 bg-slate-50 text-slate-500' : 'border-amber-200 bg-amber-50 text-amber-700'}`}
              >
                {{ approved: tr("Đã duyệt"), shared: tr("Đã chia sẻ"), discarded: tr("Đã hủy"), draft: tr("Nháp") }[d.status]}
              </span>
            </div>
            <p className="text-label-md font-normal text-slate-400">
              {timeAgo(d.createdAt)}
              {d.count != null && tr(" · {0} việc", [d.count])}
            </p>
          </button>
        ))}
        {!loading && !error && !items.length && <p className="text-body-sm text-slate-400">{empty}</p>}
      </div>
    </div>
  );
}

export default function Planner({ project, onUsage, disabled }) {
  useI18n();
  const toast = useToast();
  const info = useProjectInfo(project._id);
  const [f, setF] = useState({ goal: '', deadline: '', people: 3, maxHours: 60 });
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const beginRequest = useLatestRequest();
  const history = useLoad(() => api.get(`/projects/${project._id}/ai/drafts?type=plan`), [project._id, draft?._id, draft?.status]);

  const generate = async () => {
    const current = beginRequest();
    setBusy(true);
    setError(null);
    try {
      const d = await api.post(`/projects/${project._id}/ai/plan`, {
        goal: f.goal,
        deadline: f.deadline || null,
        people: f.people ? Number(f.people) : null,
        maxHours: f.maxHours ? Number(f.maxHours) : null,
      });
      if (current()) setDraft(d.draft);
      onUsage();
    } catch (e) {
      if (current()) setError(e);
      onUsage();
    } finally {
      if (current()) setBusy(false);
    }
  };
  const open = async (id) => {
    const current = beginRequest();
    setBusy(true);
    setError(null);
    try {
      const d = await api.get(`/ai/drafts/${id}`);
      if (!current()) return;
      setDraft(d.draft);
      const input = d.draft.input || {};
      setF({ goal: input.goal || '', deadline: input.deadline ? isoDate(input.deadline) : '', people: input.people ?? '', maxHours: input.maxHours ?? '' });
    } catch (e) {
      if (current()) setError(e);
    } finally {
      if (current()) setBusy(false);
    }
  };
  const canWrite = !!info?.access?.canManage;

  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <div className="space-y-4">
        <div className="card space-y-4 p-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-label-lg font-semibold text-slate-900">
              <Icon name="flag" size={18} className="text-blue-600" />{tr(" Mục tiêu kế hoạch")}</span>
            {info?.project?.sprint?.name && <span className="text-label-md font-normal text-slate-400">{info.project.sprint.name}</span>}
          </div>
          <textarea
            aria-label={tr("Mục tiêu kế hoạch")}
            className="textarea min-h-[96px]"
            value={f.goal}
            onChange={(e) => setF({ ...f, goal: e.target.value })}
            placeholder={tr("Ví dụ: Hoàn thiện luồng thanh toán VNPay & Momo cho bản Beta v1.2")}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label={tr("Hạn hoàn thành")}>
              <input type="date" className="input" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} />
            </Field>
            <Field label={tr("Số người tham gia")}>
              <input type="number" min="1" className="input" value={f.people} onChange={(e) => setF({ ...f, people: e.target.value })} />
            </Field>
            <Field label={tr("Tổng giờ tối đa")}>
              <input type="number" min="1" className="input" value={f.maxHours} onChange={(e) => setF({ ...f, maxHours: e.target.value })} />
            </Field>
            <Field label={tr("Dự án áp dụng")}>
              <input className="input" value={project.name} disabled />
            </Field>
          </div>
          <Notice tone="warn">{tr("Nếu thiếu ngày, AI không tự suy diễn hạn chót.")}</Notice>
          <button className="btn-primary h-10 w-full" onClick={generate} disabled={busy || f.goal.trim().length < 5 || disabled || !canWrite}>
            {busy ? <Spinner /> : <Icon name="auto_awesome" size={18} />}{tr("Tạo kế hoạch nháp")}</button>
          {!canWrite && <p className="text-label-md font-normal text-slate-500">{tr("Chỉ PM, Owner hoặc Admin của dự án đang hoạt động được lập và duyệt kế hoạch.")}</p>}
        </div>
        {error && <Notice tone={error.status === 429 ? 'warn' : 'danger'}>{error.message}</Notice>}
        <History items={history.data?.drafts || []} error={history.error} loading={history.loading} onRetry={history.reload} onOpen={open} activeId={draft?._id} />
      </div>
      <div className="min-w-0">
        {draft ? (
          <DraftItems
            key={draft._id}
            draft={draft}
            canManage={canWrite}
            setDraft={setDraft}
            members={info?.project?.members || []}
            title={tr("Kế hoạch nháp")}
            onRegenerate={generate}
            regenerating={busy}
            onApproved={() => history.reload()}
          />
        ) : (
          <div className="card flex flex-col items-center justify-center px-6 py-16 text-center">
            <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-50 text-purple-500">
              <Icon name="auto_awesome" size={30} />
            </span>
            <p className="text-headline-sm text-slate-900">{tr("Nhập mục tiêu để AI phân rã thành 5–15 công việc")}</p>
            <p className="mt-1 max-w-md text-body-sm text-slate-500">{tr("Mỗi việc có mô tả, tiêu chí nghiệm thu, ước lượng giờ và gợi ý người nhận. Bạn sửa, chọn rồi bấm duyệt thì mới tạo vào dự án.")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
