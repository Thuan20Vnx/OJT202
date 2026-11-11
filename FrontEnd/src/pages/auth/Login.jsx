import { t as tr, useI18n } from '../../lib/i18n.js';
import { useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout, { AuthSuccess } from './AuthLayout.jsx';
import { Field, Icon, Notice, Spinner } from '../../components/ui.jsx';
import GoogleSignIn from './GoogleSignIn.jsx';
import { api } from '../../lib/api.js';
import { useApp } from '../../lib/app.jsx';

export function PasswordInput({ value, onChange, error, placeholder = '••••••••', autoComplete }) {
  useI18n();
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
        aria-label={tr("Hiện/ẩn mật khẩu")}
      >
        <Icon name={show ? 'visibility_off' : 'visibility'} size={18} />
      </button>
    </div>
  );
}

export function PasswordStrength({ value }) {
  useI18n();

  const rules = [
    [value.length >= 8, tr("Ít nhất 8 ký tự")],
    [/[A-Z]/.test(value), tr("Có chữ hoa")],
    [/[0-9]/.test(value), tr("Có số")],
  ];
  const tooLong = new TextEncoder().encode(value).length > 72;
  const score = tooLong ? 0 : rules.filter((rule) => rule[0]).length;
  const label = [tr("Yếu"), tr("Yếu"), tr("Trung bình"), tr("Mạnh")][score];
  const tone = ['bg-rose-500', 'bg-rose-500', 'bg-amber-500', 'bg-emerald-500'][score];

  return (
    <div className="mt-2">
      {tooLong && (
        <p className="mb-1 text-body-sm text-rose-600">
          {tr("Mật khẩu vượt 72 byte UTF-8; hãy rút ngắn (ký tự có dấu có thể chiếm nhiều byte).")}
        </p>
      )}
      <div className="flex items-center justify-between text-label-md font-normal text-slate-500">
        <span>{tr("Độ mạnh mật khẩu")}</span>
        <span className={score === 3 ? 'font-semibold text-emerald-600' : ''}>
          {value ? label : ''}
        </span>
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className={`h-1 rounded-full ${i < score ? tone : 'bg-slate-200'}`} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {rules.map(([ok, text]) => (
          <span
            key={text}
            className={`flex items-center gap-1 text-label-md font-normal ${ok ? 'text-emerald-600' : 'text-slate-400'}`}
          >
            <Icon name={ok ? 'check_circle' : 'radio_button_unchecked'} size={14} />
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}

export function OtpInput({ value, onChange, error, autoFocus }) {
  useI18n();

  return (
    <input
      className={`input text-center text-headline-md tracking-[0.5em] ${error ? 'input-error' : ''}`}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      autoFocus={autoFocus}
      placeholder="••••••"
      aria-label={tr("Mã OTP 6 số")}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
    />
  );
}

export default function Login({ initialTab = 'login' }) {
  useI18n();

  const [tab, setTab] = useState(initialTab);
  const { loadMe } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [f, setF] = useState({
    name: '',
    email: '',
    password: '',
    remember: true,
    accept: false,
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  const [code, setCode] = useState('');
  const [mailPending, setMailPending] = useState(false);
  const [resendNotice, setResendNotice] = useState('');
  const resendPending = useRef(false);
  const [unverified, setUnverified] = useState(false);
  const [success, setSuccess] = useState(false);
  const formRef = useRef(null);

  const fail = (err) => {
    const left = err.details?.attemptsLeft;
    setError(
      left > 0 && left <= 2
        ? `${err.message}. ${tr("Còn {0} lần thử trước khi tạm khóa.", [left])}`
        : err.message,
    );
    setErrors(err.fields || {});

    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      formRef.current?.animate(
        [0, -6, 6, -4, 4, -2, 0].map((x) => ({ transform: `translateX(${x}px)` })),
        { duration: 400, easing: 'ease-in-out' },
      );
    }
  };

  const set = (key) => (e) => {
    setF((current) => ({
      ...current,
      [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }));
  };

  const finish = async () => {
    setSuccess(true);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const data = await loadMe();

    navigate(
      params.get('next') ||
        (data?.workspaces?.length
          ? '/overview'
          : data?.user?.isSystemAdmin
            ? '/admin'
            : '/onboarding'),
      { replace: true },
    );
  };

  const google = async (credential) => {
    setBusy(true);
    setError('');
    setErrors({});

    try {
      await api.post('/auth/google', {
        credential,
        remember: f.remember,
        acceptTerms: tab === 'register' && f.accept,
      });
      await finish();
    } catch (err) {
      setSuccess(false);
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async (e) => {
    e.preventDefault();

    if (code.length !== 6) {
      setError(tr("Nhập đủ 6 chữ số"));
      return;
    }

    setBusy(true);
    setError('');

    try {
      await api.post('/auth/verify-otp', { email: sent, code });
      await finish();
    } catch (err) {
      setSuccess(false);
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const login = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    setUnverified(false);

    try {
      await api.post('/auth/login', {
        email: f.email,
        password: f.password,
        remember: f.remember,
      });
      await finish();
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
      await api.post('/auth/register', {
        name: f.name,
        email: f.email,
        password: f.password,
        acceptTerms: f.accept,
        website: e.target.elements.website?.value || undefined,
      });
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
      setResendNotice(
        tr("Đã yêu cầu gửi lại email xác minh. Vui lòng kiểm tra hộp thư và thư rác; nếu chưa nhận được, hãy thử lại sau."),
      );
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
          <AuthSuccess title={tr("Đăng nhập thành công")} progressMs={1100}>
            {tr("Chào mừng quay trở lại! Đang mở không gian làm việc của bạn…")}
          </AuthSuccess>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="card p-6 shadow-card">
        <div className="relative mb-5 grid grid-cols-2 rounded-lg bg-slate-100 p-1">
          <span
            aria-hidden="true"
            className="absolute bottom-1 top-1 w-[calc(50%-4px)] rounded-md bg-white shadow-sm transition-transform duration-300 ease-out"
            style={{
              transform: `translateX(${tab === 'login' ? '4px' : 'calc(100% + 4px)'})`,
              left: 0,
            }}
          />
          {[
            ['login', 'login', tr("Đăng nhập")],
            ['register', 'person_add', tr("Đăng ký")],
          ].map(([key, icon, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
                setError('');
                setErrors({});
                setSent(null);
                setCode('');
                setMailPending(false);
                setResendNotice('');
              }}
              className={`relative flex items-center justify-center gap-1.5 rounded-md py-2 text-label-lg transition-colors duration-300 ${
                tab === key
                  ? 'font-semibold text-blue-700'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon name={icon} size={18} />
              {label}
            </button>
          ))}
        </div>

        {tab === 'login' ? (
          <form ref={formRef} onSubmit={login} className="animate-fade-up space-y-4">
            <div>
              <h2 className="text-headline-md text-slate-900">
                {tr("Chào mừng quay trở lại")}
              </h2>
              <p className="text-body-sm text-slate-500">
                {tr("Nhập thông tin tài khoản TaskFlow của bạn để tiếp tục.")}
              </p>
            </div>

            {error && (
              <Notice tone="danger">
                {error}
                {unverified && (
                  <button
                    type="button"
                    className="ml-1 font-semibold underline"
                    onClick={resend}
                    disabled={busy}
                  >
                    {tr("Gửi lại email xác minh")}
                  </button>
                )}
              </Notice>
            )}
            {resendNotice && <Notice tone="info">{resendNotice}</Notice>}

            <Field label={tr("Email công việc")} required error={errors.email}>
              <div className="relative">
                <Icon
                  name="mail"
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="email"
                  autoComplete="email"
                  className="input pl-9"
                  value={f.email}
                  onChange={set('email')}
                  placeholder="ban@congty.com"
                />
              </div>
            </Field>

            <Field label={tr("Mật khẩu")} required error={errors.password}>
              <PasswordInput
                value={f.password}
                onChange={set('password')}
                autoComplete="current-password"
              />
            </Field>

            <div className="flex items-center justify-between text-body-sm">
              <label className="flex items-center gap-2 text-slate-600">
                <input
                  type="checkbox"
                  className="form-checkbox rounded text-blue-600"
                  checked={f.remember}
                  onChange={set('remember')}
                />
                {tr("Ghi nhớ đăng nhập")}
              </label>
              <Link to="/forgot-password" className="font-semibold text-blue-600 hover:underline">
                {tr("Quên mật khẩu?")}
              </Link>
            </div>

            <button className="btn-primary h-10 w-full" disabled={busy}>
              {busy && <Spinner />}
              {tr("Đăng nhập")}
              <Icon name="arrow_forward" size={18} />
            </button>

            <div className="flex items-center gap-3 text-label-md font-normal text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              {tr("hoặc")}
              <span className="h-px flex-1 bg-slate-200" />
            </div>

            <GoogleSignIn onCredential={google} disabled={busy} />
          </form>
        ) : sent ? (
          <AuthSuccess
            title={mailPending ? tr("Tài khoản đang chờ xác minh") : tr("Đăng ký thành công!")}
            tone="blue"
            action={
              <>
                {!mailPending && (
                  <form onSubmit={verifyOtp} className="mb-3 space-y-3 text-left">
                    <Field label={tr("Nhập mã OTP 6 số trong email")}>
                      <OtpInput value={code} onChange={setCode} autoFocus />
                    </Field>
                    <button
                      className="btn-primary h-10 w-full"
                      disabled={busy || code.length !== 6}
                    >
                      {busy && <Spinner />}
                      {tr("Xác minh")}
                    </button>
                  </form>
                )}

                {error && <Notice tone="danger">{error}</Notice>}
                {resendNotice && <Notice tone="info">{resendNotice}</Notice>}

                <button className="btn-outline" onClick={resend} disabled={busy}>
                  <Icon name="forward_to_inbox" size={18} />
                  {tr("Gửi lại email")}
                </button>

                <p className="mt-3 text-label-md font-normal text-slate-400">
                  {tr("Bản phát triển: xem email tại")}{' '}
                  <Link className="text-blue-600 underline" to="/dev/outbox">
                    {tr("hộp thư dev")}
                  </Link>
                </p>
              </>
            }
          >
            {mailPending ? (
              <>
                {tr("Tài khoản ")}
                <b>{sent}</b>
                {tr(" đã được tạo, nhưng email chưa gửi được. Bạn có thể gửi lại mà không cần đăng ký lần nữa.")}
              </>
            ) : (
              <>
                {tr("Kiểm tra hộp thư: chúng tôi đã gửi email xác minh tới ")}
                <b>{sent}</b>
                {tr(". Nhập mã OTP (hiệu lực 10 phút) hoặc bấm liên kết trong email (hiệu lực 24 giờ).")}
              </>
            )}
          </AuthSuccess>
        ) : (
          <form ref={formRef} onSubmit={register} className="animate-fade-up space-y-4">
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="absolute -left-[9999px] h-0 w-0 opacity-0"
            />

            <div>
              <h2 className="text-headline-md text-slate-900">{tr("Tạo tài khoản")}</h2>
              <p className="text-body-sm text-slate-500">
                {tr("Bắt đầu quản lý dự án hiệu quả cùng nhóm.")}
              </p>
            </div>

            {error && !Object.keys(errors).length && <Notice tone="danger">{error}</Notice>}

            <Field label={tr("Họ và tên")} required error={errors.name}>
              <input
                className="input"
                value={f.name}
                onChange={set('name')}
                placeholder={tr("Nguyễn Văn A")}
                autoComplete="name"
              />
            </Field>

            <Field label={tr("Email công việc")} required error={errors.email}>
              <input
                type="email"
                className="input"
                value={f.email}
                onChange={set('email')}
                placeholder="ban@congty.com"
                autoComplete="email"
              />
            </Field>

            <Field label={tr("Mật khẩu")} required error={errors.password}>
              <PasswordInput
                value={f.password}
                onChange={set('password')}
                autoComplete="new-password"
              />
              <PasswordStrength value={f.password} />
            </Field>

            <label className="flex items-start gap-2 text-body-sm text-slate-600">
              <input
                type="checkbox"
                className="form-checkbox mt-0.5 rounded text-blue-600"
                checked={f.accept}
                onChange={set('accept')}
              />
              <span>
                {tr("Tôi đồng ý với ")}
                <span className="text-blue-600">{tr("Điều khoản dịch vụ")}</span>
                {tr(" và ")}
                <span className="text-blue-600">{tr("Chính sách bảo mật")}</span>
              </span>
            </label>

            {errors.acceptTerms && <p className="field-error">{errors.acceptTerms}</p>}

            <button className="btn-primary h-10 w-full" disabled={busy}>
              {busy && <Spinner />}
              {tr("Tạo tài khoản")}
            </button>

            <GoogleSignIn onCredential={google} disabled={busy} />
          </form>
        )}
      </div>
    </AuthLayout>
  );
}