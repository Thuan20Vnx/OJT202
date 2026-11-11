import { t as tr, useI18n } from '../lib/i18n.js';

export const TASK_DATES = [
  ['plannedStartDate', 'Ngày bắt đầu kế hoạch'],
  ['dueDate', 'Ngày kết thúc kế hoạch'],
  ['actualStartDate', 'Ngày bắt đầu thực tế'],
  ['actualEndDate', 'Ngày kết thúc thực tế'],
];

export default function TaskDates({ value, onChange, canPlan = true, canActual = true, errors = {} }) {
  useI18n();
  return <fieldset className="space-y-3">
    <legend className="mb-2 text-label-lg font-semibold text-slate-800">{tr('Kế hoạch và thực tế')}</legend>
    {TASK_DATES.map(([key, label]) => <label key={key} className="block">
      <span className="mb-1 block text-label-md text-slate-600">{tr(label)}</span>
      <input aria-label={tr(label)} type="date" className="input h-9" value={value[key] || ''} disabled={key.startsWith('actual') ? !canActual : !canPlan}
        onChange={(e) => onChange(key, e.target.value)} aria-invalid={!!errors[key]} />
      {errors[key] && <span role="alert" className="field-error">{errors[key]}</span>}
    </label>)}
    <p className="text-label-md text-slate-500">{tr('Ngày kết thúc kế hoạch là hạn chót dùng cho lịch và nhắc hạn. Ngày thực tế có thể để trống khi chưa xác định.')}</p>
  </fieldset>;
}
