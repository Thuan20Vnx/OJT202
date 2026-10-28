import { useNavigate, useParams } from 'react-router-dom';
import { Empty, Icon, Tabs } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useApp, useLoad } from '../lib/app.jsx';
import Planner from './ai/Planner.jsx';
import Report from './ai/Report.jsx';
import Qa from './ai/Qa.jsx';
import Meeting from './ai/Meeting.jsx';

export default function Ai() {
  const { tab = 'planner' } = useParams();
  const navigate = useNavigate();
  const { project } = useApp();
  const usage = useLoad(() => (project ? api.get(`/projects/${project._id}/ai/usage`) : Promise.resolve(null)), [project?._id, tab]);
  if (!project) return <Empty icon="folder_off" title="Chưa có dự án" />;
  const u = usage.data;
  const pct = u ? Math.min(100, (u.used / Math.max(1, u.limit)) * 100) : 0;
  const props = { project, onUsage: usage.reload, disabled: u && !u.enabled };
  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-headline-lg text-slate-900">
            <Icon name="auto_awesome" className="text-purple-500" size={26} /> Trợ lý AI
          </h1>
          <p className="text-body-sm text-slate-500">Gợi ý của AI luôn ở dạng nháp – chỉ được tạo khi bạn duyệt.</p>
        </div>
        {u && (
          <div className="card flex items-center gap-3 px-4 py-2.5">
            <span className="text-body-sm text-slate-600">
              Đã dùng <b className="text-slate-900">{u.used}/{u.limit}</b> lượt hôm nay
            </span>
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
              <span className={`block h-full rounded-full ${pct >= 90 ? 'bg-rose-500' : 'bg-purple-500'}`} style={{ width: `${pct}%` }} />
            </span>
          </div>
        )}
      </div>
      <Tabs
        className="mb-5"
        value={tab}
        onChange={(v) => navigate(`/ai/${v}`)}
        tabs={[
          { value: 'planner', label: 'Lập kế hoạch', icon: 'flag' },
          { value: 'report', label: 'Báo cáo tiến độ', icon: 'bar_chart' },
          { value: 'qa', label: 'Hỏi đáp dự án', icon: 'forum' },
          { value: 'meeting', label: 'Ghi chú họp', icon: 'groups' },
        ]}
      />
      {u && !u.enabled && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-body-sm text-amber-800">Trợ lý AI đang tắt cho workspace này. Owner/Admin có thể bật lại trong Cài đặt Workspace › Trợ lý AI.</div>
      )}
      {tab === 'planner' && <Planner key={project._id} {...props} />}
      {tab === 'report' && <Report key={project._id} {...props} />}
      {tab === 'qa' && <Qa key={project._id} {...props} />}
      {tab === 'meeting' && <Meeting key={project._id} {...props} />}
    </div>
  );
}
