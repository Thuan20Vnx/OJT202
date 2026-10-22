import { Children, Fragment, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const textOf = (children) => Children.toArray(children).join('');

/** Đọc các <option> con (kể cả lồng trong Fragment / mảng) thành danh sách lựa chọn */
function collectOptions(children, out = []) {
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    if (c.type === Fragment) return collectOptions(c.props.children, out);
    if (c.type === 'option') {
      const label = textOf(c.props.children);
      out.push({ value: String(c.props.value ?? label), label, disabled: !!c.props.disabled });
    }
  });
  return out;
}

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();
const ITEM_H = 32;
const MAX_H = 288;

/**
 * Dropdown thay cho <select> gốc của trình duyệt (danh sách xổ ra của <select> không đổi được font/cỡ chữ).
 * Dùng y như <select>: <Select className="input h-8 w-auto py-0 text-body-sm" value onChange><option …/></Select>,
 * onChange nhận { target: { value } } nên các handler `(e) => e.target.value` giữ nguyên.
 * Danh sách render qua portal (không bị khung overflow cắt), tự lật lên trên khi thiếu chỗ, hỗ trợ bàn phím.
 */
export default function Select({ value, onChange, children, className = 'input', disabled, title, id, 'aria-label': ariaLabel }) {
  const options = collectOptions(children);
  const selectedIdx = options.findIndex((o) => o.value === String(value ?? ''));
  const selected = options[selectedIdx];
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const list = useRef(null);
  const typed = useRef({ text: '', at: 0 });
  const listId = useId();

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const want = Math.min(MAX_H, options.length * ITEM_H + 10);
    const below = window.innerHeight - r.bottom - 8;
    const up = below < want && r.top > below;
    setPos({
      left: Math.min(r.left, window.innerWidth - Math.max(r.width, 160) - 8),
      minWidth: r.width,
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      maxHeight: Math.min(MAX_H, (up ? r.top : below) - 8),
      up,
    });
  };

  const openMenu = () => {
    if (disabled) return;
    place();
    setActive(selectedIdx >= 0 ? selectedIdx : options.findIndex((o) => !o.disabled));
    setOpen(true);
  };
  const close = (focus = true) => {
    setOpen(false);
    if (focus) btn.current?.focus();
  };
  const choose = (i) => {
    const o = options[i];
    if (!o || o.disabled) return;
    if (o.value !== String(value ?? '')) onChange?.({ target: { value: o.value }, currentTarget: { value: o.value } });
    close();
  };
  const move = (from, step) => {
    for (let i = from + step, n = 0; n < options.length; i += step, n++) {
      const j = (i + options.length) % options.length;
      if (!options[j].disabled) return j;
    }
    return from;
  };

  // Đóng khi bấm ra ngoài; bám theo vị trí ô khi cuộn / đổi kích thước cửa sổ
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!btn.current?.contains(e.target) && !list.current?.contains(e.target)) close(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useLayoutEffect(() => {
    if (open && active >= 0) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onKeyDown = (e) => {
    if (disabled) return;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === 'ArrowDown') setActive((a) => move(a, 1));
    else if (e.key === 'ArrowUp') setActive((a) => move(a, -1));
    else if (e.key === 'Home') setActive(move(-1, 1));
    else if (e.key === 'End') setActive(move(options.length, -1));
    else if (e.key === 'Enter' || e.key === ' ') choose(active);
    else if (e.key === 'Escape') close();
    else if (e.key === 'Tab') return close(false);
    else if (e.key.length === 1) {
      // Gõ chữ cái để nhảy tới lựa chọn (không phân biệt dấu)
      const t = typed.current;
      t.text = Date.now() - t.at > 700 ? e.key : t.text + e.key;
      t.at = Date.now();
      const i = options.findIndex((o) => !o.disabled && fold(o.label).startsWith(fold(t.text)));
      if (i >= 0) setActive(i);
    } else return;
    e.preventDefault();
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        id={id}
        title={title}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
        className={`${className} inline-flex cursor-pointer items-center gap-1.5 text-left transition-colors ${open ? 'border-blue-600 ring-[3px] ring-blue-600/10' : ''}`}
      >
        {/* Lưới chồng mọi nhãn (ẩn) để ô rộng bằng nhãn dài nhất như <select> gốc */}
        <span className="grid min-w-0 flex-1">
          {options.map((o, i) => (
            <span key={`${o.value}-${i}`} aria-hidden="true" className="invisible col-start-1 row-start-1 h-0 overflow-hidden whitespace-nowrap">
              {o.label}
            </span>
          ))}
          <span className="col-start-1 row-start-1 truncate">{selected?.label ?? ''}</span>
        </span>
        <span aria-hidden="true" className={`material-symbols-outlined -mr-1 shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180 text-blue-600' : ''}`} style={{ fontSize: 18 }}>
          expand_more
        </span>
      </button>
      {open &&
        pos &&
        createPortal(
          <ul
            ref={list}
            id={listId}
            role="listbox"
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: pos.minWidth, maxHeight: pos.maxHeight, transformOrigin: pos.up ? 'bottom' : 'top' }}
            className="animate-pop-in scroll-thin z-[200] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-pop"
          >
            {options.map((o, i) => (
              <li
                key={`${o.value}-${i}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === selectedIdx}
                aria-disabled={o.disabled || undefined}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
                className={`flex h-8 items-center gap-2 whitespace-nowrap rounded-md px-2.5 text-body-sm transition-colors ${
                  o.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
                } ${i === active && !o.disabled ? 'bg-slate-100' : ''} ${i === selectedIdx ? 'font-semibold text-blue-700' : 'text-slate-700'}`}
              >
                <span className="flex-1">{o.label}</span>
                <span aria-hidden="true" className={`material-symbols-outlined text-blue-600 ${i === selectedIdx ? '' : 'invisible'}`} style={{ fontSize: 16 }}>
                  check
                </span>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
