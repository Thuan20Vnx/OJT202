import { t as tr, translateError, useI18n } from '../lib/i18n.js';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar, Empty, ErrorBox, Icon, PageHeader, PageLoader, Spinner, StatCard, Toggle } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useApp, useLoad, useToast } from '../lib/app.jsx';
import { timeAgo } from '../lib/format.js';
import { useSocketEvent } from '../lib/hooks.js';
import { SEVERITY } from './Overview.jsx';

export default function Risks() {
  useI18n();
  const { project } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState('all');
  const [type, setType] = useState('');
  const [ai, setAi] = useState({});
  const [explaining, setExplaining] = useState(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const { data, error, loading, reload, setData } = useLoad(() => (project ? api.get(`/projects/${project._id}/risks`) : Promise.resolve(null)), [project?._id]);
  useSocketEvent(
    'task:changed',
    () => {
      setAi({});
      reload();
    },
    [reload],
  );
  useSocketEvent(
    'risks:changed',
    () => {
      setAi({});
      reload();
    },
    [reload],
  );

  if (!project) return <Empty icon="folder_off" title={tr("Chưa có dự án")} />;
  if (loading && !data) return <PageLoader />;
  if (error)
    return (
      <div className="p-6">
        <ErrorBox error={error} onRetry={reload} />
      </div>
    );

  const open = data.open;
  const counts = {
    overdue: open.filter((a) => a.type === 'overdue').length,
    blocked: open.filter((a) => a.type === 'blocked').length,
    overload: open.filter((a) => a.type === 'overload').length,
  };
  let list = open;
  if (tab === 'critical') list = list.filter((a) => a.severity === 'critical');
  if (tab === 'warning') list = list.filter((a) => a.severity === 'warning');
  if (type) list = list.filter((a) => a.type === type);
  const canManage = data.access.canManage;

  const resolve = async (a) => {
    try {
      await api.post(`/projects/${project._id}/risks/resolve`, { key: a.key, title: a.title });
      toast(tr("Đã đánh dấu cảnh báo là đã xử lý"));
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const unresolve = async (r) => {
    try {
      await api.del(`/projects/${project._id}/risks/resolve?key=${encodeURIComponent(r.key)}`);
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const explain = async (a) => {
    setExplaining(a.key);
    try {
      const d = await api.post(`/projects/${project._id}/risks/explain`, { key: a.key });
      setAi((x) => ({ ...x, [a.key]: d.explanation }));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setExplaining(null);
    }
  };
  const setRule = async (k, v) => {
    try {
      const d = await api.put(`/projects/${project._id}/risk-rules`, { [k]: v });
      setData((x) => ({ ...x, rules: d.riskRules }));
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const r = data.rules;
  const RULES = [
    ['overdue', tr("Quá hạn ≥ {0} ngày", [r.overdueDays ?? 1]), 'overdueDays', tr("ngày")],
    ['blockedByOverdue', tr("Bị chặn bởi việc quá hạn")],
    ['overload', tr("Tải tuần > {0}% giờ khả dụng", [r.overloadPct]), 'overloadPct', '%'],
    ['dueSoon', tr("Đến hạn trong 24 giờ và tiến độ < {0}%", [r.dueSoonProgressPct]), 'dueSoonProgressPct', '%'],
  ];

  return (
    <div className="mx-auto max-w-7xl p-6">
      <Link to="/overview" className="mb-2 inline-flex items-center gap-1 text-body-sm text-slate-500 hover:text-slate-800">
        <Icon name="arrow_back" size={16} />{tr(" Tổng quan")}</Link>
      <PageHeader
        title={tr("Cảnh báo rủi ro")}
        subtitle={tr("{0} · cập nhật {1}", [project.name, timeAgo(new Date())])}
        actions={
          <>
            {canManage && (
              <button className="btn-outline" onClick={() => setRulesOpen((o) => !o)}>
                <Icon name="tune" size={16} />{tr(" Cấu hình quy tắc")}</button>
            )}
            <button className="btn-outline" onClick={reload}>
              <Icon name="refresh" size={16} />{tr(" Làm mới")}</button>
          </>
        }
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard
          label={tr("Quá hạn")}
          value={tr("{0} việc", [counts.overdue])}
          icon="event_busy"
          tone="red"
          active={type === 'overdue'}
          onClick={() => setType(type === 'overdue' ? '' : 'overdue')}
        />
        <StatCard
          label={tr("Bị chặn")}
          value={tr("{0} chuỗi", [counts.blocked])}
          icon="block"
          tone="amber"
          active={type === 'blocked'}
          onClick={() => setType(type === 'blocked' ? '' : 'blocked')}
        />
        <StatCard
          label={tr("Thành viên quá tải")}
          value={tr("{0} người", [counts.overload])}
          icon="person_alert"
          tone="purple"
          active={type === 'overload'}
          onClick={() => setType(type === 'overload' ? '' : 'overload')}
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div>
          <div className="mb-3 flex flex-wrap gap-2">
            {[
              ['all', tr("Tất cả ({0})", [open.length])],
              ['critical', tr("Nghiêm trọng ({0})", [open.filter((a) => a.severity === 'critical').length])],
              ['warning', tr("Cảnh báo ({0})", [open.filter((a) => a.severity === 'warning').length])],
            ].map(([v, l]) => (
              <button key={v} className={`pill-tab ${tab === v ? 'pill-tab-active' : ''}`} onClick={() => setTab(v)}>
                {l}
              </button>
            ))}
          </div>
          <div className="space-y-3">
            {list.map((a) => (
              <div key={a.key} className={`card border-l-4 p-4 ${a.severity === 'critical' ? 'border-l-rose-500' : 'border-l-amber-400'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`chip ${SEVERITY[a.severity].chip}`}>
                    <Icon name={SEVERITY[a.severity].icon} size={12} /> {SEVERITY[a.severity].label}
                  </span>
                  <span className="chip border-slate-200 bg-slate-50 text-slate-600">
                    <Icon name="rule" size={12} />{tr(" Quy tắc: ")}{translateError(a.rule)}
                  </span>
                  {a.owner && (
                    <span className="ml-auto flex items-center gap-1.5 text-label-md font-normal text-slate-500">
                      <Avatar user={a.owner} size={20} /> {a.owner.name}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-headline-sm text-slate-900">{translateError(a.title)}</p>
                <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2">
                  <p className="flex items-center gap-1.5 text-label-md text-slate-500">
                    <Icon name={ai[a.key] ? 'auto_awesome' : 'help'} size={14} className={ai[a.key] ? 'text-purple-500' : ''} />{tr("Vì sao? ")}<span className="font-normal">{ai[a.key] ? tr("· Diễn giải bởi AI") : tr("· Giải thích theo quy tắc")}</span>
                  </p>
                  <p className="mt-0.5 text-body-sm text-slate-700">{ai[a.key] || translateError(a.explanation)}</p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {a.tasks.map((t) => (
                    <button
                      key={t._id}
                      onClick={() => navigate({ search: `?task=${t._id}` })}
                      className="chip border-slate-200 bg-white font-mono text-blue-700 hover:border-blue-300"
                      title={t.title}
                    >
                      {t.key}
                    </button>
                  ))}
                  <span className="ml-auto flex flex-wrap gap-2">
                    {!ai[a.key] && (
                      <button className="btn-ghost btn-sm text-purple-700" onClick={() => explain(a)} disabled={explaining === a.key}>
                        {explaining === a.key ? <Spinner /> : <Icon name="auto_awesome" size={16} />}{tr(" Diễn giải bằng AI")}</button>
                    )}
                    <button className="btn-primary btn-sm" onClick={() => navigate({ search: `?task=${a.tasks[0]._id}` })}>{tr("Xem công việc")}</button>
                    <button className="btn-outline btn-sm" onClick={() => navigate({ search: `?task=${a.tasks[0]._id}` })}>{tr("Giao lại")}</button>
                    {data.access.canWrite && (
                      <button className="btn-ghost btn-sm" onClick={() => resolve(a)}>
                        <Icon name="check" size={16} />{tr(" Đã xử lý")}</button>
                    )}
                  </span>
                </div>
              </div>
            ))}
            {!list.length && (
              <div className="card">
                <Empty icon="verified" title={tr("Không có cảnh báo")}>{tr("Chưa có quy tắc nào bị kích hoạt trong nhóm này.")}</Empty>
              </div>
            )}
          </div>
        </div>
        <div className="space-y-4">
          <div className="card p-4">
            <p className="mb-3 flex items-center gap-1.5 text-label-lg font-semibold text-slate-900">
              <Icon name="rule" size={18} className="text-blue-600" />{tr(" Quy tắc đang áp dụng")}</p>
            <div className="space-y-3">
              {RULES.map(([k, label, numKey, unit]) => (
                <div key={k} className="rounded-lg border border-slate-100 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-body-sm text-slate-800">{label}</span>
                    <Toggle checked={r[k] !== false} onChange={(v) => setRule(k, v)} disabled={!canManage} label={label} />
                  </div>
                  {rulesOpen && numKey && (
                    <label className="mt-2 flex items-center gap-2 text-label-md font-normal text-slate-500">{tr("Ngưỡng")}<input
                        type="number"
                        className="input h-7 w-20 py-0 text-body-sm"
                        defaultValue={r[numKey]}
                        onBlur={(e) => Number(e.target.value) !== r[numKey] && setRule(numKey, Number(e.target.value))}
                      />
                      {unit}
                    </label>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-label-md font-normal text-blue-800">
              <Icon name="info" size={14} className="mt-px" />{tr("Cảnh báo dựa trên quy tắc và số liệu thật của dự án – không phải dự đoán của AI.")}</p>
          </div>
          <div className="card p-4">
            <p className="mb-2 text-label-lg font-semibold text-slate-900">{tr("Đã xử lý gần đây")}</p>
            {data.resolved.map((x) => (
              <div key={x._id} className="flex items-start gap-2 border-b border-slate-100 py-2 text-body-sm last:border-0">
                <Icon name="check_circle" size={16} className="mt-0.5 text-emerald-500" />
                <div className="flex-1">
                  <p className="text-slate-700">{x.title}</p>
                  <p className="text-label-md font-normal text-slate-400">
                    {x.resolvedBy?.name} · {timeAgo(x.updatedAt)}
                  </p>
                </div>
                {data.access.canWrite && (
                  <button className="text-label-md text-slate-400 hover:text-slate-700" onClick={() => unresolve(x)}>{tr("Mở lại")}</button>
                )}
              </div>
            ))}
            {!data.resolved.length && <p className="text-body-sm text-slate-400">{tr("Chưa có cảnh báo nào được xử lý.")}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
