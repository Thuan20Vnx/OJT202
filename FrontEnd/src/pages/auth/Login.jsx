import { useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout, { AuthSuccess } from './AuthLayout.jsx';
import { Field, Icon, Notice, Spinner } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useApp } from '../../lib/app.jsx';

export function PasswordInput({ value, onChange, error, placeholder = '••••••••', autoComplete }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Icon name="lock" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        type={show ? 'text' : 'password'}
        className={`input pl-9 pr-10 ${error ? 'input-error' : ''}`}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
        aria-label="Hiện/ẩn mật khẩu"
      >
        <Icon name={show ? 'visibility_off' : 'visibility'} size={18} />
      </button>
    </div>
  );
}

export function PasswordStrength({ value }) {
  const rules = [
    [value.length >= 8, 'Ít nhất 8 ký tự'],
    [/[A-Z]/.test(value), 'Có chữ hoa'],
    [/[0-9]/.test(value), 'Có số'],
  ];
  const tooLong = new TextEncoder().encode(value).length > 72;
  const score = tooLong ? 0 : rules.filter((r) => r[0]).length;
  const label = ['Yếu', 'Yếu', 'Trung bình', 'Mạnh'][score];
  const tone = ['bg-rose-500', 'bg-rose-500', 'bg-amber-500', 'bg-emerald-500'][score];
  return (
    <div className="mt-2">
      {tooLong && <p className="mb-1 text-body-sm text-rose-600">Mật khẩu vượt 72 byte UTF-8; hãy rút ngắn (ký tự có dấu có thể chiếm nhiều byte).</p>}
      <div className="flex items-center justify-between text-label-md font-normal text-slate-500">
        <span>Độ mạnh mật khẩu</span>
        <span className={score === 3 ? 'font-semibold text-emerald-600' : ''}>{value ? label : ''}</span>
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className={`h-1 rounded-full ${i < score ? tone : 'bg-slate-200'}`} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {rules.map(([ok, text]) => (
          <span key={text} className={`flex items-center gap-1 text-label-md font-normal ${ok ? 'text-emerald-600' : 'text-slate-400'}`}>
            <Icon name={ok ? 'check_circle' : 'radio_button_unchecked'} size={14} />
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}

function GoogleButton() {
  return (
    <button
      type="button"
      className="btn-outline w-full"
      title="Đăng nhập Google cần cấu hình OAuth khi triển khai"
      onClick={() => alert('Đăng nhập Google cần cấu hình OAuth Client ID khi triển khai. Bản phát triển dùng email + mật khẩu.')}
    >
      <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
        <path
          fill="#FFC107"
          d="M43.6 20.5H42V20H24v8h11.3C33.6 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
        />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      Tiếp tục với Google
    </button>
  );
}

export default function Login({ initialTab = 'login' }) {
  const [tab, setTab] = useState(initialTab);
  const { loadMe } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [f, setF] = useState({ name: '', email: '', password: '', remember: true, accept: false });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  const [mailPending, setMailPending] = useState(false);
  const [resendNotice, setResendNotice] = useState('');
  const resendPending = useRef(false);
  const [unverified, setUnverified] = useState(false);
  const [success, setSuccess] = useState(false);
  const formRef = useRef(null);
  const fail = (err) => {
    setError(err.message);
    setErrors(err.fields || {});
    // Lắc nhẹ form khi lỗi (Web Animations API – không dựng lại form nên ô nhập giữ focus)
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      formRef.current?.animate(
        [0, -6, 6, -4, 4, -2, 0].map((x) => ({ transform: `translateX(${x}px)` })),
        { duration: 400, easing: 'ease-in-out' },
      );
    }
  };
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const login = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    setUnverified(false);
    try {
      await api.post('/auth/login', { email: f.email, password: f.password, remember: f.remember });
      // Cho hiệu ứng thành công chạy trước – nạp /me xong là trang tự chuyển (PublicOnly)
      setSuccess(true);
      await new Promise((r) => setTimeout(r, 1100));
      const d = await loadMe();
      navigate(params.get('next') || (d?.workspaces?.length ? '/overview' : d?.user?.isSystemAdmin ? '/admin' : '/onboarding'), { replace: true });
    } catch (err) {
      if (err.details?.code === 'EMAIL_NOT_VERIFIED') setUnverified(true);
      setSuccess(false);
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const register = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    try {
      await api.post('/auth/register', { name: f.name, email: f.email, password: f.password, acceptTerms: f.accept });
      setSent(f.email);
      setMailPending(false);
    } catch (err) {
      if (err.details?.code === 'MAIL_UNAVAILABLE') {
        setSent(f.email);
        setMailPending(true);
      }
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (resendPending.current) return;
    resendPending.current = true;
    setBusy(true);
    setResendNotice('');
    try {
      await api.post('/auth/resend-verification', { email: sent || f.email });
      setResendNotice('Đã yêu cầu gửi lại email xác minh. Vui lòng kiểm tra hộp thư và thư rác; nếu chưa nhận được, hãy thử lại sau.');
      setError('');
    } catch (err) {
      fail(err);
    } finally {
      resendPending.current = false;
      setBusy(false);
    }
  };

  if (success) {
    return (
      <AuthLayout>
        <div className="card p-6 shadow-card">
          <AuthSuccess title="Đăng nhập thành công" progressMs={1100}>
            Chào mừng quay trở lại! Đang mở không gian làm việc của bạn…
          </AuthSuccess>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="card p-6 shadow-card">
        <div className="relative mb-5 grid grid-cols-2 rounded-lg bg-slate-100 p-1">
          {/* Nền trượt theo tab đang chọn */}
          <span
            aria-hidden="true"
            className="absolute bottom-1 top-1 w-[calc(50%-4px)] rounded-md bg-white shadow-sm transition-transform duration-300 ease-out"
            style={{ transform: `translateX(${tab === 'login' ? '4px' : 'calc(100% + 4px)'})`, left: 0 }}
          />
          {[
            ['login', 'login', 'Đăng nhập'],
            ['register', 'person_add', 'Đăng ký'],
          ].map(([key, icon, label]) => (
            <button
              key={key}
              onClick={() => {
                setTab(key);
                setError('');
                setErrors({});
                setSent(null);
                setMailPending(false);
                setResendNotice('');
              }}
              className={`relative flex items-center justify-center gap-1.5 rounded-md py-2 text-label-lg transition-colors duration-300 ${tab === key ? 'font-semibold text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Icon name={icon} size={18} />
              {label}
            </button>
          ))}
        </div>

        {tab === 'login' ? (
          <form ref={formRef} onSubmit={login} className="animate-fade-up space-y-4">
            <div>
              <h2 className="text-headline-md text-slate-900">Chào mừng quay trở lại</h2>
              <p className="text-body-sm text-slate-500">Nhập thông tin tài khoản TaskFlow của bạn để tiếp tục.</p>
            </div>
            {error && (
              <Notice tone="danger">
                {error}
                {unverified && (
                  <button type="button" className="ml-1 font-semibold underline" onClick={resend} disabled={busy}>
                    Gửi lại email xác minh
                  </button>
                )}
              </Notice>
            )}
            {resendNotice && <Notice tone="info">{resendNotice}</Notice>}
            <Field label="Email công việc" required error={errors.email}>
              <div className="relative">
                <Icon name="mail" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="email" autoComplete="email" className="input pl-9" value={f.email} onChange={set('email')} placeholder="ban@congty.com" />
              </div>
            </Field>
            <Field label="Mật khẩu" required error={errors.password}>
              <PasswordInput value={f.password} onChange={set('password')} autoComplete="current-password" />
            </Field>
            <div className="flex items-center justify-between text-body-sm">
              <label className="flex items-center gap-2 text-slate-600">
                <input type="checkbox" className="form-checkbox rounded text-blue-600" checked={f.remember} onChange={set('remember')} />
                Ghi nhớ đăng nhập
              </label>
              <Link to="/forgot-password" className="font-semibold text-blue-600 hover:underline">
                Quên mật khẩu?
              </Link>
            </div>
            <button className="btn-primary h-10 w-full" disabled={busy}>
              {busy && <Spinner />}
              Đăng nhập
              <Icon name="arrow_forward" size={18} />
            </button>
            <div className="flex items-center gap-3 text-label-md font-normal text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              hoặc
              <span className="h-px flex-1 bg-slate-200" />
            </div>
            <GoogleButton />
          </form>
        ) : sent ? (
          <AuthSuccess
            title={mailPending ? 'Tài khoản đang chờ xác minh' : 'Đăng ký thành công!'}
            tone="blue"
            action={
              <>
                {error && <Notice tone="danger">{error}</Notice>}
                {resendNotice && <Notice tone="info">{resendNotice}</Notice>}
                <button className="btn-outline" onClick={resend} disabled={busy}>
                  <Icon name="forward_to_inbox" size={18} />
                  Gửi lại email
                </button>
                <p className="mt-3 text-label-md font-normal text-slate-400">
                  Bản phát triển: xem email tại{' '}
                  <Link className="text-blue-600 underline" to="/dev/outbox">
                    hộp thư dev
                  </Link>
                </p>
              </>
            }
          >
            {mailPending ? <>Tài khoản <b>{sent}</b> đã được tạo, nhưng email chưa gửi được. Bạn có thể gửi lại mà không cần đăng ký lần nữa.</> : <>Kiểm tra hộp thư: chúng tôi đã gửi email xác minh tới <b>{sent}</b>. Liên kết có hiệu lực trong 24 giờ.</>}
          </AuthSuccess>
        ) : (
          <form ref={formRef} onSubmit={register} className="animate-fade-up space-y-4">
            <div>
              <h2 className="text-headline-md text-slate-900">Tạo tài khoản</h2>
              <p className="text-body-sm text-slate-500">Bắt đầu quản lý dự án hiệu quả cùng nhóm.</p>
            </div>
            {error && !Object.keys(errors).length && <Notice tone="danger">{error}</Notice>}
            <Field label="Họ và tên" required error={errors.name}>
              <input className="input" value={f.name} onChange={set('name')} placeholder="Nguyễn Văn A" autoComplete="name" />
            </Field>
            <Field label="Email công việc" required error={errors.email}>
              <input type="email" className="input" value={f.email} onChange={set('email')} placeholder="ban@congty.com" autoComplete="email" />
            </Field>
            <Field label="Mật khẩu" required error={errors.password}>
              <PasswordInput value={f.password} onChange={set('password')} autoComplete="new-password" />
              <PasswordStrength value={f.password} />
            </Field>
            <label className="flex items-start gap-2 text-body-sm text-slate-600">
              <input type="checkbox" className="form-checkbox mt-0.5 rounded text-blue-600" checked={f.accept} onChange={set('accept')} />
              <span>
                Tôi đồng ý với <span className="text-blue-600">Điều khoản dịch vụ</span> và <span className="text-blue-600">Chính sách bảo mật</span>
              </span>
            </label>
            {errors.acceptTerms && <p className="field-error">{errors.acceptTerms}</p>}
            <button className="btn-primary h-10 w-full" disabled={busy}>
              {busy && <Spinner />}
              Tạo tài khoản
            </button>
            <GoogleButton />
          </form>
        )}
      </div>
    </AuthLayout>
  );
}
