import { useI18n } from './i18n.js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, onUnauthorized } from './api.js';
import { closeSocket, getSocket, joinProject } from './socket.js';
import { setTimeZone } from './dates.js';
import { setLanguage } from './i18n.js';

export const AppCtx = createContext(null);
const ToastCtx = createContext(() => {});

const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
    } catch {
      /* bỏ qua khi trình duyệt chặn storage */
    }
  },
};

export function ToastProvider({ children }) {
  useI18n();
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, tone = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 top-[72px] z-[100] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-slide-in pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-white px-3.5 py-3 text-body-sm shadow-pop ${
              t.tone === 'error' ? 'border-rose-200' : t.tone === 'info' ? 'border-blue-200' : 'border-emerald-200'
            }`}
          >
            <span className={`material-symbols-outlined icon-fill !text-[18px] ${t.tone === 'error' ? 'text-rose-500' : t.tone === 'info' ? 'text-blue-600' : 'text-emerald-500'}`}>
              {t.tone === 'error' ? 'error' : t.tone === 'info' ? 'info' : 'check_circle'}
            </span>
            <span className="text-slate-700">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function AppProvider({ children }) {
  useI18n();
  const [me, setMeState] = useState(undefined); // undefined = đang tải, null = chưa đăng nhập
  const setMe = useCallback((user) => {
    setTimeZone(user?.timezone);
    if (user?.language) setLanguage(user.language);
    setMeState(user);
  }, []);
  const [workspaces, setWorkspaces] = useState([]);
  const [wsId, setWsId] = useState(store.get('tf_ws'));
  const [wsSnapshot, setWs] = useState(null); // { userId, workspace, role, projects }
  const [projectId, setProjectIdState] = useState(store.get('tf_project'));
  const [unread, setUnread] = useState(0);
  const [theme, setTheme] = useState(store.get('tf_theme') || 'light');
  const loadingWs = useRef(null);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('tf:resync'));
  }, [me?.timezone]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    store.set('tf_theme', theme);
  }, [theme]);

  // offline = không gọi được /me vì server tạm lỗi/đang khởi động lại (không phải hết phiên)
  const [offline, setOffline] = useState(false);
  const retryTimer = useRef(null);
  const identityRequest = useRef(0);
  const loadMe = useCallback(async () => {
    const requestId = ++identityRequest.current;
    clearTimeout(retryTimer.current);
    try {
      const data = await api.get('/me');
      if (requestId !== identityRequest.current) return null;
      setOffline(false);
      setMe(data.user);
      setWorkspaces(data.workspaces);
      return data;
    } catch (e) {
      if (requestId !== identityRequest.current) return null;
      if (e.status === 401) {
        setOffline(false);
        setMe(null);
        setWorkspaces([]);
      } else {
        // Thử lại thay vì đá người dùng ra trang đăng nhập; chỉ giữ một vòng thử lại
        setOffline(true);
        retryTimer.current = setTimeout(() => loadMeRef.current?.(), 2500);
      }
      return null;
    }
  }, []);
  const loadMeRef = useRef(loadMe);
  loadMeRef.current = loadMe;

  useEffect(() => {
    loadMe();
    const unsubscribe = onUnauthorized(() => {
      identityRequest.current++;
      clearTimeout(retryTimer.current);
      setOffline(false);
      setMe(null);
      setWorkspaces([]);
      setWs(null);
      setUnread(0);
    });
    return () => { unsubscribe(); clearTimeout(retryTimer.current); };
  }, [loadMe]);

  const activeWsId = useMemo(() => {
    if (!workspaces.length) return null;
    return workspaces.some((w) => w._id === wsId) ? wsId : workspaces[0]._id;
  }, [workspaces, wsId]);

  // Hide the previous workspace immediately, before the next request completes.
  // A response from the previous account/workspace must not restore its data.
  const wsScope = `${me?._id || ''}:${activeWsId || ''}`;
  const currentWsScope = useRef(wsScope);
  currentWsScope.current = wsScope;
  const ws = me && wsSnapshot?.userId === me._id && wsSnapshot?.workspace?._id === activeWsId ? wsSnapshot : null;

  const reloadWorkspace = useCallback(async () => {
    if (!me?._id || !activeWsId) { loadingWs.current = null; return setWs(null); }
    const req = api.get(`/workspaces/${activeWsId}`);
    loadingWs.current = req;
    const data = await req;
    if (loadingWs.current === req && currentWsScope.current === wsScope) setWs({ ...data, userId: me._id });
    return data;
  }, [activeWsId, me?._id, wsScope]);

  const [wsError, setWsError] = useState(null);
  const safeReloadWs = useCallback(async () => {
    try {
      setWsError(null);
      return await reloadWorkspace();
    } catch (e) {
      if (currentWsScope.current === wsScope) setWsError(e);
      return null;
    }
  }, [reloadWorkspace, wsScope]);
  useEffect(() => {
    if (me && activeWsId) safeReloadWs();
    if (activeWsId) store.set('tf_ws', activeWsId);
  }, [me, activeWsId, safeReloadWs]);
  // Mất kết nối rồi kết nối lại (vd server khởi động lại) => tải lại workspace nếu lần trước lỗi
  useEffect(() => {
    if (!wsError) return;
    const retry = () => safeReloadWs();
    window.addEventListener('tf:resync', retry);
    const t = setTimeout(retry, 3000);
    return () => {
      window.removeEventListener('tf:resync', retry);
      clearTimeout(t);
    };
  }, [wsError, safeReloadWs]);

  const projects = ws?.projects || [];
  const activeProjects = projects.filter((p) => p.status === 'active');
  const project = projects.find((p) => p._id === projectId) || activeProjects[0] || projects[0] || null;

  const setProjectId = useCallback((id) => {
    setProjectIdState(id);
    store.set('tf_project', id);
  }, []);

  const unreadWorkspace = useRef(activeWsId);
  unreadWorkspace.current = activeWsId;
  const unreadSequence = useRef(0);
  const refreshUnread = useCallback(async () => {
    const sequence = ++unreadSequence.current;
    if (!activeWsId) return;
    const d = await api.get(`/notifications?limit=1&workspace=${activeWsId}`).catch(() => null);
    if (d && sequence === unreadSequence.current && unreadWorkspace.current === activeWsId) setUnread(d.unread);
  }, [activeWsId]);

  // Realtime: vào phòng dự án hiện tại, nhận thông báo cá nhân
  useEffect(() => {
    if (!me) return closeSocket();
    const s = getSocket();
    const onNotif = (event) => {
      if (!event?.workspace || event.workspace === activeWsId) refreshUnread();
    };
    const onAccess = async () => {
      setWs(null);
      await loadMe();
      await safeReloadWs();
      window.dispatchEvent(new CustomEvent('tf:resync'));
    };
    s.on('notification:new', onNotif);
    s.on('notification:read', onNotif);
    s.on('access:changed', onAccess);
    return () => {
      s.off('notification:new', onNotif);
      s.off('notification:read', onNotif);
      s.off('access:changed', onAccess);
    };
  }, [me, loadMe, safeReloadWs, activeWsId, refreshUnread]);
  useEffect(() => {
    if (me && project?._id) joinProject(project._id);
  }, [me, project?._id]);

  useEffect(() => {
    if (me) refreshUnread();
    else { unreadSequence.current++; setUnread(0); }
  }, [me, refreshUnread]);

  const logout = useCallback(async () => {
    identityRequest.current++;
    clearTimeout(retryTimer.current);
    await api.post('/auth/logout').catch(() => {});
    identityRequest.current++;
    clearTimeout(retryTimer.current);
    closeSocket();
    setMe(null);
    setWs(null);
    setWorkspaces([]);
    setUnread(0);
  }, []);

  const setWorkspaceId = useCallback((id) => {
    setWsId(id);
    store.set('tf_ws', id);
    setProjectId(null);
  }, [setProjectId]);

  const value = {
    me,
    setMe,
    loadMe,
    offline,
    workspaces,
    wsId: activeWsId,
    setWsId: setWorkspaceId,
    ws,
    role: ws?.role,
    projects,
    activeProjects,
    project,
    setProjectId,
    reloadWorkspace: safeReloadWs,
    wsError,
    unread,
    setUnread,
    refreshUnread,
    logout,
    theme,
    toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    canWriteProject: project && project.status === 'active' && project.projectRole !== 'viewer' && ws?.role !== 'viewer',
    canManageProject: project && project.status === 'active' && project.projectRole === 'pm' && ws?.role !== 'viewer',
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export const useApp = () => useContext(AppCtx);

/** Hook tải dữ liệu đơn giản: trả { data, error, loading, reload, setData } */
export function useLoad(fn, deps) {
  const scope = useMemo(() => ({}), deps);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const mounted = useRef(false);
  const initial = { scope, data: null, error: null, loading: true };
  const [state, setState] = useState(initial);
  const seq = useRef(0);
  const run = useCallback(async () => {
    if (!mounted.current || currentScope.current !== scope) return null;
    const id = ++seq.current;
    const isCurrent = () => mounted.current && currentScope.current === scope && id === seq.current;
    setState((s) => ({ ...(s.scope === scope ? s : initial), error: null, loading: true }));
    try {
      const data = await fn();
      if (isCurrent()) setState({ scope, data, error: null, loading: false });
      return data;
    } catch (error) {
      if (isCurrent()) setState((s) => ({ ...s, error, loading: false }));
      return null;
    }

  }, [scope]);
  useEffect(() => {
    mounted.current = true;
    run();
    return () => { mounted.current = false; seq.current++; };
  }, [run]);
  useEffect(() => {
    const onResync = () => run();
    window.addEventListener('tf:resync', onResync);
    return () => window.removeEventListener('tf:resync', onResync);
  }, [run]);
  const visible = state.scope === scope ? state : initial;
  return {
    data: visible.data,
    error: visible.error,
    loading: visible.loading,
    reload: run,
    setData: (d) => {
      if (!mounted.current || currentScope.current !== scope) return;
      setState((s) => {
        const current = s.scope === scope ? s : initial;
        return { ...current, data: typeof d === 'function' ? d(current.data) : d };
      });
    },
  };
}
