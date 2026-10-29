import { t as tr, useI18n } from '../lib/i18n.js';
import { useEffect, useRef, useState } from 'react';
import { Avatar, ErrorBox, Field, Icon, Notice, PageHeader, PageLoader, Select, Spinner, Tabs } from '../components/ui.jsx';
import { PasswordInput, PasswordStrength } from './auth/Login.jsx';
import { api } from '../lib/api.js';
import { useApp, useLoad, useToast } from '../lib/app.jsx';
import { ROLE, parseUA, timeAgo } from '../lib/format.js';
import { useNavigate } from 'react-router-dom';

const getTimezones = () => [
  ['Asia/Ho_Chi_Minh', tr("(GMT+07:00) Hà Nội, Bangkok")],
  ['Asia/Singapore', '(GMT+08:00) Singapore'],
  ['Asia/Tokyo', '(GMT+09:00) Tokyo'],
  ['Europe/London', '(GMT+00:00) London'],
  ['America/New_York', '(GMT-05:00) New York'],
];

export default function Profile() {
  useI18n();
  const { me, setMe, role, logout } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState('info');
  const [f, setF] = useState({ name: me.name, title: me.title || '', timezone: me.timezone, language: me.language });
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwErr, setPwErr] = useState({});
  const [pwBusy, setPwBusy] = useState(false);
  const sessions = useLoad(() => api.get('/me/sessions'), []);
  const [sessionError, setSessionError] = useState(null);
  const [sessionBusy, setSessionBusy] = useState(false);
  const sessionPending = useRef(false);
  const previousProfile = useRef(me);
  useEffect(() => {
    const previous = previousProfile.current;
    const languageOnly = previous._id === me._id && previous.name === me.name && previous.title === me.title && previous.timezone === me.timezone;
    setF(current => languageOnly ? { ...current, language: me.language } : { name: me.name, title: me.title || '', timezone: me.timezone, language: me.language });
    previousProfile.current = me;
  }, [me]);

  const save = async () => {
    setBusy(true);
    try {
      const d = await api.patch('/me', f);
      setMe(d.user);
      toast(tr("Đã lưu thay đổi"));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const changePw = async () => {
    if (pw.newPassword !== pw.confirm) return setPwErr({ confirm: tr("Mật khẩu xác nhận không khớp") });
    setPwBusy(true);
    setPwErr({});
    try {
      const d = await api.post('/me/password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      toast(tr("Đã cập nhật mật khẩu · đăng xuất {0} phiên khác", [d.revokedSessions]));
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      sessions.reload();
    } catch (e) {
      setPwErr(Object.keys(e.fields || {}).length ? e.fields : { _form: e.message });
    } finally {
      setPwBusy(false);
    }
  };
  const revoke = async (s) => {
    if (sessionPending.current) return;
    sessionPending.current = true;
    setSessionBusy(true);
    setSessionError(null);
    try {
      const d = await api.del(`/me/sessions/${s._id}`);
      if (d.current) {
        await logout();
        navigate('/login');
      } else await sessions.reload();
    } catch (e) {
      setSessionError(e);
    } finally {
      sessionPending.current = false;
      setSessionBusy(false);
    }
  };
  const revokeOthers = async () => {
    if (sessionPending.current) return;
    sessionPending.current = true;
    setSessionBusy(true);
    setSessionError(null);
    try {
      const d = await api.post('/me/sessions/revoke-others');
      toast(tr("Đã đăng xuất {0} phiên khác", [d.revoked]));
      await sessions.reload();
    } catch (e) {
      setSessionError(e);
    } finally {
      sessionPending.current = false;
      setSessionBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader title={tr("Hồ sơ cá nhân")} subtitle={tr("Quản lý thông tin và bảo mật tài khoản của bạn")} />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'info', label: tr("Thông tin cá nhân"), icon: 'person' },
          { value: 'security', label: tr("Bảo mật"), icon: 'shield' },
        ]}
      />
      {tab === 'info' && (
        <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
          <div className="card space-y-4 p-5">
            <div>
              <h2 className="text-headline-sm text-slate-900">{tr("Chi tiết tài khoản")}</h2>
              <p className="text-body-sm text-slate-500">{tr("Thông tin định danh hiển thị trên toàn workspace.")}</p>
            </div>
            <div className="flex items-center gap-4">
              <Avatar user={me} size={72} />
              <p className="text-label-md font-normal text-slate-500">{tr("Ảnh đại diện được tạo từ chữ cái đầu của tên.")}</p>
            </div>
            <Field label={tr("Họ và tên")} required>
              <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
            <Field label={tr("Chức danh hiển thị")}>
              <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="vd PM, Backend Dev" />
            </Field>
            <Field label={tr("Địa chỉ email")} hint={tr("Email đăng nhập không thể tự thay đổi.")}>
              <div className="relative">
                <input className="input pr-28" value={me.email} disabled />
                {me.emailVerified && (
                  <span className="chip absolute right-2 top-1/2 -translate-y-1/2 border-emerald-200 bg-emerald-50 text-emerald-700">
                    <Icon name="verified" size={12} />{tr(" Đã xác minh")}</span>
                )}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={tr("Múi giờ")}>
                <Select className="input" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
                  {getTimezones().map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={tr("Ngôn ngữ hiển thị")}>
                <Select className="input" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}>
                  <option value="vi">{tr("Tiếng Việt")}</option>
                  <option value="en">English</option>
                </Select>
              </Field>
            </div>
            <Field label={tr("Vai trò trong workspace")}>
              <div className="relative">
                <Icon name="lock" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="input pl-9" value={ROLE[role] || '—'} disabled />
              </div>
              <span className="mt-1 block text-label-md font-normal text-slate-400">{tr("Vai trò do Owner/Admin của workspace quản lý, không thể tự thay đổi.")}</span>
            </Field>
            <div className="flex justify-end gap-2">
              <button className="btn-outline" onClick={() => setF({ name: me.name, title: me.title || '', timezone: me.timezone, language: me.language })}>{tr("Hủy")}</button>
              <button className="btn-primary" onClick={save} disabled={busy || !f.name.trim()}>
                {busy && <Spinner />}{tr("Lưu thay đổi")}</button>
            </div>
          </div>
          <PasswordCard pw={pw} setPw={setPw} pwErr={pwErr} busy={pwBusy} onSubmit={changePw} />
        </div>
      )}
      {tab === 'security' && (
        <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
          <PasswordCard pw={pw} setPw={setPw} pwErr={pwErr} busy={pwBusy} onSubmit={changePw} />
          <div className="card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-headline-sm text-slate-900">{tr("Phiên đăng nhập đang hoạt động")}</h2>
                <p className="text-body-sm text-slate-500">{tr("Danh sách thiết bị đang đăng nhập tài khoản của bạn.")}</p>
              </div>
              <button className="btn border border-rose-200 text-rose-600 hover:bg-rose-50" disabled={sessionBusy} onClick={revokeOthers}>
                <Icon name="logout" size={16} />{tr(" Đăng xuất khỏi tất cả thiết bị khác")}</button>
            </div>
            <div className="space-y-2">
              <ErrorBox error={sessionError} />
              {sessions.loading && !sessions.data ? <PageLoader /> : <ErrorBox error={sessions.error} onRetry={sessions.reload} />}
              {(sessions.data?.sessions || []).map((s) => {
                const ua = parseUA(s.userAgent);
                return (
                  <div key={s._id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                      <Icon name={ua.icon} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-body-sm font-semibold text-slate-900">
                        {ua.browser}{tr(" trên ")}{ua.os}
                        {s.current && <span className="chip border-emerald-200 bg-emerald-50 text-emerald-700">{tr("Thiết bị này")}</span>}
                      </p>
                      <p className="text-label-md font-normal text-slate-500">
                        IP {s.ip || '—'} · {s.current ? tr("Đang hoạt động") : timeAgo(s.lastUsedAt)}
                      </p>
                    </div>
                    <button className="btn-outline btn-sm" disabled={sessionBusy} onClick={() => revoke(s)}>{tr("Đăng xuất")}</button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PasswordCard({ pw, setPw, pwErr, busy, onSubmit }) {
  useI18n();
  return (
    <div className="card h-fit space-y-4 p-5">
      <div>
        <h2 className="text-headline-sm text-slate-900">{tr("Đổi mật khẩu")}</h2>
        <p className="text-body-sm text-slate-500">{tr("Bảo vệ tài khoản bằng mật khẩu mạnh.")}</p>
      </div>
      {pwErr._form && <Notice tone="danger">{pwErr._form}</Notice>}
      <Field label={tr("Mật khẩu hiện tại")} error={pwErr.currentPassword}>
        <PasswordInput value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} autoComplete="current-password" />
      </Field>
      <Field label={tr("Mật khẩu mới")} error={pwErr.newPassword}>
        <PasswordInput value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} autoComplete="new-password" />
        <PasswordStrength value={pw.newPassword} />
      </Field>
      <Field label={tr("Xác nhận mật khẩu mới")} error={pwErr.confirm}>
        <PasswordInput value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" />
      </Field>
      <Notice tone="warn">{tr("Sau khi đổi mật khẩu, bạn sẽ được đăng xuất khỏi tất cả thiết bị khác.")}</Notice>
      <button className="btn-primary w-full" onClick={onSubmit} disabled={busy || !pw.currentPassword || !pw.newPassword}>
        {busy ? <Spinner /> : <Icon name="lock_reset" size={16} />}{tr("Cập nhật mật khẩu")}</button>
    </div>
  );
}
