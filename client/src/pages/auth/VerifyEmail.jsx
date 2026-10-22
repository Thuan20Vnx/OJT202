import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { Icon, Notice, PageLoader } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useApp } from '../../lib/app.jsx';

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const { loadMe } = useApp();
  const navigate = useNavigate();
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return; // token chỉ dùng được một lần – tránh StrictMode gọi 2 lần
    once.current = true;
    api
      .post('/auth/verify-email', { token: params.get('token') })
      .then(async () => {
        setState('ok');
        const d = await loadMe();
        setTimeout(() => navigate(d?.workspaces?.length ? '/overview' : '/onboarding', { replace: true }), 1200);
      })
      .catch((e) => {
        setError(e.message);
        setState('error');
      });
  }, [params, loadMe, navigate]);
  return (
    <AuthLayout>
      <div className="card p-6 text-center shadow-card">
        {state === 'loading' && <PageLoader />}
        {state === 'ok' && (
          <>
            <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <Icon name="verified" size={30} />
            </span>
            <h2 className="text-headline-md text-slate-900">Email đã được xác minh</h2>
            <p className="mt-1 text-body-sm text-slate-500">Đang chuyển bạn tới bước tạo không gian làm việc…</p>
          </>
        )}
        {state === 'error' && (
          <div className="space-y-4">
            <Notice tone="danger">{error}</Notice>
            <Link to="/login" className="btn-primary w-full">
              Về trang đăng nhập
            </Link>
          </div>
        )}
      </div>
    </AuthLayout>
  );
}
