import { useNavigate, useParams } from 'react-router-dom';
import { Icon, Tabs } from '../../components/ui.jsx';
import { useApp } from '../../lib/app.jsx';
import Members from './Members.jsx';
import Invites from './Invites.jsx';
import AiSettings from './AiSettings.jsx';
import Activity from './Activity.jsx';
import General from './General.jsx';

const HEAD = {
  general: ['Thông tin chung', 'Tên và thông tin cơ bản của workspace.'],
  members: ['Thành viên & phân quyền', 'Quản lý ai có quyền truy cập dữ liệu của workspace. Người ngoài nhóm không thể xem dự án.'],
  invites: ['Lời mời đang chờ', 'Lời mời hết hạn sau 72 giờ.'],
  ai: ['Cài đặt Trợ lý AI', 'Kiểm soát hạn mức và theo dõi chất lượng AI của workspace.'],
  activity: ['Nhật ký hoạt động', 'Ghi lại mọi thay đổi quan trọng trong workspace. Nhật ký chỉ đọc, không thể sửa hay xóa.'],
};

export default function Settings() {
  const { tab = 'members' } = useParams();
  const navigate = useNavigate();
  const { role, ws } = useApp();
  const isAdmin = ['owner', 'admin'].includes(role);
  const [title, sub] = HEAD[tab] || HEAD.members;
  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-headline-lg text-slate-900">
          {title}
          {tab === 'members' && <span className="chip border-blue-200 bg-blue-50 text-blue-700">Workspace {ws?.workspace?.name}</span>}
        </h1>
        <p className="mt-0.5 flex items-center gap-1 text-body-sm text-slate-500">
          {tab === 'activity' && <Icon name="lock" size={14} />}
          {sub}
        </p>
      </div>
      <Tabs
        className="mb-5"
        value={tab}
        onChange={(v) => navigate(`/settings/${v}`)}
        tabs={[
          { value: 'general', label: 'Thông tin chung' },
          { value: 'members', label: 'Thành viên' },
          ...(isAdmin ? [{ value: 'invites', label: 'Lời mời đang chờ' }] : []),
          { value: 'ai', label: 'Trợ lý AI' },
          { value: 'activity', label: 'Nhật ký hoạt động' },
        ]}
      />
      {tab === 'general' && <General />}
      {tab === 'members' && <Members />}
      {tab === 'invites' && isAdmin && <Invites />}
      {tab === 'ai' && <AiSettings />}
      {tab === 'activity' && <Activity />}
    </div>
  );
}
