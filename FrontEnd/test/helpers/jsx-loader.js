import { readFile } from 'node:fs/promises';
import { transformWithEsbuild } from 'vite';

export async function load(url, context, nextLoad) {
  if (!/\.(jsx|tsx)$/.test(url)) return nextLoad(url, context);
  const source = await readFile(new URL(url), 'utf8');
  const { code } = await transformWithEsbuild(source, new URL(url).pathname, { loader: url.endsWith('.tsx') ? 'tsx' : 'jsx', jsx: 'automatic' });
  return { format: 'module', source: code, shortCircuit: true };
}
