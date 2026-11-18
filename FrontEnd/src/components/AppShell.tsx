import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ProjectSummary, UserSummary } from '../lib/app-context.ts';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApp, useToast } from '../lib/app.jsx';
import { t as tr, useI18n } from '../lib/i18n.js';
import { PROJECT_COLOR, ROLE } from '../lib/format.js';
import { Avatar, DialogFocus, Dropdown, Icon, MenuItem, StatusChip } from './ui.jsx';
import CreateTaskModal from './CreateTaskModal.jsx';
import TaskDetailModal from './TaskDetailModal.jsx';
import DeletionBanner from './DeletionBanner.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import ConnectionStatus from './ConnectionStatus.jsx';
import RecentProjects from './RecentProjects.jsx';

const NAV = [
  { to: '/overview', icon: 'dashboard', get label() { return tr("Tổng quan"); }, en: 'Overview' },
  { to: '/board', icon: 'view_kanban', get label() { return tr("Bảng công việc"); }, en: 'Board' },
  { to: '/my-tasks', icon: 'task_alt', get label() { return tr("Việc của tôi"); }, en: 'My tasks', badge: 'mine' },
  { to: '/calendar', icon: 'calendar_month', get label() { return tr('Tiến độ & lịch'); }, en: 'Schedule' },
  { to: '/team', icon: 'group', get label() { return tr('Tải thành viên'); }, en: 'Team workload' },
  { to: '/documents', icon: 'description', get label() { return tr("Tài liệu"); }, en: 'Documents' },
  { to: '/ai', icon: 'auto_awesome', get label() { return tr("Trợ lý AI"); }, en: 'AI assistant', ai: true },
];

const SCHEDULE_PATHS = ['/calendar', '/timeline', '/sprints', '/meetings'];
const OVERVIEW_PATHS = ['/overview', '/reports', '/ai/report', '/risks', '/issues', '/contributions'];
function navIsActive(to: string, pathname: string) {
  if (to === '/calendar') return SCHEDULE_PATHS.includes(pathname);
  if (to === '/overview') return OVERVIEW_PATHS.includes(pathname);
  if (to === '/ai') return pathname.startsWith('/ai') && pathname !== '/ai/report';
  return pathname === to;
}

function SectionNavigation() {
  const { pathname } = useLocation();
  useI18n();
  const schedule = SCHEDULE_PATHS.includes(pathname);
  if (!schedule && !OVERVIEW_PATHS.includes(pathname)) return null;
  const tabs = schedule
    ? [{ to: '/calendar', label: tr('Lịch công việc'), icon: 'calendar_month' }, { to: '/timeline', label: tr('Kế hoạch & thực tế'), icon: 'timeline' }, { to: '/sprints', label: tr('Sprint & Backlog'), icon: 'sprint' }, { to: '/meetings', label: tr('Lịch họp'), icon: 'event' }]
    : [{ to: '/overview', label: tr('Tổng quan'), icon: 'dashboard' }, { to: '/reports', label: tr('Báo cáo'), icon: 'bar_chart' }, { to: '/risks', label: tr('Cảnh báo rủi ro'), icon: 'warning' }, { to: '/issues', label: tr('Vấn đề'), icon: 'flag' }, { to: '/contributions', label: tr('Đóng góp'), icon: 'groups' }];
  return <nav aria-label={schedule ? tr('Tiến độ & lịch') : tr('Tổng quan dự án')} className="flex flex-wrap gap-2 border-b border-slate-200 bg-white px-4 py-3 lg:px-6">
    {tabs.map((tab) => {
      const active = pathname === tab.to || (tab.to === '/reports' && pathname === '/ai/report');
      return <Link key={tab.to} to={tab.to} aria-current={active ? 'page' : undefined} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-label-md font-semibold ${active ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}><Icon name={tab.icon} size={17} />{tab.label}</Link>;
    })}
  </nav>;
}

const CRUMBS: Record<string, string[]> = {
  get '/timeline'() { return [tr('Tiến độ & lịch'), tr('Kế hoạch & thực tế')]; },
  get '/team'() { return [tr('Tải thành viên')]; },
  get '/meetings'() { return [tr('Tiến độ & lịch'), tr('Lịch họp')]; },
  get '/overview'() { return [tr("Tổng quan")]; },
  get '/board'() { return [tr("Bảng Kanban")]; },
  get '/my-tasks'() { return [tr("Việc của tôi")]; },
  get '/calendar'() { return [tr('Tiến độ & lịch'), tr('Lịch công việc')]; },
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
const PROJECT_SCOPED = ['/overview', '/board', '/calendar', '/documents', '/ai', '/reports', '/risks', '/timeline', '/meetings'];

function SearchBox() {
  useI18n();
  const { wsId, setProjectId } = useApp();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ projects: ProjectSummary[]; tasks: { _id: string; key: string; title: string; status: string; project: { _id: string } }[] } | null>(null);
  const [open, setOpen] = useState(false);
  // Dưới lg ô tìm kiếm thu thành nút kính lúp; bấm vào thì mở thành thanh ngang dưới topbar.
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [active, setActive] = useState(-1);
  const listId = useId();
  const pick = () => { setQ(''); setExpanded(false); setOpen(false); setActive(-1); };
  const choices = [
    ...(res?.projects || []).map((p) => ({ id: p._id, run: () => { setProjectId(p._id); navigate('/overview'); pick(); } })),
    ...(res?.tasks || []).map((t) => ({ id: t._id, run: () => { setProjectId(t.project._id); navigate(`?task=${t._id}`); pick(); } })),
  ];
  const optId = (i: number) => `${listId}-opt-${i}`;
  const showList = open && !!res;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setExpanded(true);
        setTimeout(() => ref.current?.focus());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!q.trim() || !wsId) return setRes(null);
    const t = setTimeout(() => api.get<NonNullable<typeof res>>(`/workspaces/${wsId}/search?q=${encodeURIComponent(q)}`).then((r) => { setRes(r); setActive(-1); }).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [q, wsId]);
  return (
    <>
    <button type="button" className="icon-btn lg:hidden" aria-label={tr("Tìm kiếm")} title={tr("Tìm kiếm")} aria-expanded={expanded} onClick={() => { setExpanded(true); setTimeout(() => ref.current?.focus()); }}>
      <Icon name="search" />
    </button>
    <div className={`${expanded ? 'fixed inset-x-0 top-[60px] z-50 block border-b border-slate-200 bg-white px-3 py-2 shadow-pop' : 'hidden'} lg:relative lg:inset-auto lg:top-auto lg:z-auto lg:mx-6 lg:block lg:max-w-md lg:flex-1 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none`}>
    <div className="relative">
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
      <input
        ref={ref}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => { setOpen(false); setExpanded(false); }, 150)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setExpanded(false); ref.current?.blur(); return; }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!choices.length) return;
            e.preventDefault();
            setOpen(true);
            setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % choices.length : i <= 0 ? choices.length - 1 : i - 1));
          } else if (e.key === 'Enter' && showList && choices[active]) {
            e.preventDefault();
            choices[active].run();
          }
        }}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList && choices.length > 0}
        aria-controls={showList && choices.length > 0 ? listId : undefined}
        aria-activedescendant={showList && active >= 0 && active < choices.length ? optId(active) : undefined}
        aria-label={tr("Tìm kiếm công việc")}
        className="input h-9 rounded-lg bg-slate-50 pl-9 pr-12 text-body-sm"
        placeholder={tr("Tìm kiếm công việc... (⌘K)")}
      />
      <kbd className="pointer-events-none absolute right-2.5 hidden lg:block top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-400">⌘K</kbd>
      {showList && res && (
        <div id={choices.length ? listId : undefined} role={choices.length ? 'listbox' : undefined} aria-label={choices.length ? tr("Kết quả tìm kiếm") : undefined} className="absolute left-0 right-0 top-11 z-50 rounded-xl border border-slate-200 bg-white p-1.5 shadow-pop">
          {!res.tasks.length && !res.projects.length && <p role="status" className="px-3 py-4 text-center text-body-sm text-slate-500">{tr("Không có kết quả")}</p>}
          {res.projects.map((p, i) => (
            <button
              key={p._id}
              id={optId(i)}
              role="option"
              aria-selected={active === i}
              tabIndex={-1}
              onMouseDown={() => choices[i].run()}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-body-sm hover:bg-slate-50 ${active === i ? 'bg-slate-100' : ''}`}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${PROJECT_COLOR[p.color]}`} />
              {p.name}
            </button>
          ))}
          {res.tasks.map((t, j) => (
            <button
              key={t._id}
              id={optId(res.projects.length + j)}
              role="option"
              aria-selected={active === res.projects.length + j}
              tabIndex={-1}
              onMouseDown={() => choices[res.projects.length + j].run()}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-body-sm hover:bg-slate-50 ${active === res.projects.length + j ? 'bg-slate-100' : ''}`}
            >
              <span className="font-mono text-label-md text-slate-400">{t.key}</span>
              <span className="flex-1 truncate">{t.title}</span>
              <StatusChip status={t.status} />
            </button>
          ))}
        </div>
      )}
    </div>
    </div>
    </>
  );
}

function TopBar({ onToggleSidebar, onCreate, sidebarOpen }: { onToggleSidebar: () => void; onCreate: () => void; sidebarOpen: boolean }) {
  const { me, ws, role, unread, logout, theme, toggleTheme, project, canManageProject, pendingDeletion } = useApp();
  const { language: lang, setLanguage: setLang } = useI18n();
  const { setMe } = useApp();
  const toast = useToast();
  const languagePending = useRef(false);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const loc = useLocation();
  const navigate = useNavigate();
  const base = '/' + loc.pathname.split('/')[1];
  const crumbs = loc.pathname === '/ai/report' ? [tr('Tổng quan'), tr('Báo cáo')] : CRUMBS[base] || [];
  const settingsTab = loc.pathname.split('/')[2];
  const settingsLabels: Record<string, string> = { members: tr('Thành viên & Phân quyền'), invites: tr('Lời mời'), ai: tr('Cài đặt AI'), activity: tr('Nhật ký hoạt động'), general: tr('Thông tin chung') };
  const tail = base === '/settings' ? settingsLabels[settingsTab] : null;

  const changeLang = async (l: string) => {
    if (languagePending.current || l === lang) return;
    languagePending.current = true;
    setSavingLanguage(true);
    setLang(l);
    try {
      const data = await api.patch<{ user: UserSummary }>('/me', { language: l });
      setMe(data.user);
    } catch (error) { toast(error instanceof Error ? error.message : tr('Đã có lỗi xảy ra'), 'error'); }
    finally { languagePending.current = false; setSavingLanguage(false); }
  };

  return (
    <header className="sticky top-0 z-40 flex h-[60px] shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button className="icon-btn" onClick={onToggleSidebar} title={tr("Thu gọn / Mở rộng sidebar")} aria-label={tr("Mở/đóng menu")} aria-expanded={sidebarOpen}>
          {/* Biểu tượng ☰ xoay và đổi thành "menu_open" khi menu đang mở */}
          <span className="relative h-5 w-5">
            <Icon name="menu" className={`absolute inset-0 transition-all duration-300 ${sidebarOpen ? 'rotate-90 scale-50 opacity-0' : 'opacity-100'}`} />
            <Icon name="menu_open" className={`absolute inset-0 transition-all duration-300 ${sidebarOpen ? 'opacity-100' : '-rotate-90 scale-50 opacity-0'}`} />
          </span>
        </button>
        <Link to="/overview" className="flex shrink-0 items-center gap-2" aria-label="TaskFlow">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
            <Icon name="task_alt" size={17} />
          </span>
          <span className="hidden text-headline-sm font-bold tracking-tight text-slate-900 sm:inline">TaskFlow</span>
        </Link>
        <div className="mx-1 hidden h-4 w-px bg-slate-200 lg:block" />
        <nav className="hidden min-w-0 items-center gap-1.5 whitespace-nowrap text-body-sm text-slate-500 lg:flex">
          <span className="truncate">{base === '/admin' ? tr("Hệ thống") : tr("Không gian làm việc")}</span>
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
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
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
        <span className="hidden sm:inline-flex" title={canManageProject ? undefined : pendingDeletion ? tr("Workspace đang chờ xóa nên chỉ được xem.") : tr("Chỉ PM của dự án tạo được công việc. Thành viên cập nhật việc được giao cho mình.")}>
          <button className="btn-primary" onClick={onCreate} disabled={!canManageProject}>
            <Icon name="add" size={16} />{tr("Tạo công việc")}</button>
        </span>
        <div className="h-4 w-px bg-slate-200" />
        <Dropdown
          trigger={
            <button className="flex items-center gap-2.5 pl-1">
              <Avatar user={me} size={32} />
              <span className="hidden flex-col text-left xl:flex">
                <span className="whitespace-nowrap text-label-md font-semibold leading-none text-slate-900">{me?.name}</span>
                <span className="whitespace-nowrap text-[11px] leading-tight text-slate-500">{me?.title || (role && ROLE[role]) || ''}</span>
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

function Sidebar({ collapsed, overlay, onClose }: { collapsed: boolean; overlay: boolean; onClose: () => void }) {
  useI18n();
  const { ws, workspaces, setWsId, activeProjects, project, setProjectId, me, role, reloadWorkspace, pendingDeletion } = useApp();
  const navItems = workspaces.some((w) => w.isMentor)
    ? [...NAV, { to: '/mentoring', icon: 'school', get label() { return tr('Các nhóm hướng dẫn'); }, en: 'My groups' }]
    : NAV;
  const [mine, setMine] = useState(0);
  const navigate = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    if (!ws) return;
    api
      .get<{ summary: { today: number; overdue: number } }>(`/workspaces/${ws.workspace._id}/my-tasks?limit=1`)
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
                <span className="truncate text-label-lg font-semibold text-slate-900">{wsName || tr("Chưa có workspace")}</span>
                {ws && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">{ws.workspace.plan || 'Pro'}</span>}
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

        {!ws && (
          <p className="rounded-lg bg-slate-50 p-3 text-body-sm text-slate-500">{tr("Bạn chưa thuộc workspace nào. Tạo workspace mới hoặc nhờ Owner/Admin mời để dùng bảng công việc, dự án và trợ lý AI.")}</p>
        )}
        {ws && <>
        <div>
          <div className="section-label mb-1.5 px-2">{tr("Điều hướng")}</div>
          <nav className="space-y-0.5">
            {navItems.map((n, i) => (
              <NavLink
                key={n.to}
                to={n.to}
                style={{ animationDelay: `${i * 35}ms` }}
                className={() => `nav-item animate-fade-up ${navIsActive(n.to, loc.pathname) ? 'nav-item-active' : ''} justify-between`}
              >
                {() => (
                  <>
                    <span className="flex items-center gap-2.5">
                      <Icon name={n.icon} className={n.ai ? 'text-purple-500' : navIsActive(n.to, loc.pathname) ? 'text-blue-600' : 'text-slate-400'} />
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
              <button disabled={!['owner', 'admin'].includes(role ?? '')} className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40" title={['owner', 'admin'].includes(role ?? '') ? tr("Thêm dự án") : pendingDeletion ? tr("Workspace đang chờ xóa nên chỉ được xem.") : tr("Chỉ Owner/Admin của workspace tạo được dự án")} onClick={() => navigate('/projects?new=1')}>
                <Icon name="add" size={15} />
              </button>
            </span>
          </div>
          <RecentProjects
            projects={activeProjects}
            current={project}
            wsId={ws?.workspace?._id}
            role={role}
            setProjectId={setProjectId}
            reloadWorkspace={reloadWorkspace}
            onOpen={(p: ProjectSummary) => {
              setProjectId(p._id);
              if (!PROJECT_SCOPED.includes('/' + loc.pathname.split('/')[1])) navigate('/overview');
            }}
          />
        </div>
        </>}
      </div>
      <div className="space-y-0.5 border-t border-slate-100 p-3">
        {me?.isSystemAdmin && (
          <NavLink to="/admin" className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}>
            <Icon name="admin_panel_settings" className="text-slate-400" />{tr("Quản trị hệ thống")}</NavLink>
        )}
        {ws && <NavLink to="/settings/members" className={({ isActive }) => `nav-item ${isActive || loc.pathname.startsWith('/settings') ? 'nav-item-active' : ''}`}>
          <Icon name="settings" className="text-slate-400" />{tr("Cài đặt Workspace")}</NavLink>}
        <a href="https://github.com/Thuan20Vnx/OJT202#readme" target="_blank" rel="noreferrer noopener" className="nav-item" title={tr("Mở hướng dẫn sử dụng (README) của TaskFlow")}>
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
function usePresence(open: boolean, ms: number) {
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
  const urlTaskId = params.get('task');
  // Chi tiết việc còn thay đổi chưa lưu mà URL đổi (nút Quay lại, bấm link khác) thì giữ hộp chi tiết lại và hỏi trước.
  const [taskId, setTaskId] = useState(urlTaskId);
  const taskDirty = useRef(false);
  const [leaveRequest, setLeaveRequest] = useState<{ search: string; pathname: string } | null>(null);
  const shownTask = useRef(taskId);
  shownTask.current = taskId;
  useEffect(() => {
    if (urlTaskId === shownTask.current) { setLeaveRequest(null); return; }
    if (shownTask.current && taskDirty.current) setLeaveRequest({ search: loc.search, pathname: loc.pathname });
    else setTaskId(urlTaskId);
  }, [urlTaskId, loc.search, loc.pathname]);
  const onTaskDirty = useCallback((d: boolean) => { taskDirty.current = d; }, []);
  const closeTask = () => {
    taskDirty.current = false;
    params.delete('task');
    setTaskId(null);
    navigate({ search: params.toString() }, { replace: true });
  };
  const leaveTask = () => {
    taskDirty.current = false;
    setLeaveRequest(null);
    setTaskId(urlTaskId);
  };
  const stayOnTask = () => {
    const next = new URLSearchParams(loc.search);
    if (taskId) next.set('task', taskId);
    setLeaveRequest(null);
    navigate({ pathname: loc.pathname, search: next.toString() }, { replace: true });
  };
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar onToggleSidebar={() => setCollapsed((c) => !c)} onCreate={() => setCreating(true)} sidebarOpen={!collapsed} />
      <ConnectionStatus />
      <DeletionBanner />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar collapsed={collapsed} overlay={narrow} onClose={() => setCollapsed(true)} />
        <main id="main-content" className="scroll-thin min-w-0 flex-1 overflow-y-auto bg-slate-50">
          <ErrorBoundary key={loc.pathname}>
            <SectionNavigation />
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <CreateTaskModal open={creating} onClose={() => setCreating(false)} />
      {taskId && <DialogFocus key={taskId}><TaskDetailModal taskId={taskId} onClose={closeTask} onDirtyChange={onTaskDirty} leaveRequest={leaveRequest} onLeave={leaveTask} onStay={stayOnTask} /></DialogFocus>}
    </div>
  );
}
