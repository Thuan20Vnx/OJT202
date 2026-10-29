import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApp, useToast } from '../lib/app.jsx';
import { t as tr, useI18n } from '../lib/i18n.js';
import { PROJECT_COLOR, ROLE } from '../lib/format.js';
import { Avatar, Dropdown, Icon, MenuItem, StatusChip } from './ui.jsx';
import CreateTaskModal from './CreateTaskModal.jsx';
import TaskDetailModal from './TaskDetailModal.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

const NAV = [
  { to: '/overview', icon: 'dashboard', get label() { return tr("Tổng quan"); }, en: 'Overview' },
  { to: '/board', icon: 'view_kanban', get label() { return tr("Bảng công việc"); }, en: 'Board' },
  { to: '/my-tasks', icon: 'task_alt', get label() { return tr("Việc của tôi"); }, en: 'My tasks', badge: 'mine' },
  { to: '/calendar', icon: 'calendar_month', get label() { return tr("Lịch dự án"); }, en: 'Calendar' },
  { to: '/documents', icon: 'description', get label() { return tr("Tài liệu"); }, en: 'Documents' },
  { to: '/ai', icon: 'auto_awesome', get label() { return tr("Trợ lý AI"); }, en: 'AI assistant', ai: true },
  { to: '/reports', icon: 'bar_chart', get label() { return tr("Báo cáo"); }, en: 'Reports' },
];

const CRUMBS = {
  get '/overview'() { return [tr("Tổng quan")]; },
  get '/board'() { return [tr("Bảng Kanban")]; },
  get '/my-tasks'() { return [tr("Việc của tôi")]; },
  get '/calendar'() { return [tr("Lịch dự án")]; },
  get '/documents'() { return [tr("Tài liệu")]; },
  get '/ai'() { return [tr("Trợ lý AI")]; },
  get '/reports'() { return [tr("Trợ lý AI")]; },
  get '/risks'() { return [tr("Tổng quan"), tr("Cảnh báo rủi ro")]; },
  get '/notifications'() { return [tr("Thông báo")]; },
  get '/projects'() { return [tr("Dự án")]; },
  get '/settings'() { return [tr("Cài đặt")]; },
  get '/profile'() { return [tr("Hồ sơ cá nhân")]; },
  get '/admin'() { return [tr("Quản trị hệ thống")]; },
};
const PROJECT_SCOPED = ['/overview', '/board', '/calendar', '/documents', '/ai', '/reports', '/risks'];

function SearchBox() {
  useI18n();
  const { wsId, setProjectId } = useApp();
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!q.trim() || !wsId) return setRes(null);
    const t = setTimeout(() => api.get(`/workspaces/${wsId}/search?q=${encodeURIComponent(q)}`).then(setRes).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [q, wsId]);
  return (
    <div className="relative mx-6 hidden max-w-md flex-1 lg:block">
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
      <input
        ref={ref}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="input h-9 rounded-lg bg-slate-50 pl-9 pr-12 text-body-sm"
        placeholder={tr("Tìm kiếm công việc... (⌘K)")}
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-400">⌘K</kbd>
      {open && res && (
        <div className="absolute left-0 right-0 top-11 z-50 rounded-xl border border-slate-200 bg-white p-1.5 shadow-pop">
          {!res.tasks.length && !res.projects.length && <p className="px-3 py-4 text-center text-body-sm text-slate-500">{tr("Không có kết quả")}</p>}
          {res.projects.map((p) => (
            <button
              key={p._id}
              onMouseDown={() => {
                setProjectId(p._id);
                navigate('/overview');
                setQ('');
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-body-sm hover:bg-slate-50"
            >
              <span className={`h-2.5 w-2.5 rounded-full ${PROJECT_COLOR[p.color]}`} />
              {p.name}
            </button>
          ))}
          {res.tasks.map((t) => (
            <button
              key={t._id}
              onMouseDown={() => {
                setProjectId(t.project._id);
                navigate(`?task=${t._id}`);
                setQ('');
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-body-sm hover:bg-slate-50"
            >
              <span className="font-mono text-label-md text-slate-400">{t.key}</span>
              <span className="flex-1 truncate">{t.title}</span>
              <StatusChip status={t.status} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TopBar({ onToggleSidebar, onCreate, sidebarOpen }) {
  const { me, ws, role, unread, logout, theme, toggleTheme, project, canManageProject } = useApp();
  const { language: lang, setLanguage: setLang } = useI18n();
  const { setMe } = useApp();
  const toast = useToast();
  const languagePending = useRef(false);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const loc = useLocation();
  const navigate = useNavigate();
  const base = '/' + loc.pathname.split('/')[1];
  const crumbs = CRUMBS[base] || [];
  const settingsTab = loc.pathname.split('/')[2];
  const tail = base === '/settings' ? { members: tr("Thành viên & Phân quyền"), invites: tr("Lời mời"), ai: tr("Cài đặt AI"), activity: tr("Nhật ký hoạt động"), general: tr("Thông tin chung") }[settingsTab] : null;

  const changeLang = async (l) => {
    if (languagePending.current || l === lang) return;
    languagePending.current = true;
    setSavingLanguage(true);
    setLang(l);
    try {
      const data = await api.patch('/me', { language: l });
      setMe(data.user);
    } catch (error) { toast(error.message, 'error'); }
    finally { languagePending.current = false; setSavingLanguage(false); }
  };

  return (
    <header className="sticky top-0 z-40 flex h-[60px] shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
      <div className="flex min-w-0 items-center gap-3">
        <button className="icon-btn" onClick={onToggleSidebar} title={tr("Thu gọn / Mở rộng sidebar")} aria-label={tr("Mở/đóng menu")} aria-expanded={sidebarOpen}>
          {/* Biểu tượng ☰ xoay và đổi thành "menu_open" khi menu đang mở */}
          <span className="relative h-5 w-5">
            <Icon name="menu" className={`absolute inset-0 transition-all duration-300 ${sidebarOpen ? 'rotate-90 scale-50 opacity-0' : 'opacity-100'}`} />
            <Icon name="menu_open" className={`absolute inset-0 transition-all duration-300 ${sidebarOpen ? 'opacity-100' : '-rotate-90 scale-50 opacity-0'}`} />
          </span>
        </button>
        <Link to="/overview" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
            <Icon name="task_alt" size={17} />
          </span>
          <span className="text-headline-sm font-bold tracking-tight text-slate-900">TaskFlow</span>
        </Link>
        <div className="mx-1 h-4 w-px bg-slate-200" />
        <nav className="hidden min-w-0 items-center gap-1.5 whitespace-nowrap text-body-sm text-slate-500 lg:flex">
          <span className="truncate">{base === '/admin' ? tr("Quản trị hệ thống") : tr("Không gian làm việc")}</span>
          {base === '/settings' && ws && (
            <>
              <Icon name="chevron_right" size={14} className="text-slate-400" />
              <span className="truncate">{ws.workspace.name}</span>
            </>
          )}
          {PROJECT_SCOPED.includes(base) && project && (
            <>
              <Icon name="chevron_right" size={14} className="text-slate-400" />
              <span className="truncate">{project.name}</span>
            </>
          )}
          {[...crumbs, ...(tail ? [tail] : [])].filter((c) => !(base === '/settings' && c === tr("Cài đặt"))).map((c, i, arr) => (
            <span key={c} className="flex items-center gap-1.5">
              <Icon name="chevron_right" size={14} className="text-slate-400" />
              <span className={i === arr.length - 1 ? 'font-semibold text-slate-900' : ''}>{c}</span>
            </span>
          ))}
        </nav>
      </div>
      <SearchBox />
      <div className="flex shrink-0 items-center gap-2.5">
        <div className="flex items-center rounded-lg bg-slate-100 p-0.5 text-label-sm" role="group" aria-label={tr("Ngôn ngữ")}>
          {['vi', 'en'].map((l) => (
            <button key={l} disabled={savingLanguage} aria-pressed={lang === l} onClick={() => changeLang(l)} className={`rounded-md px-2 py-1 font-bold uppercase ${lang === l ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>
              {l}
            </button>
          ))}
        </div>
        <button className="icon-btn" onClick={toggleTheme} title={tr("Chuyển chế độ sáng/tối")}>
          <Icon name={theme === 'dark' ? 'dark_mode' : 'light_mode'} />
        </button>
        <button className={`icon-btn relative ${base === '/notifications' ? 'bg-blue-50 text-blue-600' : ''}`} onClick={() => navigate('/notifications')} title={tr("Thông báo")}>
          <Icon name="notifications" />
          {unread > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />}
        </button>
        <button className="btn-primary hidden sm:inline-flex" onClick={onCreate} disabled={!canManageProject}>
          <Icon name="add" size={16} />{tr("Tạo công việc")}</button>
        <div className="h-4 w-px bg-slate-200" />
        <Dropdown
          trigger={
            <button className="flex items-center gap-2.5 pl-1">
              <Avatar user={me} size={32} />
              <span className="hidden flex-col text-left xl:flex">
                <span className="whitespace-nowrap text-label-md font-semibold leading-none text-slate-900">{me?.name}</span>
                <span className="whitespace-nowrap text-[11px] leading-tight text-slate-500">{me?.title || ROLE[role] || ''}</span>
              </span>
            </button>
          }
        >
          <div className="border-b border-slate-100 px-2.5 pb-2 pt-1">
            <p className="text-label-lg font-semibold text-slate-900">{me?.name}</p>
            <p className="truncate text-label-md font-normal text-slate-500">{me?.email}</p>
          </div>
          <MenuItem icon="person" onClick={() => navigate('/profile')}>{tr("Hồ sơ cá nhân")}</MenuItem>
          <MenuItem icon="settings" onClick={() => navigate('/settings/members')}>{tr("Cài đặt Workspace")}</MenuItem>
          {me?.isSystemAdmin && (
            <MenuItem icon="admin_panel_settings" onClick={() => navigate('/admin')}>{tr("Quản trị hệ thống")}</MenuItem>
          )}
          <MenuItem icon="logout" danger onClick={logout}>{tr("Đăng xuất")}</MenuItem>
        </Dropdown>
      </div>
    </header>
  );
}

function Sidebar({ collapsed, overlay, onClose }) {
  useI18n();
  const { ws, workspaces, setWsId, activeProjects, project, setProjectId, me, role } = useApp();
  const [mine, setMine] = useState(null);
  const navigate = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    if (!ws) return;
    api
      .get(`/workspaces/${ws.workspace._id}/my-tasks?limit=1`)
      .then((d) => setMine(d.summary.today + d.summary.overdue))
      .catch(() => {});
  }, [ws, loc.pathname]);

  // Overlay trên màn hình hẹp: tự đóng khi chuyển trang / đổi dự án (bỏ qua lần mount đầu)
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (overlay) onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname, project?._id]);

  const { mounted, shown } = usePresence(!collapsed, 300);
  if (!mounted) return null;
  const wsName = ws?.workspace?.name || '';
  const aside = (
    <aside
      className={`flex w-[260px] shrink-0 select-none flex-col justify-between border-r border-slate-200 bg-white ${
        overlay ? `fixed bottom-0 left-0 top-[60px] z-40 shadow-pop transition-transform duration-300 ease-out ${shown ? 'translate-x-0' : '-translate-x-full'}` : 'h-full'
      }`}
    >
      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto p-3">
        <Dropdown
          align="left"
          width="w-[236px]"
          trigger={
            <button className="flex w-full items-center justify-between rounded-xl border border-slate-200 p-2 text-left transition-colors hover:bg-slate-50">
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-label-md font-bold text-blue-600">{(wsName.match(/\d+/) || [wsName[0] || 'W'])[0]}</span>
                <span className="truncate text-label-lg font-semibold text-slate-900">{wsName}</span>
                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">{ws?.workspace?.plan || 'Pro'}</span>
              </span>
              <Icon name="unfold_more" size={16} className="text-slate-400" />
            </button>
          }
        >
          <p className="section-label px-2.5 py-1.5">{tr("Workspace của bạn")}</p>
          {workspaces.map((w) => (
            <MenuItem key={w._id} icon={w._id === ws?.workspace?._id ? 'check' : 'workspaces'} onClick={() => setWsId(w._id)}>
              <span className="truncate">{w.name}</span>
              <span className="ml-auto text-label-sm text-slate-400">{ROLE[w.role]}</span>
            </MenuItem>
          ))}
          <div className="my-1 border-t border-slate-100" />
          <MenuItem icon="add" onClick={() => navigate('/onboarding')}>{tr("Tạo workspace mới")}</MenuItem>
        </Dropdown>

        <div>
          <div className="section-label mb-1.5 px-2">{tr("Điều hướng")}</div>
          <nav className="space-y-0.5">
            {NAV.map((n, i) => (
              <NavLink
                key={n.to}
                to={n.to}
                style={{ animationDelay: `${i * 35}ms` }}
                className={({ isActive }) => `nav-item animate-fade-up ${isActive || (n.to === '/overview' && loc.pathname === '/risks') ? 'nav-item-active' : ''} justify-between`}
              >
                {({ isActive }) => (
                  <>
                    <span className="flex items-center gap-2.5">
                      <Icon name={n.icon} className={n.ai ? 'text-purple-500' : isActive ? 'text-blue-600' : 'text-slate-400'} />
                      <span>{n.label}</span>
                    </span>
                    {n.badge && mine > 0 && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-label-sm text-blue-800">{mine}</span>}
                    {n.ai && <span className="rounded bg-purple-100 px-1.5 text-[10px] font-bold text-purple-700">{tr("Mới")}</span>}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between px-2">
            <span className="section-label">{tr("Dự án gần đây")}</span>
            <span className="flex items-center gap-1">
              <NavLink to="/projects" className={({ isActive }) => `text-label-sm ${isActive ? 'font-semibold text-blue-700' : 'text-slate-400 hover:text-slate-700'}`}>{tr("Xem tất cả")}</NavLink>
              <button disabled={role === 'viewer'} className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40" title={tr("Thêm dự án")} onClick={() => navigate('/projects?new=1')}>
                <Icon name="add" size={15} />
              </button>
            </span>
          </div>
          <nav className="space-y-0.5">
            {activeProjects.map((p) => (
              <button
                key={p._id}
                onClick={() => {
                  setProjectId(p._id);
                  if (!PROJECT_SCOPED.includes('/' + loc.pathname.split('/')[1])) navigate('/overview');
                }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-body-sm transition-colors ${
                  project?._id === p._id ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${PROJECT_COLOR[p.color] || 'bg-blue-500'}`} />
                <span className="truncate">{p.name}</span>
              </button>
            ))}
            {!activeProjects.length && <p className="px-2.5 py-1.5 text-body-sm text-slate-400">{tr("Chưa có dự án")}</p>}
          </nav>
        </div>
      </div>
      <div className="space-y-0.5 border-t border-slate-100 p-3">
        {me?.isSystemAdmin && (
          <NavLink to="/admin" className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}>
            <Icon name="admin_panel_settings" className="text-slate-400" />{tr("Quản trị hệ thống")}</NavLink>
        )}
        <NavLink to="/settings/members" className={({ isActive }) => `nav-item ${isActive || loc.pathname.startsWith('/settings') ? 'nav-item-active' : ''}`}>
          <Icon name="settings" className="text-slate-400" />{tr("Cài đặt Workspace")}</NavLink>
        <a href="https://github.com" onClick={(e) => e.preventDefault()} className="nav-item" title={tr("Xem README trong thư mục dự án")}>
          <Icon name="help_outline" className="text-slate-400" />{tr("Trợ giúp & Tài liệu")}</a>
      </div>
    </aside>
  );
  // Màn hình rộng: co giãn bề rộng; màn hình hẹp: trượt vào từ trái + nền mờ hiện dần
  if (!overlay) {
    return (
      <div className="shrink-0 overflow-hidden transition-[width] duration-300 ease-out" style={{ width: shown ? 260 : 0 }}>
        {aside}
      </div>
    );
  }
  return (
    <>
      <div className={`fixed inset-0 top-[60px] z-30 bg-slate-900/30 transition-opacity duration-300 ${shown ? 'opacity-100' : 'opacity-0'}`} onClick={onClose} />
      {aside}
    </>
  );
}

/** Giữ phần tử trong DOM thêm `ms` khi đóng để chạy hiệu ứng ra; `shown` bật sau 1 khung hình để chạy hiệu ứng vào */
function usePresence(open, ms) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(t);
  }, [open, ms]);
  return { mounted, shown };
}

const isNarrow = () => typeof window !== 'undefined' && window.innerWidth < 1024;

export default function AppShell() {
  useI18n();
  const [narrow, setNarrow] = useState(isNarrow);
  const [collapsed, setCollapsed] = useState(isNarrow);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const onResize = () => {
      const n = isNarrow();
      setNarrow((prev) => {
        if (prev !== n) setCollapsed(n);
        return n;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const loc = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(loc.search);
  const taskId = params.get('task');
  const closeTask = () => {
    params.delete('task');
    navigate({ search: params.toString() }, { replace: true });
  };
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar onToggleSidebar={() => setCollapsed((c) => !c)} onCreate={() => setCreating(true)} sidebarOpen={!collapsed} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar collapsed={collapsed} overlay={narrow} onClose={() => setCollapsed(true)} />
        <main className="scroll-thin flex-1 overflow-y-auto bg-slate-50">
          <ErrorBoundary key={loc.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <CreateTaskModal open={creating} onClose={() => setCreating(false)} />
      {taskId && <TaskDetailModal key={taskId} taskId={taskId} onClose={closeTask} />}
    </div>
  );
}
