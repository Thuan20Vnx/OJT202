// Hiệu ứng gợn sóng khi bấm mọi nút trong ứng dụng – một listener dùng chung, không cần sửa từng nút.
// Gợn sóng nằm trong khung .ripple-host (overflow hidden) nên không cắt mất badge/chấm thông báo của nút.
const SELECTOR = '.btn,.btn-primary,.btn-secondary,.btn-ghost,.btn-outline,.btn-danger,.icon-btn,.pill-tab';

export function installRipple() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return;
      const el = e.target.closest?.(SELECTOR);
      if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
      let host = el.querySelector(':scope > .ripple-host');
      if (!host) {
        host = document.createElement('span');
        host.className = 'ripple-host';
        el.appendChild(host);
      }
      const rect = el.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2;
      const wave = document.createElement('span');
      wave.className = 'ripple';
      Object.assign(wave.style, {
        width: `${size}px`,
        height: `${size}px`,
        left: `${e.clientX - rect.left - size / 2}px`,
        top: `${e.clientY - rect.top - size / 2}px`,
      });
      host.appendChild(wave);
      wave.addEventListener('animationend', () => wave.remove());
    },
    { passive: true },
  );
}
