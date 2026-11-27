import { useNavigate } from 'react-router-dom';
import { t as tr, useI18n } from '../lib/i18n.js';
import { Empty } from './ui.jsx';

/**
 * Màn trống khi chưa có dự án nào. Owner/Admin tạo được dự án nên có nút "Tạo dự án";
 * thành viên được mời vào workspace mà chưa được thêm vào dự án thì được hướng dẫn nhờ PM thêm vào.
 */
export default function NoProject({ role }) {
  useI18n();
  const navigate = useNavigate();
  const canCreate = role === 'owner' || role === 'admin';
  return (
    <Empty
      icon="folder_off"
      title={canCreate ? tr("Chưa có dự án") : tr("Bạn chưa được thêm vào dự án nào")}
      action={canCreate ? <button className="btn-primary" onClick={() => navigate('/projects?new=1')}>{tr("Tạo dự án")}</button> : null}
    >
      {canCreate ? null : tr("Bạn đã ở trong workspace nhưng chỉ thấy dự án mà PM hoặc Admin đã thêm bạn vào. Hãy nhờ họ thêm bạn vào dự án (Cài đặt Workspace › Thành viên hoặc Quản lý thành viên của dự án).")}
    </Empty>
  );
}
