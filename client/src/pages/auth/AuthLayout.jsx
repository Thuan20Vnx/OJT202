import { useState } from 'react';
import { Icon } from '../../components/ui.jsx';
import { useApp } from '../../lib/app.jsx';

/** Bố cục chia đôi dùng chung cho Đăng nhập / Quên mật khẩu / Onboarding (theo Stitch) */
export default function AuthLayout({ title = ['Quản lý công việc nhóm', 'rõ ràng, đơn giản'], subtitle = 'Ai làm gì, khi nào xong – tất cả ở một nơi.', children }) {
  const { theme, toggleTheme } = useApp();
  const [lang, setLang] = useState('vi');
  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <header className="flex h-[60px] items-center justify-between border-b border-slate-200 bg-white px-6">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white">
            <Icon name="check_circle" size={17} />
          </span>
          <span className="text-headline-sm font-bold text-slate-900">TaskFlow</span>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center rounded-lg bg-slate-100 p-0.5 text-label-sm">
            {['vi', 'en'].map((l) => (
              <button key={l} onClick={() => setLang(l)} className={`rounded-md px-2 py-1 font-bold uppercase ${lang === l ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>
                {l}
              </button>
            ))}
          </div>
          <button className="icon-btn" onClick={toggleTheme} title="Chuyển chế độ sáng/tối">
            <Icon name={theme === 'dark' ? 'dark_mode' : 'light_mode'} />
          </button>
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-6 py-10 lg:grid-cols-2">
        <section className="hidden lg:block">
          <h1 className="text-[40px] font-bold leading-[48px] tracking-tight text-slate-900">
            {title[0]}
            <br />
            <span className="text-blue-600">{title[1]}</span>
          </h1>
          <p className="mt-3 text-body-lg text-slate-500">{subtitle}</p>
          <ul className="mt-8 space-y-4">
            {[
              ['view_kanban', 'Bảng Kanban trực quan'],
              ['sync_alt', 'Cộng tác thời gian thực'],
              ['smart_toy', 'Trợ lý AI lập kế hoạch'],
            ].map(([icon, text]) => (
              <li key={text} className="flex items-center gap-3 text-body-md text-slate-700">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Icon name={icon} size={18} />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </section>
        <section className="mx-auto w-full max-w-md">{children}</section>
      </main>
      <footer className="flex items-center justify-between border-t border-slate-200 bg-white px-6 py-3 text-label-md font-normal text-slate-500">
        <span>© 2026 TaskFlow</span>
        <span>Điều khoản · Quyền riêng tư</span>
      </footer>
    </div>
  );
}
