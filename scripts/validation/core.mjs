import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const requireValue = (condition, message) => { if (!condition) throw new TypeError(message); };
export const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
export const finite = (value, min = 0) => typeof value === 'number' && Number.isFinite(value) && value >= min;
const canonical = (value) => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
export const hash = (value) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex');
export function sourceHash(content, file) {
  if (/\.(?:[cm]?js|jsx|tsx?|json|sql|prisma|ya?ml|md|txt)$/.test(file) || file.endsWith('.env.example')) {
    const text = content.toString('utf8');
    requireValue(Buffer.from(text, 'utf8').equals(content), `Source must be valid UTF-8: ${file}`);
    return hash(text.replaceAll('\r\n', '\n'));
  }
  return hash(content);
}
export const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Evidence is append-only by run ID; accidental reruns must not replace results.
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
export async function buildIdentity() {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();
  const files = git('ls-files', '--cached', '--others', '--exclude-standard').split(/\r?\n/).filter((file) => /^(BackEnd\/(src|prisma)|AIService\/src|FrontEnd\/src|shared|scripts|validation|test|\.github\/workflows)\//.test(file) || /(^|\/)package(-lock)?\.json$/.test(file) || file.endsWith('.env.example')).sort();
  const manifest = {};
  for (const file of files) manifest[file] = sourceHash(await fs.readFile(path.join(ROOT, file)), file);
  return { revision: git('rev-parse', 'HEAD'), sourceHash: hash(manifest), sourceHashAlgorithm: 'sha256-lf-v1', promptHash: hash(Object.fromEntries(Object.entries(manifest).filter(([file]) => file.startsWith('AIService/src/features/')))), dirty: Boolean(git('status', '--porcelain')), node: process.version };
}
export const quantile = (values, p) => {
  requireValue(Array.isArray(values) && values.every((n) => finite(n)) && p > 0 && p <= 1, 'Invalid quantile input');
  if (!values.length) return null;
  return [...values].sort((a, b) => a - b)[Math.ceil(p * values.length) - 1];
};
export const median = (values) => {
  requireValue(Array.isArray(values) && values.every((n) => finite(n)), 'Invalid median input');
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
export function unique(rows, key, label) {
  requireValue(new Set(rows.map(key)).size === rows.length, `Duplicate ${label}`);
}
export function sameBuild(actual, expected) {
  return Boolean(actual && expected && nonempty(actual.sourceHash) && nonempty(actual.revision) && actual.sourceHash === expected.sourceHash && actual.revision === expected.revision);
}
export function parseArgs(args, allowed) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    requireValue(args[i].startsWith('--') && allowed.includes(args[i].slice(2)), `Unknown option ${args[i]}`);
    const key = args[i].slice(2);
    requireValue(!(key in result) && args[i + 1] && !args[i + 1].startsWith('--'), `Missing/duplicate --${key}`);
    result[key] = args[++i];
  }
  return result;
}
