import { t as tr, useI18n } from '../../lib/i18n.js';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, ErrorBox, Icon, Notice, Spinner } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useApp, useLoad } from '../../lib/app.jsx';
import { fmtDateTime, fmtTime, timeAgo } from '../../lib/format.js';
import { useLatestRequest, useProjectInfo, useSocketEvent } from '../../lib/hooks.js';

const getSuggestions = () => [tr("Việc nào sắp đến hạn tuần này?"), tr("Vì sao TF-103 đang bị chặn và ai đang xử lý?"), tr("Tóm tắt quyết định trong tài liệu kiến trúc")];

export default function Qa({ project, onUsage, disabled }) {
  useI18n();
  const { me } = useApp();
  const info = useProjectInfo(project._id);
  disabled = disabled || !info?.access?.canWrite;
  const navigate = useNavigate();
  const [conv, setConv] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const end = useRef(null);
  const beginRequest = useLatestRequest();
  const list = useLoad(() => api.get(`/projects/${project._id}/ai/conversations`), [project._id, conv?._id, conv?.messages?.length]);
  const scope = useLoad(() => api.get(`/projects/${project._id}/ai/sources`), [project._id]);
  useSocketEvent('documents:changed', () => { scope.reload(); list.reload(); }, [scope.reload, list.reload]);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [conv?.messages?.length, busy]);

  const ask = async (question = q) => {
    if (busy || disabled || question.trim().length < 3) return;
    const current = beginRequest();
    setBusy(true);
    setError(null);
    setQ('');
    setConv((c) => ({ ...(c || {}), messages: [...(c?.messages || []), { role: 'user', content: question, createdAt: new Date(), pending: true }] }));
    try {
      const d = await api.post(`/projects/${project._id}/ai/ask`, { question, conversation: conv?._id });
      if (current()) setConv(d.conversation);
    } catch (e) {
      if (!current()) return;
      setError(e);
      setConv((c) => ({ ...c, messages: c.messages.filter((m) => !m.pending) }));
      setQ(question);
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
      const d = await api.get(`/ai/conversations/${id}`);
      if (current()) { setConv(d.conversation); setQ(''); }
    } catch (e) {
      if (current()) setError(e);
    } finally {
      if (current()) setBusy(false);
    }
  };
  const openSource = (c) => {
    if (c.kind === 'document') navigate(`/documents?document=${encodeURIComponent(c.refId)}`);
    else navigate({ search: `?task=${c.refId}` });
  };

  const taskCount = scope.data?.tasks;
  const docCount = scope.data?.documents;

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <div className="space-y-4">
        <button className="btn-primary h-10 w-full" onClick={() => { beginRequest(); setConv(null); setQ(''); setError(null); setBusy(false); }}>
          <Icon name="add" size={18} />{tr(" Cuộc hỏi mới")}</button>
        <div className="card p-4">
          <p className="mb-2 flex items-center gap-1.5 text-label-lg font-semibold text-slate-900">
            <Icon name="travel_explore" size={18} className="text-blue-600" />{tr(" Phạm vi tìm kiếm")}</p>
          <ul className="space-y-1 text-body-sm text-slate-600">
            <li className="flex items-center gap-2">
              <Icon name="folder" size={16} className="text-blue-600" /> {project.name}
            </li>
            <li className="flex items-center gap-2">
              <Icon name="task_alt" size={16} className="text-slate-400" /> {taskCount ?? '…'}{tr(" công việc")}</li>
            <li className="flex items-center gap-2">
              <Icon name="description" size={16} className="text-slate-400" /> {docCount ?? '…'}{tr(" tài liệu văn bản")}</li>
          </ul>
          <ErrorBox error={scope.error} onRetry={scope.reload} />
          <p className="mt-2 text-body-sm text-slate-600">{tr("Nguồn được đọc trực tiếp khi hỏi; chưa có chỉ mục tìm kiếm nền.")}</p>
          {scope.data?.latestTaskAt && <p className="mt-1 text-label-md text-slate-600">{tr("Cập nhật công việc:")} {fmtDateTime(scope.data.latestTaskAt)}</p>}
          {scope.data?.latestDocumentAt && <p className="mt-1 text-label-md text-slate-600">{tr("Cập nhật tài liệu:")} {fmtDateTime(scope.data.latestDocumentAt)}</p>}
          <Notice tone="warn" className="mt-3">{tr("Chỉ tìm trong dữ liệu bạn có quyền xem. Ảnh scan không được đọc.")}</Notice>
        </div>
        <div className="card p-4">
          <p className="section-label mb-2">{tr("Lịch sử hỏi đáp")}</p>
          <ErrorBox error={list.error} onRetry={list.reload} />
          {list.loading && !list.data && <Spinner />}
          <div className="space-y-1">
            {(list.data?.conversations || []).map((c) => (
              <button key={c._id} onClick={() => open(c._id)} className={`w-full rounded-lg px-2.5 py-2 text-left hover:bg-slate-50 ${conv?._id === c._id ? 'bg-blue-50' : ''}`}>
                <p className="truncate text-body-sm font-medium text-slate-800">{c.title}</p>
                <p className="text-label-md font-normal text-slate-400">
                  {Math.ceil(c.count / 2)}{tr(" câu hỏi · ")}{timeAgo(c.updatedAt)}
                </p>
              </button>
            ))}
            {!list.loading && !list.error && !list.data?.conversations?.length && <p className="text-body-sm text-slate-400">{tr("Chưa có cuộc hỏi đáp")}</p>}
          </div>
        </div>
      </div>

      <div className="card flex min-h-[560px] flex-col">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 text-body-sm">
          <span className="text-slate-500">{tr("Đang hỏi về:")}</span>
          <span className="chip border-blue-200 bg-blue-50 text-blue-700">
            <Icon name="folder" size={12} /> {project.name}
          </span>
          <span className="chip border-slate-200 bg-slate-50 text-slate-500">{tr("Chỉ một dự án")}</span>
        </div>
        <div className="scroll-thin flex-1 space-y-5 overflow-y-auto p-5">
          {!conv?.messages?.length && (
            <div className="flex h-full flex-col items-center justify-center py-12 text-center">
              <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-50 text-purple-500">
                <Icon name="forum" size={30} />
              </span>
              <p className="text-headline-sm text-slate-900">{tr("Hỏi bằng tiếng Việt về công việc & tài liệu của dự án")}</p>
              <p className="mt-1 max-w-md text-body-sm text-slate-500">{tr("Mọi câu trả lời đều có trích dẫn nguồn bấm được. Thiếu chứng cứ, trợ lý sẽ từ chối trả lời thay vì đoán.")}</p>
            </div>
          )}
          {conv?.messages?.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end gap-2">
                <div className="max-w-[75%]">
                  <div className="rounded-2xl rounded-tr-md bg-blue-600 px-4 py-2.5 text-body-md text-white">{m.content}</div>
                  <p className="mt-1 text-right text-label-md font-normal text-slate-400">{fmtTime(m.createdAt)}</p>
                </div>
                <Avatar user={me} size={28} />
              </div>
            ) : (
              <div key={i} className="flex gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-600">
                  <Icon name="auto_awesome" size={16} />
                </span>
                <div className="min-w-0 max-w-[85%] flex-1">
                  {m.sourceState && m.sourceState !== 'current' && (
                    <Notice tone="warn" className="mb-2">
                      {m.sourceState === 'changed'
                        ? tr("Nguồn dự án đã thay đổi từ lúc trả lời. Hãy hỏi lại để có dữ liệu mới nhất.")
                        : tr("Câu trả lời cũ chưa có thông tin phiên bản nguồn. Hãy hỏi lại trước khi sử dụng.")}
                    </Notice>
                  )}
                  {m.refused ? (
                    <div className="rounded-2xl rounded-tl-md border border-amber-200 bg-amber-50 px-4 py-3 text-body-md text-amber-900">
                      <p className="flex items-start gap-2">
                        <Icon name="info" size={18} className="mt-0.5" />
                        {m.content}
                      </p>
                      <p className="mt-1.5 pl-6 text-body-sm text-amber-700">{tr("Thử hỏi về tiến độ, người phụ trách hoặc tài liệu của dự án.")}</p>
                    </div>
                  ) : (
                    <div className="rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3">
                      <p className="whitespace-pre-wrap text-body-md text-slate-800">
                        {m.content.split(/(\[\d+\])/).map((part, j) =>
                          /^\[\d+\]$/.test(part) ? (
                            <sup key={j} className="mx-0.5 rounded bg-blue-100 px-1 text-[10px] font-bold text-blue-700">
                              {part.slice(1, -1)}
                            </sup>
                          ) : (
                            part
                          ),
                        )}
                      </p>
                      {m.citations?.length > 0 && (
                        <div className="mt-3 border-t border-slate-100 pt-3">
                          <p className="section-label mb-2 flex items-center gap-1">
                            <Icon name="format_quote" size={14} />{tr(" Nguồn trích dẫn (")}{m.citations.length})
                          </p>
                          <div className="grid gap-2 sm:grid-cols-3">
                            {m.citations.map((c) => (
                              <button
                                key={c.n}
                                disabled={c.available === false}
                                onClick={() => openSource(c)}
                                className="rounded-lg border border-slate-200 p-2.5 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/40 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <p className="flex items-center gap-1.5 text-label-md text-blue-700">
                                  <span className="rounded bg-blue-100 px-1 text-[10px] font-bold">{c.n}</span>
                                  <span className="truncate">
                                    {c.label}
                                    {c.available === false ? tr(" · Nguồn không còn") : ''}
                                  </span>
                                  <Icon name="open_in_new" size={12} className="ml-auto shrink-0" />
                                </p>
                                <p className="mt-1 line-clamp-2 text-label-md font-normal italic text-slate-500">“{c.excerpt}”</p>
                                {c.currentUpdatedAt && <p className="mt-1 text-label-md text-slate-600">{tr("Nguồn hiện tại:")} {fmtDateTime(c.currentUpdatedAt)}{c.currentVersion != null ? ` · v${c.currentVersion}` : ''}</p>}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <p className="mt-1 text-label-md font-normal text-slate-400">{fmtTime(m.createdAt)}</p>
                </div>
              </div>
            ),
          )}
          {busy && (
            <div className="flex items-center gap-2 text-body-sm text-slate-500">
              <Spinner className="text-purple-500" />{tr(" Đang tìm trong dữ liệu dự án…")}</div>
          )}
          {error && <Notice tone={error.status === 429 ? 'warn' : 'danger'}>{error.message}</Notice>}
          <div ref={end} />
        </div>
        <div className="border-t border-slate-100 p-4">
          {info && !info.access?.canWrite && <Notice tone="warn" className="mb-2">{tr("Dự án chỉ đọc: bạn có thể xem lịch sử nhưng không gửi câu hỏi AI.")}</Notice>}
          <div className="mb-2 flex flex-wrap gap-1.5">
            <span className="text-label-md font-normal text-slate-400">{tr("Gợi ý:")}</span>
            {getSuggestions().map((s) => (
              <button
                key={s}
                onClick={() => ask(s)}
                disabled={busy || disabled}
                className="rounded-full border border-slate-200 px-2.5 py-0.5 text-label-md text-slate-600 hover:border-blue-300 hover:text-blue-700"
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <textarea
              aria-label={tr("Câu hỏi về dự án")}
              rows={2}
              className="textarea flex-1 resize-none"
              placeholder={tr("Đặt câu hỏi về công việc, tiến độ hoặc tài liệu của {0}…", [project.name])}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), ask())}
            />
            <button className="btn-primary h-[52px]" onClick={() => ask()} disabled={busy || q.trim().length < 3 || disabled}>
              <Icon name="send" size={18} />{tr(" Gửi")}</button>
          </div>
          <p className="mt-1.5 text-label-md font-normal text-slate-400">{tr("AI có thể sai – luôn kiểm tra nguồn trích dẫn.")}</p>
        </div>
      </div>
    </div>
  );
}
