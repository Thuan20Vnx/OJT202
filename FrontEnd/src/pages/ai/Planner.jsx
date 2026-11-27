import { t as tr, useI18n } from '../../lib/i18n.js';
import { useState } from 'react';
import { Dropdown, ErrorBox, Field, Icon, Notice, Spinner } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useLoad, useToast } from '../../lib/app.jsx';
import { isoDate, timeAgo } from '../../lib/format.js';
import { useLatestRequest, useProjectInfo } from '../../lib/hooks.js';
import { AgentBar, Info, RunButton, useAgentRun, useCodeSource } from './AgentRun.jsx';
import DraftItems from './DraftItems.jsx';

const STATUS_CHIP = {
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  shared: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  discarded: 'border-slate-200 bg-slate-50 text-slate-500',
  draft: 'border-amber-200 bg-amber-50 text-amber-700',
};

/** Khung lịch sử dạng thẻ, vẫn dùng ở màn Báo cáo tiến độ. */
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
              <span className={`chip shrink-0 ${STATUS_CHIP[d.status] || STATUS_CHIP.draft}`}>
                {{ approved: tr("Đã duyệt"), shared: tr("Đã chia sẻ"), discarded: tr("Đã hủy"), draft: tr("Nháp") }[d.status]}
              </span>
            </div>
            <p className="text-label-md font-normal text-slate-400">
              {timeAgo(d.createdAt)}
              {d.count != null && tr(" · {0} việc", [d.count])}
              {d.agent && tr(" · từ {0}", [d.agent])}
            </p>
          </button>
        ))}
        {!loading && !error && !items.length && <p className="text-body-sm text-slate-400">{empty}</p>}
      </div>
    </div>
  );
}

/** Nút "Lịch sử (n)" ở góc khung kết quả: mở danh sách bản nháp gần đây. */
export function HistoryButton({ items, onOpen, activeId, error, loading, onRetry, empty = tr("Chưa có lịch sử") }) {
  useI18n();
  return (
    <Dropdown
      width="w-80"
      trigger={(
        <button type="button" className="btn-outline btn-sm">
          <Icon name="history" size={16} />{tr(" Lịch sử ({0})", [items.length])}<Icon name="arrow_drop_down" size={18} />
        </button>
      )}
    >
      <div className="max-h-80 space-y-1 overflow-y-auto">
        <ErrorBox error={error} onRetry={onRetry} />
        {loading && !items.length && <Spinner />}
        {items.map((d) => (
          <button
            key={d._id}
            onClick={() => onOpen(d._id)}
            className={`w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-slate-50 ${activeId === d._id ? 'bg-blue-50' : ''}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="line-clamp-2 text-body-sm font-medium text-slate-800">{d.title}</span>
              <span className={`chip shrink-0 ${STATUS_CHIP[d.status] || STATUS_CHIP.draft}`}>
                {{ approved: tr("Đã duyệt"), shared: tr("Đã chia sẻ"), discarded: tr("Đã hủy"), draft: tr("Nháp") }[d.status]}
              </span>
            </div>
            <p className="text-label-md font-normal text-slate-400">
              {timeAgo(d.createdAt)}
              {d.count != null && tr(" · {0} việc", [d.count])}
              {d.agent && tr(" · từ {0}", [d.agent])}
            </p>
          </button>
        ))}
        {!loading && !error && !items.length && <p className="px-2.5 py-2 text-body-sm text-slate-400">{empty}</p>}
      </div>
    </Dropdown>
  );
}

/** Khung kết quả khi chưa có gì: tiêu đề, nút Lịch sử ở góc và lời mời ở giữa. */
export function EmptyResult({ title, action, icon, heading, children }) {
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-label-lg font-semibold text-slate-900">{title}</p>
        {action}
      </div>
      <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-50 text-purple-500">
          <Icon name={icon} size={26} />
        </span>
        <p className="text-headline-sm text-slate-900">{heading}</p>
        <p className="mt-1 max-w-md text-body-sm text-slate-500">{children}</p>
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
  const agentRun = useAgentRun({ project, onDone: (job) => open(job.resultId) });
  const code = useCodeSource(project);

  const input = { goal: f.goal, deadline: f.deadline || null, people: f.people ? Number(f.people) : null, maxHours: f.maxHours ? Number(f.maxHours) : null, source: code.source };
  const ready = f.goal.trim().length >= 5 && canWrite;
  const historyButton = <HistoryButton items={history.data?.drafts || []} error={history.error} loading={history.loading} onRetry={history.reload} onOpen={open} activeId={draft?._id} />;

  return (
    <div className="space-y-4">
      <AgentBar run={agentRun} code={code} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
        <div className="min-w-0 space-y-4">
          <div className="card space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-x-1.5">
              <span className="flex items-center gap-1.5 text-label-lg font-semibold text-slate-900">
                <Icon name="flag" size={18} className="text-blue-600" />{tr(" Mục tiêu")}</span>
              <Info>{tr("AI phân rã mục tiêu thành 5–15 công việc có mô tả, tiêu chí nghiệm thu và ước lượng giờ. Nếu thiếu ngày, AI không tự suy diễn hạn chót.")}</Info>
              {info?.project?.sprint?.name && <span className="ml-auto text-label-md font-normal text-slate-400">{info.project.sprint.name}</span>}
            </div>
            <textarea
              aria-label={tr("Mục tiêu kế hoạch")}
              className="textarea min-h-[96px]"
              value={f.goal}
              onChange={(e) => setF({ ...f, goal: e.target.value })}
              placeholder={tr("Ví dụ: Hoàn thiện luồng thanh toán VNPay & Momo cho bản Beta v1.2")}
            />
            <div className="grid grid-cols-[1.5fr_1fr_1fr] gap-2">
              <Field label={tr("Hạn")}>
                <input type="date" aria-label={tr("Hạn hoàn thành")} className="input px-2" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} />
              </Field>
              <Field label={tr("Người")}>
                <input type="number" min="1" aria-label={tr("Số người tham gia")} className="input" value={f.people} onChange={(e) => setF({ ...f, people: e.target.value })} />
              </Field>
              <Field label={tr("Giờ")}>
                <input type="number" min="1" aria-label={tr("Tổng giờ tối đa")} className="input" value={f.maxHours} onChange={(e) => setF({ ...f, maxHours: e.target.value })} />
              </Field>
            </div>
            <RunButton
              run={agentRun}
              label={tr("Lập kế hoạch")}
              onAgent={() => agentRun.start('plan', input)}
              onTeam={generate}
              busy={busy}
              disabled={!ready}
              teamDisabled={disabled}
            />
            {!canWrite && <p className="text-label-md font-normal text-slate-500">{tr('Chỉ PM của dự án đang hoạt động được lập và duyệt kế hoạch.')}</p>}
          </div>
          {error && <Notice tone={error.status === 429 ? 'warn' : 'danger'}>{error.message}</Notice>}
        </div>
        <div className="min-w-0">
          {draft ? (
            <>
              <div className="mb-3 flex justify-end">{historyButton}</div>
              <DraftItems
                key={draft._id}
                draft={draft}
                canManage={canWrite}
                setDraft={setDraft}
                members={(info?.project?.members || []).filter((m) => m.role !== 'viewer' && m.projectRole !== 'viewer')}
                title={tr("Kế hoạch nháp")}
                onRegenerate={generate}
                regenerating={busy}
                onApproved={() => history.reload()}
              />
            </>
          ) : (
            <EmptyResult title={tr("Kế hoạch nháp")} action={historyButton} icon="auto_awesome" heading={tr("Nhập mục tiêu để AI phân rã thành 5–15 công việc")}>
              {tr("Mỗi việc có mô tả, tiêu chí nghiệm thu, ước lượng giờ và gợi ý người nhận. Bạn sửa, chọn rồi bấm duyệt thì mới tạo vào dự án.")}
            </EmptyResult>
          )}
        </div>
      </div>
    </div>
  );
}
