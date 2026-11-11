import { t as tr, useI18n } from '../../lib/i18n.js';
import { useEffect, useRef, useState } from 'react';

// import.meta.env chỉ có khi chạy qua Vite; test chạy bằng Node thuần nên phải đọc an toàn.
const CLIENT_ID = import.meta.env?.VITE_GOOGLE_CLIENT_ID || '';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
let loading;

function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => {
      loading = undefined;
      reject(new Error('gis'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Nút "Đăng nhập với Google" chính thức (Google Identity Services). Trả ID token qua onCredential. */
export default function GoogleSignIn({ onCredential, disabled }) {
  useI18n();
  const box = useRef(null);
  const callback = useRef(onCredential);
  callback.current = onCredential;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!CLIENT_ID) return undefined;
    let cancelled = false;
    loadGis()
      .then((google) => {
        if (cancelled || !box.current) return;
        google.accounts.id.initialize({ client_id: CLIENT_ID, callback: (r) => r.credential && callback.current(r.credential) });
        google.accounts.id.renderButton(box.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          width: Math.min(400, box.current.parentElement?.clientWidth || 320),
          locale: document.documentElement.lang === 'en' ? 'en' : 'vi',
        });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!CLIENT_ID) {
    return (
      <button type="button" className="btn-outline w-full" disabled title={tr("Chưa cấu hình VITE_GOOGLE_CLIENT_ID")}>
        {tr("Đăng nhập Google chưa được cấu hình")}
      </button>
    );
  }
  if (failed) return <p className="text-center text-body-sm text-slate-500">{tr("Không tải được đăng nhập Google. Kiểm tra kết nối mạng rồi tải lại trang.")}</p>;
  return <div ref={box} className={`flex min-h-10 justify-center ${disabled ? 'pointer-events-none opacity-60' : ''}`} aria-busy={disabled} />;
}
