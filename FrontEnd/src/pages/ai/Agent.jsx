import { t as tr, useI18n } from '../../lib/i18n.js';
import { useEffect, useState } from 'react';
import { ErrorBox, Field, Icon, Notice, PageLoader, Select, Spinner, Tabs, Toggle } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useLoad, useToast } from '../../lib/app.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import { Info } from './AgentRun.jsx';

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

/** Trạng thái runner trên máy (hỏi lại 8 giây một lần) và nút ngắt kết nối. */
function useRunner() {
  const toast = useToast();
  const [runner, setRunner] = useState(null);
  const disconnect = useAction();
  useEffect(() => {
    let alive = true;
    // Lỗi (kể cả BackEnd bản cũ chưa có API này) vẫn coi là đang tắt để nút Bật agent luôn hiện.
    const load = () => api.get('/agent/runner').then((d) => alive && setRunner(d.runner)).catch((e) => alive && setRunner({ online: false, agents: [], unsupported: e.status === 404 }));
    load();
    const timer = setInterval(load, 8000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  const stop = () => disconnect.run(async () => {
    setRunner((await api.post('/agent/runner/disconnect', {})).runner);
    toast(tr('Đã ngắt kết nối agent trên máy'));
  });
  return { runner, stop, busy: disconnect.busy, error: disconnect.error };
}

/** Thanh trạng thái đầu tab: agent trên máy đang bật hay tắt, kèm nút Bật agent / Ngắt kết nối. */
function RunnerStatus({ runner, stop, busy, error }) {
  const online = !!runner?.online;
  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${online ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
          <Icon name="computer" size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5">
            <p className="text-label-lg font-semibold text-slate-900">{tr('Agent trên máy')}</p>
            <Info>{tr('Cài một lần: agent tự chạy ẩn mỗi khi bạn đăng nhập Windows. Sau đó bấm "Chạy bằng Antigravity" ở Lập kế hoạch, Hỏi đáp dự án, Ghi chú họp là agent trên máy làm và trả kết quả về web. "Ngắt kết nối" dừng agent ngay và hủy việc đang chờ; bấm "Bật agent" để bật lại.')}</Info>
          </div>
          <p className="flex items-center gap-1.5 text-label-md font-normal text-slate-500">
            <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            {!runner ? tr('Đang kiểm tra…') : online
              ? tr('Đang bật: {0}', [runner.agents.map((a) => AGENT_NAMES[a]).join(', ') || tr('chưa có agent')])
              : runner.lastSeenAt ? tr('Đang tắt · lần cuối {0}', [fmtDateTime(runner.lastSeenAt)]) : tr('Đang tắt')}
          </p>
        </div>
        {online
          ? <button type="button" className="btn-outline btn-sm text-rose-600" disabled={busy} onClick={stop}>{busy ? <Spinner /> : <Icon name="link_off" size={16} />}{tr(' Ngắt kết nối')}</button>
          : <a className="btn-primary btn-sm" href="taskflow://start"><Icon name="power_settings_new" size={16} />{tr(' Bật agent')}</a>}
      </div>
      {error && <Notice tone="danger">{error.message}</Notice>}
      {runner?.unsupported && <Notice tone="warn">{tr('Máy chủ TaskFlow đang chạy bản cũ, chưa hỗ trợ giao việc cho agent. Hãy khởi động lại BackEnd rồi tải lại trang.')}</Notice>}
    </div>
  );
}

function Step({ n, done, children }) {
  return (
    <div className="flex gap-3">
      <span className={`mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-label-md font-semibold ${done ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
        {done ? <Icon name="check" size={14} /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">{children}</div>
    </div>
  );
}

/** Mục gập: mặc định đóng, bấm tiêu đề để mở. */
function Fold({ icon, title, children }) {
  return (
    <details className="group border-t border-slate-100">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-2.5 text-body-sm text-slate-700 hover:text-slate-900 [&::-webkit-details-marker]:hidden">
        <Icon name={icon} size={18} className="text-slate-400" />
        <span className="flex-1">{title}</span>
        <Icon name="chevron_right" size={18} className="text-slate-400 transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-3 pb-3">{children}</div>
    </details>
  );
}

/** Cài agent một lần theo 3 bước; danh sách token và cấu hình MCP thủ công gập lại bên dưới. */
function SetupCard({ projectId }) {
  const toast = useToast();
  const { data, loading, error, reload, setData } = useLoad(() => api.get('/agent-tokens'), []);
  const [form, setForm] = useState({ name: '', days: '30' });
  const [created, setCreated] = useState(null);
  const [client, setClient] = useState('claude');
  const [dir, setDir] = useState(() => {
    try { return localStorage.getItem(DIR_KEY) || ''; } catch { return ''; }
  });
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
  const changeDir = (value) => {
    setDir(value);
    try { localStorage.setItem(DIR_KEY, value); } catch { /* chỉ dùng cho phiên này */ }
  };
  const folder = dir.trim();
  const badPath = UNSAFE_PATH.test(folder);
  const runnerPath = data.mcp.serverPath.replace(/index\.js$/, 'runner.js');
  const command = `node "${runnerPath}" install --url ${data.mcp.apiUrl} --token ${created || '<TOKEN>'}${folder && !badPath ? ` --dir "${folder}"` : ''}`;
  const snippet = configs(data.mcp, created)[client];
  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-1.5">
        <p className="text-label-lg font-semibold text-slate-900">{tr('Cài đặt một lần')}</p>
        <Info>{tr('Claude Code, Codex hoặc Antigravity chạy bằng gói của chính bạn nên không tốn hạn mức AI của nhóm: tự đọc code trên máy, hỏi đáp về dự án, lập kế hoạch và tách việc từ biên bản họp. Kết quả gửi về TaskFlow dưới dạng bản nháp để PM duyệt. Code không đi qua server TaskFlow.')}</Info>
      </div>
      <div className="space-y-4 pb-3">
        <Step n={1} done={!!created}>
          <form className="flex flex-wrap gap-2" onSubmit={create}>
            <input className="input min-w-0 flex-1" required maxLength={80} aria-label={tr('Tên token')} placeholder={tr('Tên token, ví dụ: laptop')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Select className="input w-auto" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })}>
              <option value="7">{tr('7 ngày')}</option>
              <option value="30">{tr('30 ngày')}</option>
              <option value="90">{tr('90 ngày')}</option>
            </Select>
            <button className="btn-primary" disabled={action.busy}>{action.busy && <Spinner />}{tr('Tạo token')}</button>
          </form>
          {created && <Notice tone="warn">{tr('Token chỉ hiện một lần và đã được điền vào lệnh cài bên dưới. Không chia sẻ token này.')}</Notice>}
        </Step>
        <Step n={2}>
          <Field label={tr('Thư mục dự án trên máy (không bắt buộc)')} error={badPath ? tr('Đường dẫn chứa ký tự không dùng được trong lệnh cài') : undefined}>
            <input className="input" value={dir} onChange={(e) => changeDir(e.target.value)} placeholder="C:\Users\ban\Documents\du-an" spellCheck={false} />
          </Field>
        </Step>
        <Step n={3}>
          {created
            ? <CopyBlock label={tr('Chép lệnh cài, dán vào terminal')} text={command} />
            : <p className="pt-1.5 text-body-sm text-slate-500">{tr('Chép lệnh cài, dán vào terminal. Lệnh hiện sau khi tạo token ở bước 1.')}</p>}
        </Step>
      </div>
      {action.error && <Notice tone="danger" className="mb-3">{action.error.message}</Notice>}
      <Fold icon="key" title={tr('Token đang dùng ({0})', [data.tokens.length])}>
        {!data.tokens.length && <p className="text-body-sm text-slate-500">{tr('Chưa có token nào.')}</p>}
        <ul className="divide-y divide-slate-100">
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
      </Fold>
      <Fold icon="tune" title={tr('Nâng cao: cấu hình MCP thủ công, mã dự án')}>
        <Tabs value={client} onChange={setClient} tabs={[{ value: 'claude', label: 'Claude Code' }, { value: 'codex', label: 'Codex' }, { value: 'antigravity', label: 'Antigravity' }]} />
        <CopyBlock label={snippet.file} text={snippet.text} />
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-label-md font-normal text-slate-500">
          <span>{tr('Mã dự án:')}</span> <code className="break-all rounded bg-slate-100 px-1 text-slate-700">{projectId}</code>
          <Info>{tr('Sau khi thêm, mở agent trong thư mục repo của dự án rồi yêu cầu, ví dụ: "Dùng TaskFlow quét bảo mật dự án này", "Hỏi TaskFlow: việc nào đang quá hạn?" hoặc "Lập kế hoạch làm trang thanh toán rồi gửi về TaskFlow". Lệnh có sẵn: security_review, review_pr, suggest_next, ask_project, make_plan, meeting_to_tasks.')}</Info>
        </div>
        <p className="text-label-md font-normal text-slate-500">
          {tr('Lệnh cài chỉ ghi vào tài khoản Windows của bạn. Gỡ cài đặt:')} <code className="break-all rounded bg-slate-100 px-1 text-slate-700">node "{runnerPath}" uninstall</code>
        </p>
      </Fold>
    </div>
  );
}

/** Thẻ repo gọn: chưa kết nối thì chỉ một nút, bấm mới mở form. */
function RepoCard({ projectId, conn, canManage, onChange }) {
  const [editing, setEditing] = useState(false);
  const save = (connection) => { onChange(connection); setEditing(false); };
  if (editing && canManage) return <ConnectForm projectId={projectId} current={conn} onSaved={save} onCancel={() => setEditing(false)} />;
  if (conn) return <ConnectionCard projectId={projectId} conn={conn} canManage={canManage} onChange={save} onEdit={() => setEditing(true)} />;
  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-label-lg font-semibold text-slate-900"><Icon name="link" size={18} className="text-blue-600" />{tr(' Repo GitHub')}</p>
        {canManage && <button className="btn-outline btn-sm" onClick={() => setEditing(true)}>{tr('Kết nối')}</button>}
      </div>
      <p className="text-body-sm text-slate-500">{tr('Để agent đọc code và đối chiếu bảng công việc.')}</p>
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
  const runner = useRunner();

  if (repo.loading && !repo.data) return <PageLoader />;
  if (repo.error) return <ErrorBox error={repo.error} onRetry={repo.reload} />;
  const { connection: conn, settings, canManage } = repo.data;
  const setConnection = (connection) => repo.setData((d) => ({ ...d, connection }));
  const updateRun = (run) => runs.setData((d) => ({ ...d, runs: d.runs.map((r) => (r._id === run._id ? run : r)) }));
  const addRun = (run) => {
    runs.setData((d) => ({ ...d, runs: [run, ...(d?.runs || [])] }));
    onUsage();
  };

  return (
    <div className="space-y-4">
      <RunnerStatus {...runner} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SetupCard projectId={project._id} />
        <div className="min-w-0 space-y-4">
          <RepoCard projectId={project._id} conn={conn} canManage={canManage} onChange={setConnection} />
          <DailyCard projectId={project._id} settings={settings} canManage={canManage} disabled={disabled} onSettings={(s) => repo.setData((d) => ({ ...d, settings: s }))} onRun={addRun} />
        </div>
      </div>
      {conn && <ProgressCard key={conn.updatedAt} projectId={project._id} />}
      {runs.error && <ErrorBox error={runs.error} onRetry={runs.reload} />}
      {runs.data?.runs?.length
        ? runs.data.runs.map((run) => <RunCard key={run._id} run={run} canManage={canManage} onUpdate={updateRun} />)
        : !runs.loading && !runs.error && (
          <div className="card flex items-center gap-3 px-4 py-3 text-body-sm">
            <Icon name="inbox" size={18} className="text-slate-400" />
            <span className="flex-1 text-slate-700">{tr('Kết quả agent gửi về (báo cáo, review, gợi ý)')}</span>
            <span className="text-label-md font-normal text-slate-400">{tr('Chưa có')}</span>
          </div>
        )}
    </div>
  );
}
