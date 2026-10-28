import { useState } from 'react';
import { Field, Icon, Notice, Spinner } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useLoad } from '../../lib/app.jsx';
import { useLatestRequest, useProjectInfo } from '../../lib/hooks.js';
import DraftItems from './DraftItems.jsx';
import { History } from './Planner.jsx';

const SAMPLE = `Thuận: mình sẽ xong API WebSocket trước thứ 6
Mai Anh: cần ai đó kiểm thử bảo mật thanh toán
Như: cập nhật wireframe Thông báo và Activity Log
Hiệp: mình sẽ cấu hình xong WSS vào ngày mai`;

export default function Meeting({ project, onUsage, disabled }) {
  const info = useProjectInfo(project._id);
  const [f, setF] = useState({ title: `Họp ${info?.project?.sprint?.name || 'nhóm'} – ${new Date().toLocaleDateString('vi-VN')}`, text: '' });
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const beginRequest = useLatestRequest();
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

  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <div className="space-y-4">
        <div className="card space-y-4 p-4">
          <span className="flex items-center gap-1.5 text-label-lg font-semibold text-slate-900">
            <Icon name="groups" size={18} className="text-blue-600" /> Nội dung cuộc họp
          </span>
          <Field label="Tên cuộc họp">
            <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
          <Field label="Biên bản / ghi chú họp (dán văn bản)">
            <textarea className="textarea min-h-[180px] font-mono text-body-sm" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder={SAMPLE} />
          </Field>
          {!f.text && (
            <button className="text-label-md text-blue-600 hover:underline" onClick={() => setF({ ...f, text: SAMPLE })}>
              Dùng biên bản mẫu
            </button>
          )}
          <Notice tone="warn">Không rõ người hoặc hạn thì AI sẽ để trống, không tự đoán.</Notice>
          {!info?.access?.canManage && <Notice>Chỉ PM, Owner hoặc Admin của dự án đang hoạt động được tạo và duyệt việc từ biên bản.</Notice>}
          <button className="btn-primary h-10 w-full" onClick={extract} disabled={busy || f.text.trim().length < 10 || disabled || !info?.access?.canManage}>
            {busy ? <Spinner /> : <Icon name="auto_awesome" size={18} />}
            Trích action items
          </button>
        </div>
        {error && <Notice tone={error.status === 429 ? 'warn' : 'danger'}>{error.message}</Notice>}
        <History items={history.data?.drafts || []} onOpen={open} activeId={draft?._id} />
      </div>
      <div className="min-w-0">
        {draft ? (
          <DraftItems
            key={draft._id}
            draft={draft}
            canManage={!!info?.access?.canManage}
            setDraft={setDraft}
            members={info?.project?.members || []}
            title="Action items nháp"
            showExcerpt
            onRegenerate={extract}
            regenerating={busy}
            onApproved={() => history.reload()}
          />
        ) : (
          <div className="card flex flex-col items-center justify-center px-6 py-16 text-center">
            <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-50 text-purple-500">
              <Icon name="record_voice_over" size={30} />
            </span>
            <p className="text-headline-sm text-slate-900">Dán biên bản họp để chuyển thành việc cần làm</p>
            <p className="mt-1 max-w-md text-body-sm text-slate-500">Mỗi action item kèm trích đoạn gốc từ biên bản. Xem, sửa và duyệt trước khi tạo công việc.</p>
          </div>
        )}
      </div>
    </div>
  );
}
