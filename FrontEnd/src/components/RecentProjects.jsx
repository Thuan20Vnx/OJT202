import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { t as tr, useI18n } from '../lib/i18n.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/app.jsx';
import { PROJECT_COLOR } from '../lib/format.js';
import { invalidateProject } from '../lib/hooks.js';
import { Confirm, Dropdown, Icon, MenuItem } from './ui.jsx';

const hiddenKey = (wsId) => `taskflow.hiddenRecent.${wsId}`;
const readHidden = (wsId) => {
  try { return JSON.parse(localStorage.getItem(hiddenKey(wsId)) || '[]'); } catch { return []; }
};
const writeHidden = (wsId, ids) => {
  try { localStorage.setItem(hiddenKey(wsId), JSON.stringify(ids)); } catch { /* chỉ dùng cho phiên này */ }
};

/** Đổi tên ngay tại dòng: Enter lưu, Esc hoặc bấm ra ngoài thì thôi. */
function RenameInput({ project, onDone }) {
  const toast = useToast();
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const save = async () => {
    const next = name.trim();
    if (!next || next === project.name) return onDone(false);
    setBusy(true);
    try {
      await api.patch(`/projects/${project._id}`, { name: next });
      toast(tr('Đã đổi tên dự án'));
      onDone(true);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
      ref.current?.focus();
    }
  };
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-slate-100 px-2.5 py-1">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${PROJECT_COLOR[project.color] || 'bg-blue-500'}`} />
      <input
        ref={ref}
        className="min-w-0 flex-1 rounded border border-blue-300 bg-white px-1.5 py-0.5 text-body-sm text-slate-900 outline-none"
        value={name}
        maxLength={100}
        disabled={busy}
        aria-label={tr('Tên dự án')}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); save(); }
          if (e.key === 'Escape') onDone(false);
        }}
        onBlur={() => !busy && save()}
      />
    </div>
  );
}

/**
 * "Dự án gần đây" ở thanh bên. Rê chuột vào một dự án hiện nút 3 chấm; mục trong menu tùy quyền:
 * mọi người mở bảng công việc, chép liên kết, ẩn khỏi danh sách; PM đổi tên, quản lý thành viên, lưu trữ.
 * Không có xóa hẳn: lưu trữ để dữ liệu của nhóm luôn khôi phục được.
 */
export default function RecentProjects({ projects, current, wsId, role, onOpen, setProjectId, reloadWorkspace }) {
  useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(() => readHidden(wsId));
  const [renaming, setRenaming] = useState(null);
  const [leaving, setLeaving] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setHidden(readHidden(wsId)); }, [wsId]);
  // Liên kết đã chép (…?project=<id>) mở đúng dự án rồi bỏ tham số khỏi địa chỉ.
  const location = useLocation();
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('project');
    if (id && projects.some((p) => p._id === id)) {
      setProjectId(id);
      navigate(location.pathname, { replace: true });
    }
  }, [location.search, projects]);
  // Mở lại một dự án đã ẩn (từ trang Dự án, liên kết...) thì nó hiện lại trong danh sách gần đây.
  useEffect(() => {
    if (current && hidden.includes(current._id)) {
      const next = hidden.filter((id) => id !== current._id);
      setHidden(next);
      writeHidden(wsId, next);
    }
  }, [current?._id]);

  const hide = (p) => {
    const next = [...new Set([...hidden, p._id])];
    setHidden(next);
    writeHidden(wsId, next);
    toast(tr('Đã ẩn {0} khỏi Dự án gần đây. Mở lại từ Xem tất cả.', [p.name]));
  };
  const copyLink = async (p) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/overview?project=${p._id}`);
      toast(tr('Đã sao chép liên kết'));
    } catch {
      toast(tr('Không sao chép được liên kết'), 'error');
    }
  };
  const archive = async (p) => {
    try {
      await api.post(`/projects/${p._id}/archive`);
      toast(tr('Đã lưu trữ {0} (chỉ đọc). Khôi phục ở trang Dự án.', [p.name]));
      invalidateProject(p._id);
      await reloadWorkspace();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const leave = async (p) => {
    try {
      await api.post(`/projects/${p._id}/leave`);
      toast(tr('Đã rời {0}', [p.name]));
      invalidateProject(p._id);
      if (current?._id === p._id) navigate('/overview');
      await reloadWorkspace();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const openBoard = (p) => {
    setProjectId(p._id);
    navigate('/board');
  };

  const visible = projects.filter((p) => !hidden.includes(p._id) || p._id === current?._id);
  return (
    <nav className="space-y-0.5">
      {visible.map((p) => {
        if (renaming === p._id) {
          return <RenameInput key={p._id} project={p} onDone={async (changed) => { setRenaming(null); if (changed) { invalidateProject(p._id); await reloadWorkspace(); } }} />;
        }
        const active = current?._id === p._id;
        const isPm = p.projectRole === 'pm' && role !== 'viewer';
        return (
          <div key={p._id} className={`group flex items-center rounded-xl transition-colors ${active ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
            <button
              onClick={() => onOpen(p)}
              className={`flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-1.5 text-left text-body-sm ${active ? 'font-semibold text-slate-900' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${PROJECT_COLOR[p.color] || 'bg-blue-500'}`} />
              <span className="truncate">{p.name}</span>
            </button>
            <Dropdown
              width="w-56"
              portal
              trigger={(
                <button
                  type="button"
                  className="mr-1 flex h-6 w-6 items-center justify-center rounded-md text-slate-400 opacity-0 transition-opacity hover:bg-slate-200 hover:text-slate-700 focus:opacity-100 group-hover:opacity-100"
                  aria-label={tr('Tùy chọn dự án {0}', [p.name])}
                  title={tr('Thao tác dự án')}
                >
                  <Icon name="more_horiz" size={18} />
                </button>
              )}
            >
              <MenuItem icon="view_kanban" onClick={() => openBoard(p)}>{tr('Mở bảng công việc')}</MenuItem>
              <MenuItem icon="link" onClick={() => copyLink(p)}>{tr('Sao chép liên kết')}</MenuItem>
              {isPm && (
                <>
                  <div className="my-1 border-t border-slate-100" />
                  <MenuItem icon="edit" onClick={() => setRenaming(p._id)}>{tr('Đổi tên')}</MenuItem>
                  <MenuItem icon="group" onClick={() => navigate(`/projects?edit=${p._id}`)}>{tr('Quản lý thành viên')}</MenuItem>
                  <MenuItem icon="archive" onClick={() => archive(p)}>{tr('Lưu trữ')}</MenuItem>
                </>
              )}
              <div className="my-1 border-t border-slate-100" />
              <MenuItem icon="visibility_off" onClick={() => hide(p)}>{tr('Ẩn khỏi Dự án gần đây')}</MenuItem>
              {!isPm && p.projectRole && (
                <MenuItem icon="logout" danger onClick={() => setLeaving(p)}>{tr('Rời dự án')}</MenuItem>
              )}
            </Dropdown>
          </div>
        );
      })}
      {!visible.length && <p className="px-2.5 py-1.5 text-body-sm text-slate-400">{tr('Chưa có dự án')}</p>}
      <Confirm
        open={!!leaving}
        title={leaving ? tr('Rời dự án {0}?', [leaving.name]) : ''}
        confirmText={tr('Rời dự án')}
        danger
        busy={busy}
        onConfirm={async () => { setBusy(true); await leave(leaving); setBusy(false); setLeaving(null); }}
        onClose={() => !busy && setLeaving(null)}
      >
        {tr('Bạn sẽ không còn thấy dự án này. Việc đang giao cho bạn sẽ được gỡ người nhận để PM giao lại. Muốn quay lại, nhờ PM thêm bạn vào dự án.')}
      </Confirm>
    </nav>
  );
}
