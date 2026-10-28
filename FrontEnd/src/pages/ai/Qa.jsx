import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Icon, Notice, Spinner } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useApp, useLoad } from '../../lib/app.jsx';
import { fmtTime, timeAgo } from '../../lib/format.js';

const SUGGEST = ['Việc nào sắp đến hạn tuần này?', 'Vì sao TF-103 đang bị chặn và ai đang xử lý?', 'Tóm tắt quyết định trong tài liệu kiến trúc'];

export default function Qa({ project, onUsage, disabled }) {
  const { me } = useApp();
  const navigate = useNavigate();
  const [conv, setConv] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const end = useRef(null);
  const list = useLoad(() => api.get(`/projects/${project._id}/ai/conversations`), [project._id, conv?._id, conv?.messages?.length]);
  const scope = useLoad(() => Promise.all([api.get(`/projects/${project._id}/tasks`), api.get(`/projects/${project._id}/documents?kind=doc&limit=1`)]), [project._id]);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [conv?.messages?.length, busy]);

  const ask = async (question = q) => {
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    setQ('');
    setConv((c) => ({ ...(c || {}), messages: [...(c?.messages || []), { role: 'user', content: question, createdAt: new Date(), pending: true }] }));
    try {
      const d = await api.post(`/projects/${project._id}/ai/ask`, { question, conversation: conv?._id });
      setConv(d.conversation);
    } catch (e) {
      setError(e);
      setConv((c) => ({ ...c, messages: c.messages.filter((m) => !m.pending) }));
      setQ(question);
    } finally {
      setBusy(false);
      onUsage();
    }
  };
  const open = async (id) => setConv((await api.get(`/ai/conversations/${id}`)).conversation);
  const openSource = (c) => {
    if (c.kind === 'document') navigate('/documents');
    else navigate({ search: `?task=${c.refId}` });
  };

  const taskCount = scope.data?.[0]?.tasks?.length;
  const docCount = scope.data?.[1]?.counts?.doc;

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <div className="space-y-4">
        <button className="btn-primary h-10 w-full" onClick={() => (setConv(null), setError(null))}>
          <Icon name="add" size={18} /> Cuộc hỏi mới
        </button>
        <div className="card p-4">
          <p className="mb-2 flex items-center gap-1.5 text-label-lg font-semibold text-slate-900">
            <Icon name="travel_explore" size={18} className="text-blue-600" /> Phạm vi tìm kiếm
          </p>
          <ul className="space-y-1 text-body-sm text-slate-600">
            <li className="flex items-center gap-2">
              <Icon name="folder" size={16} className="text-blue-600" /> {project.name}
            </li>
            <li className="flex items-center gap-2">
              <Icon name="task_alt" size={16} className="text-slate-400" /> {taskCount ?? '…'} công việc
            </li>
            <li className="flex items-center gap-2">
              <Icon name="description" size={16} className="text-slate-400" /> {docCount ?? 0} tài liệu văn bản
            </li>
          </ul>
          <Notice tone="warn" className="mt-3">
            Chỉ tìm trong dữ liệu bạn có quyền xem. Ảnh scan không được đọc.
          </Notice>
        </div>
        <div className="card p-4">
          <p className="section-label mb-2">Lịch sử hỏi đáp</p>
          <div className="space-y-1">
            {(list.data?.conversations || []).map((c) => (
              <button key={c._id} onClick={() => open(c._id)} className={`w-full rounded-lg px-2.5 py-2 text-left hover:bg-slate-50 ${conv?._id === c._id ? 'bg-blue-50' : ''}`}>
                <p className="truncate text-body-sm font-medium text-slate-800">{c.title}</p>
                <p className="text-label-md font-normal text-slate-400">
                  {Math.ceil(c.count / 2)} câu hỏi · {timeAgo(c.updatedAt)}
                </p>
              </button>
            ))}
            {!list.data?.conversations?.length && <p className="text-body-sm text-slate-400">Chưa có cuộc hỏi đáp</p>}
          </div>
        </div>
      </div>

      <div className="card flex min-h-[560px] flex-col">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 text-body-sm">
          <span className="text-slate-500">Đang hỏi về:</span>
          <span className="chip border-blue-200 bg-blue-50 text-blue-700">
            <Icon name="folder" size={12} /> {project.name}
          </span>
          <span className="chip border-slate-200 bg-slate-50 text-slate-500">Chỉ một dự án</span>
        </div>
        <div className="scroll-thin flex-1 space-y-5 overflow-y-auto p-5">
          {!conv?.messages?.length && (
            <div className="flex h-full flex-col items-center justify-center py-12 text-center">
              <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-50 text-purple-500">
                <Icon name="forum" size={30} />
              </span>
              <p className="text-headline-sm text-slate-900">Hỏi bằng tiếng Việt về công việc & tài liệu của dự án</p>
              <p className="mt-1 max-w-md text-body-sm text-slate-500">Mọi câu trả lời đều có trích dẫn nguồn bấm được. Thiếu chứng cứ, trợ lý sẽ từ chối trả lời thay vì đoán.</p>
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
                        ? 'Nguồn dự án đã thay đổi từ lúc trả lời. Hãy hỏi lại để có dữ liệu mới nhất.'
                        : 'Câu trả lời cũ chưa có thông tin phiên bản nguồn. Hãy hỏi lại trước khi sử dụng.'}
                    </Notice>
                  )}
                  {m.refused ? (
                    <div className="rounded-2xl rounded-tl-md border border-amber-200 bg-amber-50 px-4 py-3 text-body-md text-amber-900">
                      <p className="flex items-start gap-2">
                        <Icon name="info" size={18} className="mt-0.5" />
                        {m.content}
                      </p>
                      <p className="mt-1.5 pl-6 text-body-sm text-amber-700">Thử hỏi về tiến độ, người phụ trách hoặc tài liệu của dự án.</p>
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
                            <Icon name="format_quote" size={14} /> Nguồn trích dẫn ({m.citations.length})
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
                                    {c.available === false ? ' · Nguồn không còn' : ''}
                                  </span>
                                  <Icon name="open_in_new" size={12} className="ml-auto shrink-0" />
                                </p>
                                <p className="mt-1 line-clamp-2 text-label-md font-normal italic text-slate-500">“{c.excerpt}”</p>
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
              <Spinner className="text-purple-500" /> Đang tìm trong dữ liệu dự án…
            </div>
          )}
          {error && <Notice tone={error.status === 429 ? 'warn' : 'danger'}>{error.message}</Notice>}
          <div ref={end} />
        </div>
        <div className="border-t border-slate-100 p-4">
          <div className="mb-2 flex flex-wrap gap-1.5">
            <span className="text-label-md font-normal text-slate-400">Gợi ý:</span>
            {SUGGEST.map((s) => (
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
              rows={2}
              className="textarea flex-1 resize-none"
              placeholder={`Đặt câu hỏi về công việc, tiến độ hoặc tài liệu của ${project.name}…`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), ask())}
            />
            <button className="btn-primary h-[52px]" onClick={() => ask()} disabled={busy || q.trim().length < 3 || disabled}>
              <Icon name="send" size={18} /> Gửi
            </button>
          </div>
          <p className="mt-1.5 text-label-md font-normal text-slate-400">AI có thể sai – luôn kiểm tra nguồn trích dẫn.</p>
        </div>
      </div>
    </div>
  );
}
