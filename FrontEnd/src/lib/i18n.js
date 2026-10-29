import { useSyncExternalStore } from 'react';
import { english } from '../locales/en.js';

let language = 'vi';
try { language = localStorage.getItem('tf_language') === 'en' ? 'en' : 'vi'; } catch { /* Storage can be disabled. */ }
const listeners = new Set();
export const getLanguage = () => language;
export const getLocale = () => language === 'en' ? 'en-GB' : 'vi-VN';

export function setLanguage(next) {
  const value = next === 'en' ? 'en' : 'vi';
  try { localStorage.setItem('tf_language', value); } catch { /* Keep the in-memory preference. */ }
  if (typeof document !== 'undefined') document.documentElement.lang = value;
  const changed = value !== language;
  language = value;
  if (typeof document !== 'undefined') document.title = value === 'en' ? 'TaskFlow – Team task management' : 'TaskFlow – Quản lý công việc nhóm';
  if (!changed) return;
  for (const listener of listeners) listener();
}

const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export function useI18n() {
  const language = useSyncExternalStore(subscribe, getLanguage, () => 'vi');
  return { language, setLanguage, t };
}

// Translate marked interface strings, never project content or user names.
export function t(message, values = []) {
  if (typeof message !== 'string') return message;
  const key = message.trim().replace(/\s+/g, ' ');
  const translated = language === 'en' ? english[key] : undefined;
  const text = translated === undefined ? message : `${message.match(/^\s*/)[0]}${translated}${message.match(/\s*$/)[0]}`;
  return text.replace(/\{(\d+)\}/g, (match, index) => index in values ? String(values[index]) : match);
}

export function translateError(message) {
  if (language !== 'en' || typeof message !== 'string') return message;
  if (english[message.trim()]) return t(message);
  for (const [source, translated] of Object.entries(english)) {
    if (!/\{\d+\}/.test(source)) continue;
    const placeholders = [...source.matchAll(/\{(\d+)\}/g)].map(match => match[1]);
    const pattern = source.split(/(\{\d+\})/).map(part => /^\{\d+\}$/.test(part) ? '(.+?)' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
    const match = message.match(new RegExp(`^${pattern}$`));
    if (match) return translated.replace(/\{(\d+)\}/g, (_, index) => match[placeholders.indexOf(index) + 1]);
  }
  return message;
}
