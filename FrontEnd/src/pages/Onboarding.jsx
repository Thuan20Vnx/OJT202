import { t as tr, useI18n } from '../lib/i18n.js';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AuthLayout from './auth/AuthLayout.jsx';
import { Field, Icon, Notice, Spinner } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useApp, useToast } from '../lib/app.jsx';

const slugify = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export default function Onboarding() {
  useI18n();
  const { loadMe, setWsId, setProjectId, reloadWorkspace } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [ws, setWs] = useState(null);
  const [f, setF] = useState({ name: '', slug: '', slugTouched: false, size: '6-10' });
  const [emails, setEmails] = useState([]);
  const [emailInput, setEmailInput] = useState('');
  const [role, setRole] = useState('member');
  const [p, setP] = useState({ name: tr("Dự án đầu tiên"), startDate: '', endDate: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const createWs = async () => {
    setBusy(true);
    setErrors({});
    try {
      const { workspace } = await api.post('/workspaces', { name: f.name, slug: f.slug || undefined, size: f.size });
      setWs(workspace);
      await loadMe();
      setWsId(workspace._id);
      setStep(2);
    } catch (e) {
      setErrors({ name: e.fields?.name || e.message });
    } finally {
      setBusy(false);
    }
  };

  const addEmail = () => {
    const v = emailInput.trim().replace(/,$/, '');
    if (!v) return;
    if (!/^\S+@\S+\.\S+$/.test(v)) return setErrors({ email: tr("Email không hợp lệ") });
    if (!emails.includes(v)) setEmails([...emails, v]);
    setEmailInput('');
    setErrors({});
  };

  const invite = async () => {
    if (!emails.length) return setStep(3);
    setBusy(true);
    try {
      const d = await api.post(`/workspaces/${ws._id}/invites`, { emails, role });
      toast(tr("Đã gửi {0} lời mời", [d.created.length]));
      setStep(3);
    } catch (e) {
      setErrors({ email: e.message });
    } finally {
      setBusy(false);
    }
  };

  const createProject = async () => {
    setBusy(true);
    setErrors({});
    try {
      const { project } = await api.post(`/workspaces/${ws._id}/projects`, { name: p.name, startDate: p.startDate || null, endDate: p.endDate || null, color: 'blue' });
      await reloadWorkspace();
      setProjectId(project._id);
      navigate('/board');
    } catch (e) {
      setErrors(e.fields || { name: e.message });
    } finally {
      setBusy(false);
    }
  };

  const STEPS = ['Workspace', tr("Mời thành viên"), tr("Dự án đầu tiên")];
  return (
    <AuthLayout title={[tr("Chào mừng đến TaskFlow"), tr("Bắt đầu với nhóm của bạn")]} subtitle={tr("Chỉ mất 1 phút để thiết lập.")}>
      <div className="card p-6 shadow-card">
        <div className="mb-6 flex items-center">
          {STEPS.map((label, i) => (
            <div key={label} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <span className={`flex h-7 w-7 items-center justify-center rounded-full text-label-md font-bold ${i + 1 <= step ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'}`}>{i + 1 < step ? <Icon name="check" size={16} /> : i + 1}</span>
                <span className={`whitespace-nowrap text-label-sm ${i + 1 === step ? 'text-blue-700' : 'text-slate-400'}`}>{label}</span>
              </div>
              {i < 2 && <span className={`mx-2 mb-5 h-0.5 flex-1 rounded ${i + 1 < step ? 'bg-blue-600' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-headline-md text-slate-900">{tr("Tạo không gian làm việc")}</h2>
              <p className="text-body-sm text-slate-500">{tr("Dữ liệu trong workspace chỉ thành viên mới xem được.")}</p>
            </div>
            <Field label={tr("Tên workspace")} required error={errors.name}>
              <input
                autoFocus
                className={`input ${errors.name ? 'input-error' : ''}`}
                value={f.name}
                onChange={(e) => setF((s) => ({ ...s, name: e.target.value, slug: s.slugTouched ? s.slug : slugify(e.target.value) }))}
                placeholder={tr("Nhóm 24 - Product Hub")}
              />
            </Field>
            <Field label={tr("Địa chỉ truy cập (URL)")}>
              <div className="flex">
                <span className="inline-flex items-center rounded-l-lg border border-r-0 border-slate-200 bg-slate-50 px-3 text-body-sm text-slate-500">taskflow.app/</span>
                <input className="input rounded-l-none" value={f.slug} onChange={(e) => setF((s) => ({ ...s, slug: slugify(e.target.value), slugTouched: true }))} placeholder="nhom-24" />
              </div>
            </Field>
            <div>
              <span className="label">{tr("Quy mô nhóm")}</span>
              <div className="grid grid-cols-3 gap-2">
                {['2-5', '6-10', '11-20'].map((s) => (
                  <button key={s} type="button" onClick={() => setF((x) => ({ ...x, size: s }))} className={`rounded-lg border py-2 text-label-md ${f.size === s ? 'border-blue-500 bg-blue-50 font-semibold text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                    {s.replace('-', '–')}{tr(" người")}</button>
                ))}
              </div>
            </div>
            <Notice tone="info">{tr("Bạn sẽ là Owner (chủ sở hữu) của workspace này và có toàn quyền quản trị thành viên.")}</Notice>
            <button className="btn-primary h-10 w-full" onClick={createWs} disabled={busy || !f.name.trim()}>
              {busy && <Spinner />}{tr("Tiếp tục")}</button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-headline-md text-slate-900">{tr("Mời thành viên")}</h2>
              <p className="text-body-sm text-slate-500">{tr("Nhập email rồi nhấn Enter. Có thể bỏ qua và mời sau.")}</p>
            </div>
            <Field label={tr("Email thành viên")} error={errors.email}>
              <div className="flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 focus-within:border-blue-600">
                {emails.map((e) => (
                  <span key={e} className="chip border-blue-200 bg-blue-50 text-blue-700">
                    {e}
                    <button onClick={() => setEmails(emails.filter((x) => x !== e))}>
                      <Icon name="close" size={12} />
                    </button>
                  </span>
                ))}
                <input
                  className="min-w-[160px] flex-1 border-0 p-0 text-body-sm focus:ring-0"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ',') && (e.preventDefault(), addEmail())}
                  onBlur={addEmail}
                  placeholder="ten@nhom24.edu.vn"
                />
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['member', tr("Thành viên (Member)"), tr("Tạo, nhận việc và bình luận")],
                ['viewer', tr("Khách xem (Viewer)"), tr("Chỉ xem, không chỉnh sửa")],
              ].map(([v, t, d]) => (
                <button key={v} type="button" onClick={() => setRole(v)} className={`rounded-xl border p-3 text-left ${role === v ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <p className="text-label-lg font-semibold text-slate-900">{t}</p>
                  <p className="text-label-md font-normal text-slate-500">{d}</p>
                </button>
              ))}
            </div>
            <p className="flex items-center gap-1.5 text-label-md font-normal text-amber-700">
              <Icon name="schedule" size={14} />{tr(" Lời mời hết hạn sau 72 giờ")}</p>
            <button className="btn-primary h-10 w-full" onClick={invite} disabled={busy}>
              {busy && <Spinner />}
              {emails.length ? tr("Gửi lời mời & tiếp tục") : tr("Tiếp tục")}
            </button>
            <div className="flex justify-between text-body-sm">
              <button className="text-slate-500 hover:text-slate-800" onClick={() => setStep(1)} disabled>{tr("← Quay lại")}</button>
              <button className="font-semibold text-blue-600" onClick={() => setStep(3)}>{tr("Bỏ qua bước này")}</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-headline-md text-slate-900">{tr("Tạo dự án đầu tiên")}</h2>
              <p className="text-body-sm text-slate-500">{tr("Bảng Kanban gồm 4 cột: Cần làm, Đang thực hiện, Đang kiểm duyệt, Hoàn thành.")}</p>
            </div>
            <Field label={tr("Tên dự án")} required error={errors.name}>
              <input className="input" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={tr("Ngày bắt đầu")}>
                <input type="date" className="input" value={p.startDate} onChange={(e) => setP({ ...p, startDate: e.target.value })} />
              </Field>
              <Field label={tr("Ngày kết thúc")} error={errors.endDate}>
                <input type="date" className={`input ${errors.endDate ? 'input-error' : ''}`} value={p.endDate} onChange={(e) => setP({ ...p, endDate: e.target.value })} />
              </Field>
            </div>
            <button className="btn-primary h-10 w-full" onClick={createProject} disabled={busy || !p.name.trim()}>
              {busy && <Spinner />}{tr("Vào workspace")}</button>
            <div className="flex justify-between text-body-sm">
              <button className="text-slate-500 hover:text-slate-800" onClick={() => setStep(2)}>{tr("← Quay lại")}</button>
              <button className="font-semibold text-blue-600" onClick={() => navigate('/projects')}>{tr("Để sau")}</button>
            </div>
          </div>
        )}
      </div>
    </AuthLayout>
  );
}
