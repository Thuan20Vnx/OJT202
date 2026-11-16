import { t as tr, useI18n } from '../../lib/i18n.js';
import { useState } from 'react';
import { Field, Icon, Notice } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useLoad } from '../../lib/app.jsx';
import { useLatestRequest, useProjectInfo } from '../../lib/hooks.js';
import { AgentBar, Info, RunButton, useAgentRun } from './AgentRun.jsx';
import DraftItems from './DraftItems.jsx';
import { EmptyResult, HistoryButton } from './Planner.jsx';

const SAMPLE = tr("Thuận: mình sẽ xong API WebSocket trước thứ 6\nMai Anh: cần ai đó kiểm thử bảo mật thanh toán\nNhư: cập nhật wireframe Thông báo và Activity Log\nHiệp: mình sẽ cấu hình xong WSS vào ngày mai", []);

export default function Meeting({ project, onUsage, disabled }) {
  useI18n();
  const info = useProjectInfo(project._id);
  const [f, setF] = useState({ title: tr("Họp {0} – {1}", [info?.project?.sprint?.name || tr("nhóm"), new Date().toLocaleDateString('vi-VN')]), text: '' });
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const beginRequest = useLatestRequest();
  const sourceChanged = draft?.status === 'draft' && (f.text.trim() !== draft.input?.text || f.title.trim() !== draft.input?.title);
  const history = useLoad(() => api.get(`/projects/${project._id}/ai/drafts?type=meeting`), [project._id, draft?._id, draft?.status]);

  const extract = async () => {
    const current = beginRequest();
    setBusy(true);
    setError(null);
    try {
      const d = await api.post(`/projects/${project._id}/ai/meeting`, f);
      if (current()) setDraft(d.draft);
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
    setError(null);
    try {
      const d = await api.get(`/ai/drafts/${id}`);
      if (!current()) return;
      setDraft(d.draft);
      setF({ title: d.draft.input?.title || '', text: d.draft.input?.text || '' });
    } catch (e) {
      if (current()) setError(e);
    } finally {
      if (current()) setBusy(false);
    }
  };

  const agentRun = useAgentRun({ project, onDone: (job) => open(job.resultId) });

  const canManage = !!info?.access?.canManage;
  const ready = !!f.title.trim() && f.text.trim().length >= 10 && canManage;
  const historyButton = <HistoryButton items={history.data?.drafts || []} error={history.error} loading={history.loading} onRetry={history.reload} onOpen={open} activeId={draft?._id} />;

  return (
    <div className="space-y-4">
      <AgentBar run={agentRun} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
        <div className="min-w-0 space-y-4">
          <div className="card space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-x-1.5">
              <span className="flex items-center gap-1.5 text-label-lg font-semibold text-slate-900">
                <Icon name="groups" size={18} className="text-blue-600" />{tr(" Biên bản họp")}</span>
              <Info>{tr("Mỗi việc kèm trích đoạn gốc từ biên bản. Không rõ người hoặc hạn thì AI sẽ để trống, không tự đoán.")}</Info>
            </div>
            <Field label={tr("Tên cuộc họp")}>
              <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            </Field>
            <Field label={tr("Nội dung")}>
              <textarea aria-label={tr("Biên bản / ghi chú họp (dán văn bản)")} className="textarea min-h-[180px] font-mono text-body-sm" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder={SAMPLE} />
            </Field>
            {!f.text && (
              <button className="text-label-md text-blue-600 hover:underline" onClick={() => setF({ ...f, text: SAMPLE })}>{tr("Dùng biên bản mẫu")}</button>
            )}
            <RunButton
              run={agentRun}
              label={tr("Tách việc")}
              icon="checklist"
              onAgent={() => agentRun.start('meeting', { title: f.title, text: f.text })}
              onTeam={extract}
              busy={busy}
              disabled={!ready}
              teamDisabled={disabled}
            />
            {!canManage && <p className="text-label-md font-normal text-slate-500">{tr('Chỉ PM của dự án đang hoạt động được tạo và duyệt việc từ biên bản.')}</p>}
          </div>
          {error && <Notice tone={error.status === 429 ? 'warn' : 'danger'}>{error.message}</Notice>}
        </div>
        <div className="min-w-0 space-y-3">
          {sourceChanged && <Notice tone="warn">{tr("Biên bản đã thay đổi. Hãy trích lại công việc hoặc khôi phục nội dung gốc trước khi duyệt.")}</Notice>}
          {draft ? (
            <>
              <div className="flex justify-end">{historyButton}</div>
              <DraftItems
                key={draft._id}
                draft={draft}
                canManage={canManage && !sourceChanged}
                setDraft={setDraft}
                members={(info?.project?.members || []).filter((m) => m.role !== 'viewer' && m.projectRole !== 'viewer')}
                title={tr("Action items nháp")}
                showExcerpt
                onRegenerate={extract}
                regenerating={busy}
                onApproved={() => history.reload()}
              />
            </>
          ) : (
            <EmptyResult title={tr("Việc tách từ biên bản")} action={historyButton} icon="record_voice_over" heading={tr("Dán biên bản họp để chuyển thành việc cần làm")}>
              {tr("Mỗi action item kèm trích đoạn gốc từ biên bản. Xem, sửa và duyệt trước khi tạo công việc.")}
            </EmptyResult>
          )}
        </div>
      </div>
    </div>
  );
}
