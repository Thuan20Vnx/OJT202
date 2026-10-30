import { t as tr, useI18n } from '../../lib/i18n.js';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { PasswordInput, PasswordStrength } from './Login.jsx';
import { Field, Icon, Notice, Spinner } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';

function Steps({ step }) {
  useI18n();
  const items = [tr("Yêu cầu"), tr("Kiểm tra email"), tr("Mật khẩu mới")];
  return (
    <div className="mb-6 flex items-center">
      {items.map((label, i) => (
        <div key={label} className="flex flex-1 items-center last:flex-none">
          <div className="flex flex-col items-center gap-1">
            <span className={`flex h-7 w-7 items-center justify-center rounded-full text-label-md font-bold ${i + 1 <= step ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
              {i + 1 < step ? <Icon name="check" size={16} /> : i + 1}
            </span>
            <span className={`whitespace-nowrap text-label-sm ${i + 1 === step ? 'text-blue-700' : 'text-slate-400'}`}>{label}</span>
          </div>
          {i < items.length - 1 && <span className={`mx-2 mb-5 h-0.5 flex-1 rounded ${i + 1 < step ? 'bg-blue-600' : 'bg-slate-200'}`} />}
        </div>
      ))}
    </div>
  );
}

const mask = (email) => email.replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => `${a}${'*'.repeat(Math.min(3, b.length))}${c}`);

export default function ForgotPassword() {
  useI18n();
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();
  const [step, setStep] = useState(token ? 3 : 1);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [expired, setExpired] = useState(false);
  const [cool, setCool] = useState(0);

  useEffect(() => {
    if (token) api.get(`/auth/reset-password/check?token=${encodeURIComponent(token)}`).then((d) => setExpired(!d.valid)).catch(() => {});
  }, [token]);
  useEffect(() => {
    if (cool <= 0) return;
    const t = setTimeout(() => setCool((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cool]);

  const request = async (e) => {
    e?.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError(tr("Vui lòng nhập email hợp lệ"));
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/forgot-password', { email });
      setStep(2);
      setCool(45);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async (e) => {
    e.preventDefault();
    if (pw !== pw2) return setError(tr("Mật khẩu xác nhận không khớp"));
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/reset-password', { token, password: pw });
      setDone(true);
    } catch (err) {
      if (err.details?.code === 'TOKEN_INVALID') setExpired(true);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <div className="card p-6 shadow-card">
        <Steps step={done ? 4 : step} />
        {step === 1 && (
          <form onSubmit={request} className="space-y-4">
            <Link to="/login" className="inline-flex items-center gap-1 text-body-sm text-slate-500 hover:text-slate-800">
              <Icon name="arrow_back" size={16} />{tr(" Quay lại đăng nhập")}</Link>
            <div>
              <h2 className="text-headline-md text-slate-900">{tr("Quên mật khẩu?")}</h2>
              <p className="text-body-sm text-slate-500">{tr("Nhập email, chúng tôi sẽ gửi liên kết đặt lại mật khẩu.")}</p>
            </div>
            {error && <Notice tone="danger">{error}</Notice>}
            <Field label={tr("Email công việc")} required>
              <div className="relative">
                <Icon name="mail" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="email" className="input pl-9" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ban@congty.com" />
              </div>
            </Field>
            <button className="btn-primary h-10 w-full" disabled={busy}>
              {busy && <Spinner />}{tr("Gửi liên kết đặt lại")}<Icon name="send" size={16} />
            </button>
            <div className="flex justify-between text-body-sm">
              <span className="text-slate-400">{tr("Đã nhớ mật khẩu?")}</span>
              <Link to="/login" className="font-semibold text-blue-600">{tr("Đăng nhập ngay")}</Link>
            </div>
          </form>
        )}
        {step === 2 && (
          <div className="space-y-4 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <Icon name="mail" size={30} />
            </span>
            <div>
              <h2 className="text-headline-md text-slate-900">{tr("Kiểm tra hộp thư của bạn")}</h2>
              <p className="mt-1 text-body-sm text-slate-500">{tr("Nếu email tồn tại trong hệ thống, liên kết đặt lại đã được gửi tới ")}<b>{mask(email)}</b>{tr(". Liên kết chỉ dùng được một lần và hết hạn sau 30 phút.")}</p>
            </div>
            <a className="btn-outline w-full" href="mailto:">
              <Icon name="open_in_new" size={16} />{tr(" Mở ứng dụng email")}</a>
            <p className="text-body-sm text-slate-500">{tr("Chưa nhận được?")}{' '}
              {cool > 0 ? (
                <span>{tr("Gửi lại sau 00:")}{String(cool).padStart(2, '0')}</span>
              ) : (
                <button className="font-semibold text-blue-600" onClick={request}>{tr("Gửi lại")}</button>
              )}
            </p>
            <p className="text-label-md font-normal text-slate-400">{tr("Bản phát triển: mở liên kết trong ")}<Link className="text-blue-600 underline" to="/dev/outbox">{tr("hộp thư dev")}</Link>
            </p>
            <button className="text-body-sm text-slate-500 hover:text-slate-800" onClick={() => setStep(1)}>{tr("← Quay lại")}</button>
          </div>
        )}
        {step === 3 &&
          (done ? (
            <div className="space-y-4 text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <Icon name="check_circle" size={32} fill />
              </span>
              <h2 className="text-headline-md text-slate-900">{tr("Đặt lại mật khẩu thành công")}</h2>
              <p className="text-body-sm text-slate-500">{tr("Bạn đã được đăng xuất khỏi tất cả thiết bị. Hãy đăng nhập bằng mật khẩu mới.")}</p>
              <button className="btn-primary w-full" onClick={() => navigate('/login')}>{tr("Đăng nhập")}</button>
            </div>
          ) : expired ? (
            <div className="space-y-4">
              <Notice tone="danger">{tr("Liên kết đã hết hạn hoặc đã được sử dụng.")}</Notice>
              <button className="btn-primary w-full" onClick={() => (setStep(1), setExpired(false), navigate('/forgot-password'))}>{tr("Gửi liên kết mới")}</button>
            </div>
          ) : (
            <form onSubmit={reset} className="space-y-4">
              <div>
                <h2 className="text-headline-md text-slate-900">{tr("Đặt mật khẩu mới")}</h2>
                <p className="text-body-sm text-slate-500">{tr("Bạn sẽ được đăng xuất khỏi tất cả thiết bị sau khi đặt lại.")}</p>
              </div>
              {error && <Notice tone="danger">{error}</Notice>}
              <Field label={tr("Mật khẩu mới")} required>
                <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
                <PasswordStrength value={pw} />
              </Field>
              <Field label={tr("Xác nhận mật khẩu")} required error={pw2 && pw !== pw2 ? tr("Mật khẩu xác nhận không khớp") : ''}>
                <PasswordInput value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
              </Field>
              <button className="btn-primary h-10 w-full" disabled={busy}>
                {busy && <Spinner />}{tr("Đặt lại mật khẩu")}</button>
            </form>
          ))}
      </div>
    </AuthLayout>
  );
}
