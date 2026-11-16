import { t as tr, useI18n } from '../../lib/i18n.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Dropdown, Icon, MenuItem, Notice, Spinner } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';

export const AGENT_LABELS = { antigravity: 'Antigravity', claude: 'Claude Code', codex: 'Codex' };
const AGENT_ORDER = ['antigravity', 'claude', 'codex'];
const STORAGE_KEY = 'taskflow.agent';
const ENGINE_KEY = 'taskflow.engine';
const FINAL = ['done', 'failed', 'cancelled'];

const savedAgent = () => {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return AGENT_ORDER.includes(value) ? value : 'antigravity';
  } catch {
    return 'antigravity';
  }
};

/**
 * Giao việc cho agent trên máy của chính người dùng (runner "npm run agent") và chờ kết quả.
 * onDone(job) được gọi khi agent đã gửi kết quả về: job.resultId là bản nháp hoặc cuộc hỏi đáp.
 */
export function useAgentRun({ project, onDone }) {
  const [runner, setRunner] = useState(null);
  const [agent, setAgentState] = useState(savedAgent);
  // engine: 'agent' = agent trên máy (không tính lượt), 'team' = AI của nhóm qua API (tính lượt).
  const [engine, setEngineState] = useState(() => {
    try { return localStorage.getItem(ENGINE_KEY) === 'team' ? 'team' : 'agent'; } catch { return 'agent'; }
  });
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const done = useRef(onDone);
  done.current = onDone;
  const active = job && !FINAL.includes(job.status);

  useEffect(() => {
    let alive = true;
    const load = () => api.get('/agent/runner').then((d) => alive && setRunner(d.runner)).catch((e) => alive && setRunner((r) => (r && !r.unsupported && e.status !== 404 ? r : { online: false, agents: [], unsupported: e.status === 404 })));
    load();
    const timer = setInterval(load, 8000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  // Đổi dự án thì bỏ theo dõi việc cũ (việc vẫn chạy, kết quả nằm trong lịch sử).
  useEffect(() => { setJob(null); setError(null); }, [project._id]);

  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const d = await api.get(`/agent/jobs/${job._id}`);
        if (!alive) return;
        setJob(d.job);
        if (d.job.status === 'done') done.current?.(d.job);
        if (d.job.status === 'failed') setError({ message: d.job.error || tr('Agent không hoàn thành việc này.') });
      } catch (e) {
        if (alive && e.status === 404) { setJob(null); setError(e); }
      }
    }, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, [active, job?._id]);

  const setAgent = useCallback((value) => {
    setAgentState(value);
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* không lưu được thì chỉ dùng cho phiên này */ }
  }, []);
  const setEngine = useCallback((value) => {
    setEngineState(value);
    try { localStorage.setItem(ENGINE_KEY, value); } catch { /* chỉ dùng cho phiên này */ }
  }, []);
  const start = useCallback(async (kind, input) => {
    setError(null);
    try {
      const d = await api.post(`/projects/${project._id}/agent/jobs`, { kind, agent, input });
      setJob(d.job);
      return d.job;
    } catch (e) {
      setError(e);
      return null;
    }
  }, [project._id, agent]);
  const cancel = useCallback(async () => {
    if (!job) return;
    try {
      const d = await api.post(`/agent/jobs/${job._id}/cancel`, {});
      setJob(d.job);
    } catch (e) {
      setError(e);
    }
  }, [job]);

  return { runner, agent, setAgent, engine, setEngine, job, active, error, start, cancel };
}

function Elapsed({ since }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 1000));
  return <span className="tabular-nums">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>;
}

const SOURCE_KEY = 'taskflow.codeSource';
const SOURCES = ['auto', 'none', 'github', 'local'];
const SOURCE_LABELS = {
  get auto() { return tr('Đọc code: tự chọn'); },
  get none() { return tr('Không đọc code'); },
  get github() { return tr('Đọc code trên GitHub'); },
  get local() { return tr('Đọc code trên máy'); },
};

/** Nơi agent đọc code (lưu lựa chọn trên trình duyệt) và repo đã kết nối của dự án. */
export function useCodeSource(project) {
  const [source, setSourceState] = useState(() => {
    try {
      const value = localStorage.getItem(SOURCE_KEY);
      return SOURCES.includes(value) ? value : 'auto';
    } catch {
      return 'auto';
    }
  });
  const [repo, setRepo] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get(`/projects/${project._id}/repo`).then((d) => alive && setRepo(d.connection), () => alive && setRepo(null));
    return () => { alive = false; };
  }, [project._id]);
  const setSource = useCallback((value) => {
    setSourceState(value);
    try { localStorage.setItem(SOURCE_KEY, value); } catch { /* chỉ dùng cho phiên này */ }
  }, []);
  return { source: source === 'github' && repo === null ? 'auto' : source, setSource, repo };
}

/** Chọn nơi agent đọc code: tự chọn theo câu chữ, không đọc, repo GitHub đã kết nối, hoặc thư mục dự án trên máy. */
export function CodeSourcePicker({ code, disabled, className = '' }) {
  useI18n();
  const { source, setSource, repo } = code;
  const hint = {
    auto: tr('Nhắc "GitHub" hoặc "repo" thì đọc repo, nhắc "code" hoặc "trên máy" thì đọc thư mục dự án trên máy, còn lại chỉ dùng dữ liệu TaskFlow.'),
    none: tr('Agent chỉ dùng công việc, bình luận và tài liệu trong TaskFlow.'),
    github: repo ? tr('Runner tải bản mới nhất của {0} về máy (bằng git của bạn) rồi cho agent đọc.', [repo.repoPath]) : '',
    local: tr('Agent đọc thư mục dự án bạn khai báo khi cài agent (tab Agent dự án). Chỉ đọc, không sửa file.'),
  }[source];
  return (
    <Dropdown
      width="w-72"
      align="left"
      trigger={(
        <button type="button" className={`inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-label-md font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 ${className}`} disabled={disabled} title={hint}>
          <Icon name={source === 'github' ? 'cloud' : source === 'local' ? 'folder_open' : source === 'none' ? 'code_off' : 'code'} size={16} />
          {SOURCE_LABELS[source]}
          <Icon name="arrow_drop_down" size={16} />
        </button>
      )}
    >
      {SOURCES.map((id) => (
        <MenuItem key={id} icon={id === source ? 'check' : 'code'} disabled={id === 'github' && !repo} onClick={() => setSource(id)}>
          <span className="flex-1">{SOURCE_LABELS[id]}</span>
          {id === 'github' && !repo && <span className="text-label-md font-normal text-slate-400">{tr('chưa kết nối repo')}</span>}
        </MenuItem>
      ))}
    </Dropdown>
  );
}

/** Nút hai phần: bấm để giao việc cho agent đang chọn (mặc định Antigravity), mũi tên để chọn agent khác. */
export function AgentSplitButton({ run, onRun, disabled, label, icon = 'robot_2', primary = false, height = 'h-10', className = '' }) {
  useI18n();
  const { runner, agent, setAgent, active } = run;
  const online = !!runner?.online;
  const available = online && runner.agents.includes(agent);
  const btn = primary ? 'btn-primary' : 'btn-outline';
  return (
    <div className={`flex ${className}`}>
      <button
        type="button"
        className={`${btn} ${height} min-w-0 flex-1 rounded-r-none`}
        onClick={onRun}
        disabled={disabled || active || !available}
        title={tr('Agent trên máy bạn làm việc này bằng gói của bạn, không tốn lượt AI của nhóm')}
      >
        {active ? <Spinner /> : <Icon name={icon} size={18} />}
        <span className="truncate">{label ?? tr('Chạy bằng {0}', [AGENT_LABELS[agent]])}</span>
      </button>
      <Dropdown
        width="w-64"
        trigger={(
          <button type="button" className={`${btn} -ml-px ${height} rounded-l-none px-2 ${primary ? 'border-l border-blue-500' : ''}`} disabled={active} aria-label={tr('Chọn agent khác')} title={tr('Chọn agent khác (đang dùng {0})', [AGENT_LABELS[agent]])}>
            <Icon name="arrow_drop_down" size={20} />
          </button>
        )}
      >
        {AGENT_ORDER.map((id) => {
          const ready = online && runner.agents.includes(id);
          return (
            <MenuItem key={id} icon={id === agent ? 'check' : 'robot_2'} onClick={() => setAgent(id)}>
              <span className="flex-1">{AGENT_LABELS[id]}</span>
              {!ready && <span className="text-label-md font-normal text-slate-400">{tr('chưa sẵn sàng')}</span>}
            </MenuItem>
          );
        })}
      </Dropdown>
    </div>
  );
}

/** Trạng thái việc đang giao, gợi ý bật agent và lỗi: đặt dưới nút chạy. */
export function AgentRunStatus({ run, className = '', hideOffline = false }) {
  useI18n();
  const { runner, agent, job, active, error, cancel } = run;
  const online = !!runner?.online;
  const available = online && runner.agents.includes(agent);
  const label = AGENT_LABELS[agent];
  const SOURCE_WORK = { github: tr(' (đọc code trên GitHub)'), local: tr(' (đọc code trên máy)') };
  return (
    <div className={`space-y-2 empty:hidden ${className}`}>
      {active && (
        <p className="flex items-center gap-2 text-label-md font-normal text-slate-500">
          <span className="flex-1">
            {job.status === 'queued' ? tr('Đang chờ {0} nhận việc…', [AGENT_LABELS[job.agent]]) : tr('{0} đang làm việc{1}…', [AGENT_LABELS[job.agent], SOURCE_WORK[job.source] || ''])} <Elapsed since={job.createdAt} />
          </span>
          <button type="button" className="font-medium text-rose-600 hover:underline" onClick={cancel}>{tr('Hủy')}</button>
        </p>
      )}
      {!active && runner?.unsupported && <p className="text-label-md font-normal text-amber-700">{tr('Máy chủ TaskFlow đang chạy bản cũ, chưa hỗ trợ giao việc cho agent. Hãy khởi động lại BackEnd rồi tải lại trang.')}</p>}
      {!active && !hideOffline && runner && !online && !runner.unsupported && (
        <p className="text-label-md font-normal text-slate-500">
          {tr('Agent trên máy chưa bật.')} <a className="font-medium text-blue-600 hover:underline" href="taskflow://start">{tr('Bật agent')}</a>
          {tr(' · Chưa cài thì xem tab Agent dự án, hoặc chạy trong terminal:')} <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-700">npm run agent</code>
        </p>
      )}
      {!active && online && !available && <p className="text-label-md font-normal text-slate-500">{tr('Máy đang chạy runner chưa có {0}. Bấm mũi tên để chọn agent khác.', [label])}</p>}
      {error && !active && <Notice tone="danger">{error.message}</Notice>}
    </div>
  );
}

/**
 * Chữ "i" đặt cạnh tiêu đề: bấm để mở/đóng phần giải thích. Đặt trong khung flex-wrap; phần chữ tự xuống dòng riêng.
 */
export function Info({ children }) {
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

/** Thanh trạng thái mỏng đầu màn: agent trên máy đang bật hay tắt, và nơi agent đọc code. */
export function AgentBar({ run, code }) {
  useI18n();
  const { runner } = run;
  const online = !!runner?.online;
  return (
    <div className="card flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
      <Icon name="computer" size={20} className={online ? 'text-emerald-600' : 'text-slate-400'} />
      <p className="min-w-0 flex-1 text-body-sm text-slate-800">
        {tr('Agent trên máy')}
        <span className="text-label-md font-normal text-slate-500">
          {' · '}{!runner ? tr('đang kiểm tra…') : online ? tr('đang bật: {0}', [runner.agents.map((a) => AGENT_LABELS[a]).join(', ') || tr('chưa có agent')]) : tr('đang tắt')}
        </span>
        {runner && !online && !runner.unsupported && <a className="ml-2 text-label-md font-medium text-blue-600 hover:underline" href="taskflow://start">{tr('Bật agent')}</a>}
      </p>
      {code && <CodeSourcePicker code={code} disabled={run.active} />}
    </div>
  );
}

/**
 * Nút chính của màn: bấm để chạy bằng lựa chọn hiện tại; mũi tên mở menu chọn agent trên máy
 * hoặc AI của nhóm (onTeam, tính lượt). Dòng nhỏ bên dưới cho biết đang chạy bằng gì.
 */
export function RunButton({ run, label, icon = 'auto_awesome', onAgent, onTeam, disabled, busy, teamDisabled }) {
  useI18n();
  const { runner, agent, setAgent, engine, setEngine, active } = run;
  const team = engine === 'team' && !!onTeam;
  const online = !!runner?.online;
  const ready = (id) => online && runner.agents.includes(id);
  const blocked = disabled || active || busy || (team ? teamDisabled : !ready(agent));
  return (
    <div className="space-y-2">
      <div className="flex">
        <button type="button" className="btn-primary h-10 min-w-0 flex-1 rounded-r-none" onClick={team ? onTeam : onAgent} disabled={blocked}>
          {active || busy ? <Spinner /> : <Icon name={icon} size={18} />}
          <span className="truncate">{label}</span>
        </button>
        <Dropdown
          width="w-72"
          trigger={(
            <button type="button" className="btn-primary -ml-px h-10 rounded-l-none border-l border-blue-500 px-2" disabled={active || busy} aria-label={tr('Chọn cách chạy')} title={tr('Chọn cách chạy')}>
              <Icon name="arrow_drop_down" size={20} />
            </button>
          )}
        >
          <p className="px-2.5 pb-1 pt-1.5 text-label-md font-normal text-slate-400">{tr('Agent trên máy · không tính lượt')}</p>
          {AGENT_ORDER.map((id) => (
            <MenuItem key={id} icon={!team && id === agent ? 'check' : 'robot_2'} onClick={() => { setAgent(id); setEngine('agent'); }}>
              <span className="flex-1">{AGENT_LABELS[id]}</span>
              {!ready(id) && <span className="text-label-md font-normal text-slate-400">{tr('chưa sẵn sàng')}</span>}
            </MenuItem>
          ))}
          {onTeam && (
            <>
              <div className="my-1 border-t border-slate-100" />
              <MenuItem icon={team ? 'check' : 'cloud'} disabled={teamDisabled} onClick={() => setEngine('team')}>
                <span className="flex-1">{tr('AI của nhóm (Gemini)')}</span>
                <span className="text-label-md font-normal text-slate-400">{tr('tính lượt')}</span>
              </MenuItem>
            </>
          )}
        </Dropdown>
      </div>
      <p className="text-label-md font-normal text-slate-500">
        {team ? tr('Bằng AI của nhóm · tính 1 lượt') : tr('Bằng {0} trên máy · không tính lượt', [AGENT_LABELS[agent]])}
      </p>
      {(!team || run.active) && <AgentRunStatus run={run} hideOffline />}
    </div>
  );
}
