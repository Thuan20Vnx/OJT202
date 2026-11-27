import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { config } from '../../config.js';
import { HttpError, badRequest } from '../../utils/http.js';

// ===================== TOKEN =====================
const tokenKey = () => Buffer.from(crypto.hkdfSync('sha256', config.jwtSecret, 'taskflow-repo', 'repo-token', 32));

export function encryptToken(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), body].map((part) => (typeof part === 'string' ? part : part.toString('base64url'))).join('.');
}

export function decryptToken(stored) {
  const [, iv, tag, body] = stored.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', tokenKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}

// ===================== ĐỊA CHỈ REPO =====================
const blocked = new net.BlockList();
for (const [ip, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]]) blocked.addSubnet(ip, bits, 'ipv4');
for (const [ip, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10]]) blocked.addSubnet(ip, bits, 'ipv6');

function isBlockedIp(address) {
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return blocked.check(mapped[1], 'ipv4');
  return blocked.check(address, net.isIPv6(address) ? 'ipv6' : 'ipv4');
}

/** GitLab tự host do người dùng nhập: không để server gọi vào mạng nội bộ của chính nó. */
async function assertPublicHost(origin) {
  if (config.repo.allowPrivateHosts) return;
  const { hostname } = new URL(origin);
  const host = hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addresses.length || addresses.some((a) => isBlockedIp(a.address))) throw badRequest('Không kết nối được tới địa chỉ repo này');
}

/** Nhận URL repo người dùng dán vào, trả { baseUrl, repoPath }. */
export function parseRepoUrl(provider, input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    throw badRequest('Đường dẫn repo không hợp lệ');
  }
  if (url.username || url.password) throw badRequest('Không ghi tài khoản hoặc token trong đường dẫn repo');
  if (url.protocol !== 'https:' && !(config.repo.allowPrivateHosts && url.protocol === 'http:')) throw badRequest('Đường dẫn repo phải dùng https');
  const repoPath = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  if (repoPath.split('/').some((part) => part === '.' || part === '..')) throw badRequest('Đường dẫn repo không hợp lệ');
  if (provider === 'github') {
    if (url.hostname !== 'github.com' || !/^[\w.-]+\/[\w.-]+$/.test(repoPath)) throw badRequest('Đường dẫn GitHub phải có dạng https://github.com/chu-so-huu/ten-repo');
    return { baseUrl: url.origin, repoPath };
  }
  if (!/^[\w.-]+(\/[\w.-]+)+$/.test(repoPath)) throw badRequest('Đường dẫn GitLab phải có dạng https://gitlab.com/nhom/ten-repo');
  return { baseUrl: url.origin, repoPath };
}

// ===================== GỌI API =====================
async function request(url, headers) {
  let res;
  try {
    // redirect: 'error' để token không bị gửi theo sang máy chủ khác.
    res = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
  } catch {
    throw new HttpError(502, 'Không kết nối được tới GitHub/GitLab, vui lòng thử lại sau', { code: 'REPO_UNAVAILABLE' });
  }
  if (res.status === 401) throw new HttpError(400, 'Token không hợp lệ hoặc đã hết hạn', { code: 'REPO_AUTH' });
  if (res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')) throw new HttpError(429, 'GitHub/GitLab đang giới hạn lượt gọi, vui lòng thử lại sau', { code: 'REPO_RATE_LIMIT' });
  if (res.status === 403) throw new HttpError(400, 'Token không có quyền đọc repo này', { code: 'REPO_AUTH' });
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(502, 'GitHub/GitLab đang lỗi, vui lòng thử lại sau', { code: 'REPO_UNAVAILABLE' });
  return res.json();
}

const firstLine = (message = '') => message.split('\n')[0].slice(0, 300);

function github(conn, token) {
  const base = `${config.repo.githubApi}/repos/${conn.repoPath}`;
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'TaskFlow', ...(token && { authorization: `Bearer ${token}` }) };
  const get = (path) => request(`${base}${path}`, headers);
  const toPull = (p) => ({
    number: p.number, title: p.title, body: p.body || '', author: p.user?.login || null, state: p.merged_at ? 'merged' : p.state === 'open' ? 'open' : 'closed',
    draft: !!p.draft, head: p.head?.ref || '', base: p.base?.ref || '', url: p.html_url, updatedAt: p.updated_at, mergedAt: p.merged_at || null,
  });
  return {
    info: async () => {
      const r = await get('');
      return r && { defaultBranch: r.default_branch, isPrivate: !!r.private, webUrl: r.html_url, description: r.description || '', topics: r.topics || [] };
    },
    commits: async (since) => ((await get(`/commits?per_page=50&since=${encodeURIComponent(since.toISOString())}`)) || []).map((c) => ({
      sha: c.sha, title: firstLine(c.commit?.message), message: c.commit?.message || '', author: c.commit?.author?.name || c.author?.login || null, date: c.commit?.author?.date, url: c.html_url,
    })),
    pulls: async () => ((await get('/pulls?state=all&sort=updated&direction=desc&per_page=50')) || []).map(toPull),
    pull: async (number) => {
      const p = await get(`/pulls/${number}`);
      return p && toPull(p);
    },
    languages: async () => Object.keys((await get('/languages')) || {}),
  };
}

function gitlab(conn, token) {
  const base = `${conn.baseUrl}/api/v4/projects/${encodeURIComponent(conn.repoPath)}`;
  const headers = { ...(token && { 'private-token': token }) };
  const get = async (path) => {
    await assertPublicHost(conn.baseUrl);
    return request(`${base}${path}`, headers);
  };
  const toPull = (m) => ({
    number: m.iid, title: m.title, body: m.description || '', author: m.author?.username || null, state: m.state === 'merged' ? 'merged' : m.state === 'opened' ? 'open' : 'closed',
    draft: !!(m.draft ?? m.work_in_progress), head: m.source_branch, base: m.target_branch, url: m.web_url, updatedAt: m.updated_at, mergedAt: m.merged_at || null,
  });
  return {
    info: async () => {
      const r = await get('');
      return r && { defaultBranch: r.default_branch || 'main', isPrivate: r.visibility !== 'public', webUrl: r.web_url, description: r.description || '', topics: r.topics || r.tag_list || [] };
    },
    commits: async (since) => ((await get(`/repository/commits?per_page=50&since=${encodeURIComponent(since.toISOString())}`)) || []).map((c) => ({
      sha: c.id, title: firstLine(c.title || c.message), message: c.message || '', author: c.author_name || null, date: c.committed_date, url: c.web_url,
    })),
    pulls: async () => ((await get('/merge_requests?state=all&order_by=updated_at&sort=desc&per_page=50')) || []).map(toPull),
    pull: async (number) => {
      const m = await get(`/merge_requests/${number}`);
      return m && toPull(m);
    },
    languages: async () => Object.keys((await get('/languages')) || {}),
  };
}

/** Server chỉ đọc metadata của repo (commit, PR, ngôn ngữ). Việc đọc code do agent trên máy người dùng làm qua MCP. */
export function repoClient(conn) {
  const token = conn.tokenEnc ? decryptToken(conn.tokenEnc) : null;
  return conn.provider === 'github' ? github(conn, token) : gitlab(conn, token);
}
