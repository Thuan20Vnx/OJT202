import { useState } from 'react';
import { fmtProjectDate as fmtDate } from '../lib/format.js';

/** Burndown: đường thực tế (xanh, liền) + lý tưởng (xám, nét đứt), có crosshair + tooltip khi rê chuột. */
export function Burndown({ days = [], height = 220 }) {
  const [hover, setHover] = useState(null);
  if (!days.length) return <p className="py-10 text-center text-body-sm text-slate-400">Dự án chưa đặt thời gian Sprint</p>;
  const W = 640;
  const H = height;
  const pad = { l: 32, r: 12, t: 12, b: 26 };
  const max = Math.max(1, ...days.map((d) => Math.max(d.ideal, d.actual ?? 0)));
  const span = new Date(days.at(-1).date) - new Date(days[0].date);
  const x = (i) => pad.l + ((new Date(days[i].date) - new Date(days[0].date)) * (W - pad.l - pad.r)) / Math.max(1, span);
  const selected = hover == null ? null : days[hover];
  const y = (v) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const ideal = days.map((d, i) => `${x(i)},${y(d.ideal)}`).join(' ');
  const actualPts = days.map((d, i) => (d.actual == null ? null : [x(i), y(d.actual)])).filter(Boolean);
  const todayIdx = days.reduce((acc, d, i) => (d.actual != null ? i : acc), -1);
  const ticks = [0, Math.round(max / 2), max];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Biểu đồ burndown số việc còn lại theo ngày" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#94a3b8">
              {t}
            </text>
          </g>
        ))}
        {days.map((d, i) =>
          i % Math.ceil(days.length / 6) === 0 || i === days.length - 1 ? (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#94a3b8">
              {fmtDate(d.date)}
            </text>
          ) : null,
        )}
        <polyline points={ideal} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="5 4" />
        {actualPts.length > 1 && <polyline points={actualPts.map((p) => p.join(',')).join(' ')} fill="none" stroke="#2563eb" strokeWidth="2" strokeLinejoin="round" />}
        {todayIdx >= 0 && (
          <g>
            <line x1={x(todayIdx)} x2={x(todayIdx)} y1={pad.t} y2={H - pad.b} stroke="#f43f5e" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={x(todayIdx)} cy={y(days[todayIdx].actual)} r="4.5" fill="#2563eb" stroke="#fff" strokeWidth="2" />
          </g>
        )}
        {selected && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="#cbd5e1" strokeWidth="1" />}
        {days.map((_, i) => (
          <rect
            key={i}
            x={x(i) - (W - pad.l - pad.r) / days.length / 2}
            y={0}
            width={(W - pad.l - pad.r) / days.length}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      {selected && (
        <div
          className="pointer-events-none absolute top-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-label-md shadow-pop"
          style={{ left: `${Math.min(80, (x(hover) / W) * 100)}%` }}
        >
          <p className="font-semibold text-slate-800">{fmtDate(days[hover].date)}</p>
          <p className="font-normal text-slate-600">Thực tế: {days[hover].actual ?? '–'} việc</p>
          <p className="font-normal text-slate-600">Lý tưởng: {days[hover].ideal} việc</p>
        </div>
      )}
      <div className="mt-2 flex items-center gap-4 text-label-md font-normal text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-5 rounded bg-blue-600" /> Thực tế
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0 w-5 border-t-2 border-dashed border-slate-400" /> Lý tưởng
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-0 border-l border-dashed border-rose-500" /> Hôm nay
        </span>
      </div>
    </div>
  );
}

/** Donut phân bố trạng thái – khoảng hở 2px giữa các lát, chú thích có nhãn + số (không chỉ dựa vào màu). */
export function Donut({ segments, size = 168, center }) {
  const [hover, setHover] = useState(null);
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Biểu đồ phân bố trạng thái công việc">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth="18" />
          {total > 0 &&
            segments.map((s, i) => {
              const len = (s.value / total) * c;
              const gap = segments.filter((x) => x.value).length > 1 ? 2 : 0;
              const el = (
                <circle
                  key={s.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={hover === i ? 22 : 18}
                  strokeDasharray={`${Math.max(0, len - gap)} ${c - Math.max(0, len - gap)}`}
                  strokeDashoffset={-acc}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  style={{ transition: 'stroke-width .15s' }}
                />
              );
              acc += len;
              return s.value ? el : null;
            })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {hover != null ? (
            <>
              <span className="text-headline-md text-slate-900">{segments[hover].value}</span>
              <span className="text-label-md font-normal text-slate-500">{segments[hover].label}</span>
            </>
          ) : (
            center
          )}
        </div>
      </div>
      <ul className="min-w-[160px] flex-1 space-y-2">
        {segments.map((s, i) => (
          <li
            key={s.label}
            className={`flex items-center justify-between gap-3 text-body-sm ${hover === i ? 'font-semibold' : ''}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="flex items-center gap-2 text-slate-700">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="text-slate-900">
              {s.value} <span className="text-slate-400">({total ? Math.round((s.value / total) * 100) : 0}%)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
