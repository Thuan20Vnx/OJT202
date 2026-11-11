import { t as tr, useI18n } from '../../lib/i18n.js';
import { useEffect, useState } from 'react';
import { Empty, ErrorBox, Field, Icon, Notice, PageLoader, Select, Spinner, Tabs, Toggle } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useLoad, useToast } from '../../lib/app.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';

const SEVERITY = {
  get high() { return [tr('Cao'), 'border-rose-200 bg-rose-50 text-rose-700']; },
  get medium() { return [tr('Trung bình'), 'border-amber-200 bg-amber-50 text-amber-700']; },
  get low() { return [tr('Thấp'), 'border-slate-200 bg-slate-100 text-slate-600']; },
};
const KIND_ICON = { review: 'rate_review', security: 'shield', suggest: 'lightbulb' };
const ITEM_KIND = {
  get feature() { return tr('Chức năng'); },
  issue: 'Issue',
  mcp: 'MCP',
  get library() { return tr('Thư viện'); },
  skill: 'Skill',
  get tool() { return tr('Công cụ'); },
};

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/**
 * Chữ "i" đặt cạnh tiêu đề: bấm để mở/đóng phần giải thích. Đặt trong khung flex-wrap; phần chữ tự xuống dòng riêng.
 */
function Info({ children }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`icon-btn h-6 w-6 ${open ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={tr('Giải thích')} title={tr('Giải thích')}>
        <Icon name="info" size={16} />
      </button>
      {open && <p className="animate-fade-up basis-full text-label-md font-normal text-slate-500">{children}</p>}
    </>
  );
}

function CopyBlock({ text, label }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast(tr('Đã sao chép'));
    } catch {
      toast(tr('Không sao chép được, hãy chọn và sao chép thủ công'));
    }
  };
  return (
    <div className="relative">
      {label && <p className="mb-1 text-label-md font-normal text-slate-500">{label}</p>}
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-900 p-3 pr-10 font-mono text-label-md text-slate-100">{text}</pre>
      <button type="button" className="icon-btn absolute right-1.5 top-1.5 h-7 w-7 text-slate-300 hover:text-white" style={label ? { top: '1.75rem' } : undefined} onClick={copy} title={tr('Sao chép')}><Icon name="content_copy" size={16} /></button>
    </div>
  );
}

// ===================== REPO =====================
function ConnectForm({ projectId, current, onSaved, onCancel }) {
  const [f, setF] = useState({ provider: current?.provider || 'github', url: current?.webUrl || '', token: '' });
  const { busy, error, run } = useAction();
  const submit = (e) => {
    e.preventDefault();
    run(async () => onSaved((await api.put(`/projects/${projectId}/repo`, { provider: f.provider, url: f.url, ...(f.token.trim() && { token: f.token.trim() }) })).connection));
  };
  return (
    <form className="card space-y-3 p-4" onSubmit={submit}>
      <p className="flex items-center gap-1.5 text-label-lg font-semibold text-slate-900"><Icon name="link" size={18} className="text-blue-600" />{tr(' Kết nối repo')}</p>
      <label className="block">
        <span className="label">{tr('Nền tảng')}</span>
        <Select className="input" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}>
          <option value="github">GitHub</option>
          <option value="gitlab">GitLab</option>
        </Select>
      </label>
      <label className="block">
        <span className="label">{tr('Đường dẫn repo')}</span>
        <input className="input" required value={f.url} placeholder={f.provider === 'github' ? 'https://github.com/nhom/du-an' : 'https://gitlab.com/nhom/du-an'} onChange={(e) => setF({ ...f, url: e.target.value })} />
      </label>
      <label className="block">
        <span className="label">{tr('Token chỉ đọc (repo riêng tư)')}</span>
        <input className="input" type="password" autoComplete="off" value={f.token} placeholder={current?.hasToken ? tr('Để trống để giữ token hiện tại') : ''} onChange={(e) => setF({ ...f, token: e.target.value })} />
      </label>
      <p className="text-label-md font-normal text-slate-500">{tr('TaskFlow chỉ đọc commit, Pull Request và ngôn ngữ của repo, không đọc code. Token được mã hóa và không hiển thị lại.')}</p>
      {error && <Notice tone="danger">{error.message}</Notice>}
      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={busy}>{busy && <Spinner />}{tr('Kiểm tra và lưu')}</button>
        {onCancel && <button type="button" className="btn-outline" onClick={onCancel}>{tr('Hủy')}</button>}
      </div>
    </form>
  );
}

function ConnectionCard({ projectId, conn, canManage, onChange, onEdit }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const { busy, error, run } = useAction();
  const remove = () => run(async () => {
    await api.del(`/projects/${projectId}/repo`);
    onChange(null);
    toast(tr('Đã ngắt kết nối repo'));
  });
  return (
    <div className="card space-y-3 p-4">
      <div>
        <p className="section-label">{conn.provider === 'github' ? 'GitHub' : 'GitLab'}</p>
        <a className="break-all text-label-lg font-semibold text-blue-600 hover:underline" href={conn.webUrl} target="_blank" rel="noreferrer">{conn.repoPath}</a>
        <p className="text-label-md font-normal text-slate-500">{tr('Nhánh chính: {0}', [conn.defaultBranch])}{conn.hasToken ? tr(' · Có token') : tr(' · Không token')}</p>
      </div>
      {error && <Notice tone="danger">{error.message}</Notice>}
      {canManage && (
        <div className="flex gap-2">
          <button className="btn-outline btn-sm" disabled={busy} onClick={onEdit}>{tr('Đổi repo')}</button>
          {confirming
            ? <button className="btn-outline btn-sm text-rose-600" disabled={busy} onClick={remove}>{tr('Xác nhận ngắt')}</button>
            : <button className="btn-outline btn-sm" disabled={busy} onClick={() => setConfirming(true)}>{tr('Ngắt kết nối')}</button>}
        </div>
      )}
    </div>
  );
}

// ===================== GỢI Ý HẰNG NGÀY =====================
function DailyCard({ projectId, settings, canManage, disabled, onSettings, onRun }) {
  const toast = useToast();
  const [time, setTime] = useState(settings.dailyTime);
  const save = useAction();
  const now = useAction();
  const patch = (body, message) => save.run(async () => {
    onSettings((await api.patch(`/projects/${projectId}/agent/settings`, body)).settings);
    toast(message);
  });
  const runNow = () => now.run(async () => onRun((await api.post(`/projects/${projectId}/agent/suggest`, {})).run));
  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <p className="flex items-center gap-1.5 text-label-lg font-semibold text-slate-900"><Icon name="travel_explore" size={18} className="text-blue-600" />{tr(' Gợi ý hằng ngày')}</p>
          <Info>{tr('Gemini tìm MCP server, skill, plugin và thư viện có ích cho dự án từ MCP Registry và npm. Không đọc code.')}</Info>
        </div>
        <Toggle checked={settings.daily} disabled={!canManage || save.busy} label={tr('Gợi ý hằng ngày')} onChange={(v) => patch({ daily: v }, v ? tr('Đã bật gợi ý hằng ngày') : tr('Đã tắt gợi ý hằng ngày'))} />
      </div>
      <div className="flex items-end gap-2">
        <label className="block flex-1">
          <span className="label">{tr('Giờ chạy ({0})', [settings.timezone])}</span>
          <input type="time" className="input" value={time} disabled={!canManage || save.busy} onChange={(e) => setTime(e.target.value)} />
        </label>
        {canManage && time !== settings.dailyTime && <button className="btn-outline" disabled={save.busy} onClick={() => patch({ dailyTime: time }, tr('Đã lưu giờ chạy'))}>{tr('Lưu giờ')}</button>}
      </div>
      {canManage && (
        <button className="btn-outline w-full" disabled={now.busy || disabled} onClick={runNow}>
          {now.busy ? <Spinner /> : <Icon name="play_arrow" size={18} />}{tr(' Chạy ngay')}</button>
      )}
      {now.busy && <p className="text-label-md font-normal text-slate-500">{tr('Đang tra cứu và chọn lọc, có thể mất đến một phút…')}</p>}
      {(save.error || now.error) && <Notice tone={(save.error || now.error).status === 429 ? 'warn' : 'danger'}>{(save.error || now.error).message}</Notice>}
    </div>
  );
}

// ===================== AGENT TRÊN MÁY (MCP) =====================
function configs({ serverPath, apiUrl }, token) {
  const secret = token || '<TOKEN>';
  return {
    claude: { file: tr('Chạy trong terminal'), text: `claude mcp add taskflow --scope user -e TASKFLOW_URL=${apiUrl} -e TASKFLOW_TOKEN=${secret} -- node "${serverPath}"` },
    codex: { file: '~/.codex/config.toml', text: `[mcp_servers.taskflow]\ncommand = "node"\nargs = ['${serverPath}']\nenv = { TASKFLOW_URL = "${apiUrl}", TASKFLOW_TOKEN = "${secret}" }` },
    antigravity: { file: '~/.gemini/config/mcp_config.json', text: JSON.stringify({ mcpServers: { taskflow: { command: 'node', args: [serverPath], env: { TASKFLOW_URL: apiUrl, TASKFLOW_TOKEN: secret } } } }, null, 2) },
  };
}

const DIR_KEY = 'taskflow.agentDir';
const AGENT_NAMES = { antigravity: 'Antigravity', claude: 'Claude Code', codex: 'Codex' };
// Lệnh cài được dán vào terminal: không nhận ký tự mà shell hiểu là lệnh.
const UNSAFE_PATH = /["'`$%&|<>^;\r\n]/;

/** Cài runner chạy nền một lần; sau đó giao việc cho agent ngay từ web, không cần mở terminal. */
function RunnerSetup({ mcp, token }) {
  const toast = useToast();
  const [runner, setRunner] = useState(null);
  const disconnect = useAction();
  const stop = () => disconnect.run(async () => {
    setRunner((await api.post('/agent/runner/disconnect', {})).runner);
    toast(tr('Đã ngắt kết nối agent trên máy'));
  });
  const [dir, setDir] = useState(() => {
    try { return localStorage.getItem(DIR_KEY) || ''; } catch { return ''; }
  });
  useEffect(() => {
    let alive = true;
    // Lỗi (kể cả BackEnd bản cũ chưa có API này) vẫn coi là đang tắt để nút Bật agent luôn hiện.
    const load = () => api.get('/agent/runner').then((d) => alive && setRunner(d.runner)).catch((e) => alive && setRunner({ online: false, agents: [], unsupported: e.status === 404 }));
    load();
    const timer = setInterval(load, 8000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  const changeDir = (value) => {
    setDir(value);
    try { localStorage.setItem(DIR_KEY, value); } catch { /* chỉ dùng cho phiên này */ }
  };
  const folder = dir.trim();
  const badPath = UNSAFE_PATH.test(folder);
  const runnerPath = mcp.serverPath.replace(/index\.js$/, 'runner.js');
  const command = `node "${runnerPath}" install --url ${mcp.apiUrl} --token ${token || '<TOKEN>'}${folder && !badPath ? ` --dir "${folder}"` : ''}`;
  return (
    <div className="space-y-2 border-t border-slate-100 pt-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="flex items-center gap-1.5 text-label-lg font-semibold text-slate-900"><Icon name="play_circle" size={18} className="text-blue-600" />{tr(' Chạy agent từ web')}</p>
        <span className={`chip ${runner?.online ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${runner?.online ? 'bg-emerald-500' : 'bg-slate-400'}`} />
          {runner?.online ? tr('Đang bật: {0}', [runner.agents.map((a) => AGENT_NAMES[a]).join(', ') || tr('chưa có agent')]) : tr('Đang tắt')}
        </span>
        <Info>{tr('Cài một lần: agent tự chạy ẩn mỗi khi bạn đăng nhập Windows. Sau đó bấm "Chạy bằng Antigravity" ở Lập kế hoạch, Hỏi đáp dự án, Ghi chú họp là agent trên máy làm và trả kết quả về web. "Ngắt kết nối" dừng agent ngay và hủy việc đang chờ; bấm "Bật agent" để bật lại.')}</Info>
        {runner?.online
          ? <button type="button" className="btn-outline btn-sm ml-auto text-rose-600" disabled={disconnect.busy} onClick={stop}>{disconnect.busy ? <Spinner /> : <Icon name="link_off" size={16} />}{tr(' Ngắt kết nối')}</button>
          : <a className="btn-outline btn-sm ml-auto" href="taskflow://start"><Icon name="power_settings_new" size={16} />{tr(' Bật agent')}</a>}
      </div>
      {disconnect.error && <Notice tone="danger">{disconnect.error.message}</Notice>}
      {runner?.unsupported && <Notice tone="warn">{tr('Máy chủ TaskFlow đang chạy bản cũ, chưa hỗ trợ giao việc cho agent. Hãy khởi động lại BackEnd rồi tải lại trang.')}</Notice>}
      <Field label={tr('Thư mục dự án trên máy (không bắt buộc)')} error={badPath ? tr('Đường dẫn chứa ký tự không dùng được trong lệnh cài') : undefined}>
        <input className="input" value={dir} onChange={(e) => changeDir(e.target.value)} placeholder="C:\Users\ban\Documents\du-an" spellCheck={false} />
      </Field>
      {token
        ? <CopyBlock label={tr('Dán lệnh này vào terminal một lần')} text={command} />
        : <Notice>{tr('Tạo token ở trên để lấy lệnh cài đặt (token chỉ hiện một lần).')}</Notice>}
      <p className="text-label-md font-normal text-slate-500">
        {tr('Lệnh cài chỉ ghi vào tài khoản Windows của bạn. Gỡ cài đặt:')} <code className="break-all rounded bg-slate-100 px-1 text-slate-700">node "{runnerPath}" uninstall</code>
      </p>
    </div>
  );
}

function LocalAgentCard({ projectId }) {
  const toast = useToast();
  const { data, loading, error, reload, setData } = useLoad(() => api.get('/agent-tokens'), []);
  const [form, setForm] = useState({ name: '', days: '30' });
  const [created, setCreated] = useState(null);
  const [client, setClient] = useState('claude');
  const action = useAction();
  if (loading && !data) return <div className="card p-4"><PageLoader /></div>;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const create = (e) => {
    e.preventDefault();
    action.run(async () => {
      const d = await api.post('/agent-tokens', { name: form.name, days: Number(form.days) });
      setCreated(d.token);
      setForm({ name: '', days: form.days });
      setData((x) => ({ ...x, tokens: [d.record, ...(x?.tokens || [])] }));
    });
  };
  const revoke = (id) => action.run(async () => {
    await api.del(`/agent-tokens/${id}`);
    setData((x) => ({ ...x, tokens: x.tokens.filter((t) => t._id !== id) }));
    toast(tr('Đã thu hồi token'));
  });
  const snippet = configs(data.mcp, created)[client];
  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <p className="flex items-center gap-1.5 text-label-lg font-semibold text-slate-900"><Icon name="terminal" size={18} className="text-blue-600" />{tr(' Agent trên máy (MCP)')}</p>
        <Info>{tr('Claude Code, Codex hoặc Antigravity chạy bằng gói của chính bạn nên không tốn hạn mức AI của nhóm: tự đọc code trên máy, hỏi đáp về dự án, lập kế hoạch và tách việc từ biên bản họp. Kết quả gửi về TaskFlow dưới dạng bản nháp để PM duyệt. Code không đi qua server TaskFlow.')}</Info>
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={create}>
        <input className="input min-w-0 flex-1" required maxLength={80} placeholder={tr('Tên token, ví dụ: Claude Code trên laptop')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Select className="input w-auto" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })}>
          <option value="7">{tr('7 ngày')}</option>
          <option value="30">{tr('30 ngày')}</option>
          <option value="90">{tr('90 ngày')}</option>
        </Select>
        <button className="btn-primary" disabled={action.busy}>{action.busy && <Spinner />}{tr('Tạo token')}</button>
      </form>
      {created && <Notice tone="warn">{tr('Token chỉ hiện một lần và đã được điền vào cấu hình bên dưới. Hãy sao chép ngay; không chia sẻ token này.')}</Notice>}
      {action.error && <Notice tone="danger">{action.error.message}</Notice>}
      <Tabs value={client} onChange={setClient} tabs={[{ value: 'claude', label: 'Claude Code' }, { value: 'codex', label: 'Codex' }, { value: 'antigravity', label: 'Antigravity' }]} />
      <CopyBlock label={snippet.file} text={snippet.text} />
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-label-md font-normal text-slate-500">
        <span>{tr('Mã dự án:')}</span> <code className="break-all rounded bg-slate-100 px-1 text-slate-700">{projectId}</code>
        <Info>{tr('Sau khi thêm, mở agent trong thư mục repo của dự án rồi yêu cầu, ví dụ: "Dùng TaskFlow quét bảo mật dự án này", "Hỏi TaskFlow: việc nào đang quá hạn?" hoặc "Lập kế hoạch làm trang thanh toán rồi gửi về TaskFlow". Lệnh có sẵn: security_review, review_pr, suggest_next, ask_project, make_plan, meeting_to_tasks.')}</Info>
      </div>
      <RunnerSetup mcp={data.mcp} token={created} />
      {data.tokens.length > 0 && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {data.tokens.map((t) => (
            <li key={t._id} className="flex items-center gap-2 py-2 text-body-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-800">{t.name}</p>
                <p className="text-label-md font-normal text-slate-500">
                  <code>{t.prefix}…</code> · {new Date(t.expiresAt) < new Date() ? tr('đã hết hạn') : tr('hết hạn {0}', [fmtDate(t.expiresAt)])}
                  {t.lastUsedAt ? tr(' · dùng lần cuối {0}', [fmtDateTime(t.lastUsedAt)]) : tr(' · chưa dùng')}
                </p>
              </div>
              <button className="btn-outline btn-sm" disabled={action.busy} onClick={() => revoke(t._id)}>{tr('Thu hồi')}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ===================== KẾT QUẢ =====================
function MismatchList({ title, items, tone }) {
  if (!items.length) return null;
  return (
    <div>
      <p className={`mb-1 text-label-md font-semibold ${tone}`}>{title} ({items.length})</p>
      <ul className="space-y-1">{items.map((t) => <li key={t._id ?? t.key} className="truncate text-body-sm text-slate-700"><b className="font-mono text-label-md">{t.key}</b> {t.title}</li>)}</ul>
    </div>
  );
}

function ProgressCard({ projectId }) {
  const { data, loading, error, reload } = useLoad(() => api.get(`/projects/${projectId}/repo/progress`), [projectId]);
  const p = data?.progress;
  return (
    <div className="card space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-label-lg font-semibold text-slate-900"><Icon name="compare_arrows" size={18} className="text-blue-600" />{tr(' Đối chiếu repo và bảng công việc')}</p>
        <button className="icon-btn h-8 w-8" onClick={reload} title={tr('Tải lại')}><Icon name="refresh" size={18} /></button>
      </div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !p && <PageLoader />}
      {p && (
        <>
          {!p.usesKeys && <Notice tone="info">{tr('Chưa có commit hoặc PR nào ghi mã công việc (ví dụ TF-123) nên chưa đối chiếu đầy đủ được.')}</Notice>}
          {p.usesKeys && !p.doneNoMerge.length && !p.todoWithCode.length && <p className="text-body-sm text-emerald-700">{tr('Không thấy chỗ lệch giữa repo và bảng công việc.')}</p>}
          <MismatchList title={tr('Đã Done nhưng chưa thấy code được merge')} items={p.doneNoMerge} tone="text-rose-700" />
          <MismatchList title={tr('Còn Cần làm nhưng đã có code')} items={p.todoWithCode} tone="text-amber-700" />
          <div>
            <p className="mb-1 text-label-md font-semibold text-slate-700">{tr('Pull Request đang mở ({0})', [p.openPulls.length])}</p>
            {!p.openPulls.length && <p className="text-body-sm text-slate-500">{tr('Không có Pull Request nào đang mở.')}</p>}
            <ul className="divide-y divide-slate-100">
              {p.openPulls.map((pr) => (
                <li key={pr.number} className="flex items-center gap-2 py-2">
                  <a className="min-w-0 flex-1 truncate text-body-sm text-slate-800 hover:underline" href={pr.url} target="_blank" rel="noreferrer">#{pr.number} {pr.title}</a>
                  {p.stalePulls.some((s) => s.number === pr.number) && <span className="chip border-amber-200 bg-amber-50 text-amber-700">{tr('{0} ngày chưa cập nhật', [pr.ageDays])}</span>}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function RunCard({ run, canManage, onUpdate }) {
  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState(null);
  const act = async (item, action) => {
    setBusyKey(item.key);
    setError(null);
    try {
      onUpdate((await api.post(`/agent/runs/${run._id}/items/${item.key}/${action}`, {})).run);
    } catch (err) {
      setError(err);
    } finally {
      setBusyKey(null);
    }
  };
  const failed = run.status === 'failed';
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Icon name={KIND_ICON[run.kind]} size={18} className="text-purple-500" />
        <p className="min-w-0 flex-1 text-label-lg font-semibold text-slate-900">{run.title}</p>
        <span className={`chip ${run.source === 'mcp' ? 'border-purple-200 bg-purple-50 text-purple-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>{run.source === 'mcp' ? run.agentName || tr('Agent trên máy') : tr('Gemini · tự động')}</span>
        <span className="text-label-md font-normal text-slate-500">{fmtDateTime(run.createdAt)}</span>
      </div>
      {failed && <Notice tone="warn" className="mt-2">{tr('Lần chạy tự động này không thành công. Có thể bấm chạy lại thủ công.')}</Notice>}
      {run.summary && <p className="mt-2 whitespace-pre-line text-body-sm text-slate-700">{run.summary}</p>}
      {run.target && <p className="mt-1 text-label-md font-normal text-slate-500">{run.kind === 'suggest' && run.source !== 'mcp' ? tr('Từ khóa đã tra: {0}', [run.target]) : tr('Phạm vi: {0}', [run.target])}</p>}
      {error && <Notice tone="danger" className="mt-2">{error.message}</Notice>}
      {run.items?.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
          {run.items.map((item) => {
            const level = SEVERITY[item.severity];
            return (
              <li key={item.key} className={`py-3 ${item.state === 'dismissed' ? 'opacity-50' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  {level && <span className={`chip ${level[1]}`}>{level[0]}</span>}
                  {item.kind && <span className="chip border-slate-200 bg-slate-50 text-slate-600">{ITEM_KIND[item.kind] ?? item.kind}</span>}
                  <p className="min-w-0 flex-1 text-body-sm font-semibold text-slate-900">{item.title}</p>
                  {item.state === 'accepted' && <span className="chip border-emerald-200 bg-emerald-50 text-emerald-700">{tr('Đã tạo {0}', [item.taskKey])}</span>}
                  {item.state === 'dismissed' && <span className="chip border-slate-200 bg-slate-100 text-slate-600">{tr('Đã bỏ qua')}</span>}
                  {item.state === 'open' && canManage && (
                    <>
                      <button className="btn-primary btn-sm" disabled={!!busyKey} onClick={() => act(item, 'accept')}>{busyKey === item.key && <Spinner />}{tr('Tạo việc')}</button>
                      <button className="btn-outline btn-sm" disabled={!!busyKey} onClick={() => act(item, 'dismiss')}>{tr('Bỏ qua')}</button>
                    </>
                  )}
                </div>
                {item.file && <code className="mt-1 block break-all text-label-md text-slate-500">{item.file}{item.line ? `:${item.line}` : ''}</code>}
                <p className="mt-1 text-body-sm text-slate-600">{item.detail}</p>
                {item.suggestion && <p className="mt-1 text-body-sm text-slate-600"><b>{tr('Cách sửa:')}</b> {item.suggestion}</p>}
                {item.url && <a className="mt-1 block break-all text-label-md text-blue-600 hover:underline" href={item.url} target="_blank" rel="noreferrer noopener">{item.url}</a>}
                {item.evidence && <p className="mt-1 text-label-md font-normal text-slate-500">{tr('Căn cứ:')} {item.evidence}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {!failed && !run.items?.length && <p className="mt-2 text-body-sm text-slate-500">{tr('Không có mục nào cần xử lý.')}</p>}
    </div>
  );
}

export default function Agent({ project, onUsage, disabled }) {
  useI18n();
  const repo = useLoad(() => api.get(`/projects/${project._id}/repo`), [project._id]);
  const runs = useLoad(() => api.get(`/projects/${project._id}/agent/runs`), [project._id]);
  const [editing, setEditing] = useState(false);

  if (repo.loading && !repo.data) return <PageLoader />;
  if (repo.error) return <ErrorBox error={repo.error} onRetry={repo.reload} />;
  const { connection: conn, settings, canManage } = repo.data;
  const setConnection = (connection) => {
    repo.setData((d) => ({ ...d, connection }));
    setEditing(false);
  };
  const updateRun = (run) => runs.setData((d) => ({ ...d, runs: d.runs.map((r) => (r._id === run._id ? run : r)) }));
  const addRun = (run) => {
    runs.setData((d) => ({ ...d, runs: [run, ...(d?.runs || [])] }));
    onUsage();
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
      <div className="space-y-4">
        <LocalAgentCard projectId={project._id} />
        <DailyCard projectId={project._id} settings={settings} canManage={canManage} disabled={disabled} onSettings={(s) => repo.setData((d) => ({ ...d, settings: s }))} onRun={addRun} />
        {(!conn || editing) && canManage && <ConnectForm projectId={project._id} current={conn} onSaved={setConnection} onCancel={editing ? () => setEditing(false) : null} />}
        {conn && !editing && <ConnectionCard projectId={project._id} conn={conn} canManage={canManage} onChange={setConnection} onEdit={() => setEditing(true)} />}
      </div>
      <div className="min-w-0 space-y-4">
        {conn ? <ProgressCard key={conn.updatedAt} projectId={project._id} /> : (
          <Empty icon="robot_2" title={tr('Kết nối repo để đối chiếu với bảng công việc')}>{tr('Không bắt buộc: agent trên máy và gợi ý hằng ngày vẫn chạy khi chưa kết nối repo.')}</Empty>
        )}
        {runs.error && <ErrorBox error={runs.error} onRetry={runs.reload} />}
        {(runs.data?.runs || []).map((run) => <RunCard key={run._id} run={run} canManage={canManage} onUpdate={updateRun} />)}
      </div>
    </div>
  );
}
