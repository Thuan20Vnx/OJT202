import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Empty, ErrorBox, Icon, PageHeader, PageLoader, Select, Toggle } from '../components/ui.jsx';
import { api, qs } from '../lib/api.js';
import { useApp, useLoad, useToast } from '../lib/app.jsx';
import { PROJECT_COLOR, dayGroup, timeAgo } from '../lib/format.js';
import { useSocketEvent } from '../lib/hooks.js';

const TYPE = {
  assigned: { icon: 'assignment_ind', tone: 'bg-blue-50 text-blue-600' },
  mentioned: { icon: 'alternate_email', tone: 'bg-purple-50 text-purple-600' },
  due_soon: { icon: 'alarm', tone: 'bg-amber-50 text-amber-600' },
  overdue: { icon: 'error', tone: 'bg-rose-50 text-rose-600' },
  status: { icon: 'swap_horiz', tone: 'bg-emerald-50 text-emerald-600' },
  comment: { icon: 'chat_bubble', tone: 'bg-slate-100 text-slate-600' },
  invite: { icon: 'group_add', tone: 'bg-cyan-50 text-cyan-600' },
};

export default function Notifications() {
  const { wsId } = useApp();
  return <NotificationPage key={wsId} />;
}

function NotificationPage() {
  const { wsId, projects, setProjectId, refreshUnread } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState('all');
  const [project, setProject] = useState('');
  const scope = JSON.stringify([wsId, tab, project]);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const pendingReads = useRef(new Set());
  const moreRequest = useRef(null);
  const [moreScope, setMoreScope] = useState(null);
  const { data: loaded, error, loading, reload, setData } = useLoad(async () => ({
    ...await api.get(`/notifications${qs({ tab, project, workspace: wsId, limit: 50 })}`), scope,
  }), [scope]);
  const data = loaded?.scope === scope ? loaded : null;
  const prefs = useLoad(() => api.get('/me/notification-prefs'), []);
  useSocketEvent('notification:new', () => reload(), [reload]);

  const markRead = async (n) => {
    if (n.readAt || pendingReads.current.has(n._id)) return;
    pendingReads.current.add(n._id);
    try {
      await api.post(`/notifications/${n._id}/read`);
      setData((d) => {
        if (d?.scope !== scope || !d.items.some((x) => x._id === n._id && !x.readAt)) return d;
        return { ...d, unread: Math.max(0, d.unread - 1), items: tab === 'unread'
          ? d.items.filter((x) => x._id !== n._id)
          : d.items.map((x) => (x._id === n._id ? { ...x, readAt: new Date() } : x)) };
      });
      refreshUnread();
    } catch (e) { toast(e.message, 'error'); }
    finally { pendingReads.current.delete(n._id); }
  };
  const readAll = async () => {
    try {
      await api.post('/notifications/read-all', { workspace: wsId });
      toast('Đã đánh dấu tất cả là đã đọc');
      if (activeScope.current === scope) reload();
      refreshUnread();
    } catch (e) { toast(e.message, 'error'); }
  };
  const openTask = (n) => {
    markRead(n);
    if (n.project) setProjectId(n.project._id);
    if (n.task) navigate({ pathname: '/board', search: `?task=${n.task._id}` });
  };
  const setPref = async (k, v) => {
    try {
      const d = await api.patch('/me/notification-prefs', { [k]: v });
      prefs.setData(d);
    } catch (e) { toast(e.message, 'error'); }
  };
  const loadMore = async () => {
    if (!data?.nextCursor || loading || moreRequest.current?.scope === scope) return;
    const request = { scope, cursor: data.nextCursor };
    moreRequest.current = request;
    setMoreScope(scope);
    try {
      const page = await api.get(`/notifications${qs({ tab, project, workspace: wsId, limit: 50, cursor: request.cursor })}`);
      if (activeScope.current !== scope) return;
      setData((d) => {
        // Không ghép trang cũ vào danh sách vừa đổi bộ lọc hoặc được realtime tải lại.
        if (d !== data) return d;
        const ids = new Set(d.items.map((n) => n._id));
        return { ...d, ...page, items: [...d.items, ...page.items.filter((n) => !ids.has(n._id))] };
      });
    } catch (e) { if (activeScope.current === scope) toast(e.message, 'error'); }
    finally {
      if (moreRequest.current === request) { moreRequest.current = null; setMoreScope(null); }
    }
  };

  const items = data?.items || [];
  const groups = ['Hôm nay', 'Hôm qua', 'Tuần này', 'Trước đó'].map((g) => ({ g, list: items.filter((n) => dayGroup(n.createdAt) === g) })).filter((x) => x.list.length);
  const p = prefs.data?.prefs;

  return (
    <div className="mx-auto max-w-7xl p-6">
      <PageHeader
        title="Thông báo"
        subtitle={
          <>
            Bạn có <b className="text-blue-700">{data?.unread ?? 0}</b> thông báo chưa đọc
          </>
        }
        actions={
          <button className="btn-outline" onClick={readAll} disabled={!data?.unread}>
            <Icon name="done_all" size={16} /> Đánh dấu tất cả đã đọc
          </button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {[
              ['all', 'Tất cả'],
              ['unread', `Chưa đọc${data?.unread ? ` (${data.unread})` : ''}`],
              ['assigned', 'Được giao'],
              ['mentioned', 'Nhắc đến tôi'],
              ['due', 'Sắp đến hạn'],
            ].map(([v, l]) => (
              <button key={v} className={`pill-tab ${tab === v ? 'pill-tab-active' : ''}`} onClick={() => setTab(v)}>
                {l}
              </button>
            ))}
            <Select className="input ml-auto h-8 w-auto py-0 text-body-sm" value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">Dự án: Tất cả</option>
              {projects.map((x) => (
                <option key={x._id} value={x._id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </div>
          <ErrorBox error={error} onRetry={reload} />
          {loading && !data ? (
            <PageLoader />
          ) : error && !data ? null : !items.length ? (
            <div className="card">
              <Empty icon="notifications_off" title={data?.nextCursor ? 'Không còn thông báo trên trang này' : 'Bạn đã xem hết thông báo'}>
                {data?.nextCursor ? 'Tải thêm để xem những thông báo trước đó.' : 'Không còn thông báo nào trong mục này.'}
              </Empty>
            </div>
          ) : (
            <div className="space-y-5">
              {groups.map(({ g, list }) => (
                <div key={g}>
                  <p className="section-label mb-2 flex justify-between">
                    {g} <span>{list.length} mục</span>
                  </p>
                  <div className="card divide-y divide-slate-100 overflow-hidden">
                    {list.map((n) => {
                      const t = TYPE[n.type] || TYPE.comment;
                      return (
                        <div key={n._id} className={`group flex items-start gap-3 px-4 py-3.5 transition-colors ${n.readAt ? 'bg-white' : 'bg-blue-50/50'}`}>
                          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-blue-600'}`} />
                          <div className="relative shrink-0">
                            {n.actor ? <Avatar user={n.actor} size={34} /> : <span className={`flex h-[34px] w-[34px] items-center justify-center rounded-full ${t.tone}`}><Icon name={t.icon} size={18} /></span>}
                            {n.actor && (
                              <span className={`absolute -bottom-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full ring-2 ring-white ${t.tone}`}>
                                <Icon name={t.icon} size={11} />
                              </span>
                            )}
                          </div>
                          <button className="min-w-0 flex-1 text-left" onClick={() => openTask(n)}>
                            <p className={`text-body-sm ${n.readAt ? 'text-slate-600' : 'font-medium text-slate-900'}`}>{n.text}</p>
                            {n.excerpt && <p className="mt-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-body-sm italic text-slate-600">“{n.excerpt}”</p>}
                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                              {n.project && (
                                <span className="chip border-slate-200 bg-white text-slate-600">
                                  <span className={`h-1.5 w-1.5 rounded-full ${PROJECT_COLOR[n.project.color]}`} />
                                  {n.project.name}
                                </span>
                              )}
                              {n.type === 'overdue' && <span className="chip border-rose-200 bg-rose-50 text-rose-700">Quá hạn</span>}
                              {n.type === 'due_soon' && <span className="chip border-amber-200 bg-amber-50 text-amber-700">Trong 24 giờ</span>}
                            </div>
                          </button>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <span className="whitespace-nowrap text-label-md font-normal text-slate-400">{timeAgo(n.createdAt)}</span>
                            <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              {!n.readAt && (
                                <button className="icon-btn h-7 w-7" onClick={() => markRead(n)} title="Đánh dấu đã đọc">
                                  <Icon name="done" size={16} />
                                </button>
                              )}
                              {n.task && (
                                <button className="icon-btn h-7 w-7" onClick={() => openTask(n)} title="Mở công việc">
                                  <Icon name="open_in_new" size={16} />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {!data?.nextCursor && <p className="py-2 text-center text-body-sm text-slate-400">
                <Icon name="check_circle" size={16} className="text-emerald-500" /> Bạn đã xem hết thông báo
              </p>}
            </div>
          )}
          {data?.nextCursor && (
            <div className="py-4 text-center">
              <button className="btn-outline" disabled={loading || moreScope === scope} onClick={loadMore}>
                {moreScope === scope ? 'Đang tải…' : 'Tải thêm thông báo'}
              </button>
            </div>
          )}
        </div>
        <div className="card h-fit p-4">
          <ErrorBox error={prefs.error} onRetry={prefs.reload} />
          <p className="mb-3 flex items-center gap-1.5 text-label-lg font-semibold text-slate-900">
            <Icon name="tune" size={18} className="text-blue-600" /> Cài đặt thông báo
          </p>
          {p && (
            <>
              <p className="section-label mb-2">Kênh nhận thông báo</p>
              <div className="mb-4 grid grid-cols-2 rounded-lg bg-slate-100 p-0.5">
                <span className="rounded-md bg-white py-1.5 text-center text-label-md font-semibold text-slate-900 shadow-sm">Trong ứng dụng</span>
                <button onClick={() => setPref('email', !p.email)} className={`rounded-md py-1.5 text-label-md ${p.email ? 'bg-white font-semibold text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                  Email {p.email ? '✓' : ''}
                </button>
              </div>
              <p className="section-label mb-2">Tùy chọn sự kiện</p>
              <div className="space-y-3">
                {[
                  ['assigned', 'Khi được giao việc', 'Nhận thông báo khi có người giao việc cho bạn'],
                  ['mentioned', 'Khi được nhắc tên (@mention)', 'Khi ai đó nhắc đến bạn trong bình luận'],
                  ['due_soon', 'Nhắc trước hạn chót 24 giờ', 'Và khi công việc của bạn quá hạn'],
                  ['status', 'Trạng thái việc tôi theo dõi thay đổi', 'Việc bạn tạo hoặc được giao'],
                  ['comment', 'Bình luận mới trong việc của tôi', 'Có thể tạo nhiều thông báo'],
                ].map(([k, t, d]) => (
                  <div key={k} className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-body-sm font-medium text-slate-800">{t}</p>
                      <p className="text-label-md font-normal text-slate-500">{d}</p>
                    </div>
                    <Toggle checked={p[k]} onChange={(v) => setPref(k, v)} label={t} />
                  </div>
                ))}
              </div>
              <p className="mt-4 flex items-start gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-label-md font-normal text-blue-800">
                <Icon name="info" size={14} className="mt-px" /> Cùng một sự kiện chỉ gửi một thông báo.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
