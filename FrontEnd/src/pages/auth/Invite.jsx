import { t as tr, useI18n } from '../../lib/i18n.js';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { Icon, Notice, PageLoader, Spinner } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useApp } from '../../lib/app.jsx';
import { ROLE } from '../../lib/format.js';

export default function Invite() {
  useI18n();
  const { token } = useParams();
  const { me, loadMe, setWsId } = useApp();
  const navigate = useNavigate();
  const [inv, setInv] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get(`/auth/invite/${token}`).then(setInv).catch((e) => setError(e.message));
  }, [token]);
  const accept = async () => {
    setBusy(true);
    try {
      const d = await api.post(`/me/invites/${token}/accept`);
      await loadMe();
      setWsId(d.workspaceId);
      navigate('/overview');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout title={[tr("Bạn được mời"), tr("cộng tác cùng nhóm")]}>
      <div className="card space-y-4 p-6 shadow-card">
        {!inv && !error && <PageLoader />}
        {error && <Notice tone="danger">{error}</Notice>}
        {inv && !inv.valid && <Notice tone="danger">{tr("Lời mời đã hết hạn hoặc không còn hiệu lực.")}</Notice>}
        {inv?.valid && (
          <>
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Icon name="group_add" size={26} />
            </span>
            <div>
              <h2 className="text-headline-md text-slate-900">Tham gia {inv.workspace.name}</h2>
              <p className="text-body-sm text-slate-500">{tr("Lời mời dành cho ")}<b>{inv.email}</b>{tr(" với vai trò ")}<b>{ROLE[inv.role]}</b>.
              </p>
            </div>
            {me === undefined ? null : me ? (
              me.email === inv.email ? (
                <button className="btn-primary w-full" onClick={accept} disabled={busy}>
                  {busy && <Spinner />}{tr("Chấp nhận lời mời")}</button>
              ) : (
                <Notice tone="warn">{tr("Bạn đang đăng nhập bằng ")}{me.email}{tr(". Hãy đăng nhập bằng ")}{inv.email}{tr(" để chấp nhận.")}</Notice>
              )
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Link className="btn-primary" to={`/login?next=/invite/${token}`}>{tr("Đăng nhập")}</Link>
                <Link className="btn-outline" to={`/register?next=/invite/${token}`}>{tr("Tạo tài khoản")}</Link>
              </div>
            )}
          </>
        )}
      </div>
    </AuthLayout>
  );
}
