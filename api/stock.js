/* 공용 스톡 이미지 API (Vercel 서버리스 함수, Node 18+) — design 저장소의 assets/user-stock/ 에 이미지·목록을 커밋한다.
 *
 * 환경변수 (Vercel 프로젝트 → Settings → Environment Variables, 브라우저로는 절대 보내지 않는다)
 *   GITHUB_TOKEN    fine-grained 토큰 — design 저장소 Contents: Read and write 만
 *   STOCK_PASSWORD  업로드·삭제·숨김을 허용할 공유 비밀번호 (없으면 쓰기 전부 거부)
 *   GITHUB_REPO     기본 'Ssuhyeoniya/design'      GITHUB_BRANCH  기본 'main'
 *   STOCK_DIR       기본 'assets/user-stock'       GITHUB_API     기본 'https://api.github.com' (테스트용)
 *
 * GET  /api/stock                 → { enabled, writable, items:[{id,name,category,kb,ts,ext,path,url,hash}], hidden:[key…] }
 * GET  /api/stock?file=<id>       → 이미지 바이트 (저장소가 비공개여도 보이게 하는 프록시)
 * POST /api/stock  (헤더 x-stock-password)
 *   { action:'upload', name, category, dataUrl, hash? }   → 형식(png·jpg·webp·gif, 파일 앞부분 서명으로 판정)·크기(3MB) 검사 후 커밋
 *   { action:'delete', ids:[…] }                          → 파일 삭제 + 목록에서 제거
 *   { action:'hide', keys:[…], on:true|false }             → hidden.json 갱신(저장소 기본 이미지 숨김/복원)
 * 목록(index.json)·숨김(hidden.json) 갱신은 sha 충돌(409/422) 시 최신을 다시 읽어 최대 6번 재시도한다.
 * 크기 제한이 3MB 인 이유: Vercel 함수 요청 본문 한도가 4.5MB 이고 base64 로 보내면 약 1.37배가 된다.
 */
'use strict';
const crypto = require('crypto');

const MAX_BYTES = 3 * 1024 * 1024;
const cfg = () => ({
  token: process.env.GITHUB_TOKEN || '',
  password: process.env.STOCK_PASSWORD || '',
  repo: process.env.GITHUB_REPO || 'Ssuhyeoniya/design',
  branch: process.env.GITHUB_BRANCH || 'main',
  dir: (process.env.STOCK_DIR || 'assets/user-stock').replace(/^\/+|\/+$/g, ''),
  api: (process.env.GITHUB_API || 'https://api.github.com').replace(/\/+$/, ''),
});

// ── 이미지 형식: 확장자·MIME 이 아니라 파일 앞부분 서명으로 판정 (SVG 는 스크립트를 담을 수 있어 받지 않는다)
function sniff(buf) {
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.slice(0, 6).toString('latin1'))) return { ext: 'gif', mime: 'image/gif' };
  if (buf.length >= 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}
const MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const cleanName = s => String(s || '이미지').replace(/[\u0000-\u001f\u007f<>"`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || '이미지';
const cleanCat = s => String(s || '기본').replace(/[\u0000-\u001f\u007f<>"`\\/]/g, '').trim().slice(0, 40) || '기본';
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// ── GitHub Contents API
function gh(c) {
  const base = `${c.api}/repos/${c.repo}`;
  const H = extra => Object.assign({ 'Authorization': `Bearer ${c.token}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'design-stock-api' }, extra || {});
  const enc = p => p.split('/').map(encodeURIComponent).join('/');
  return {
    async repoInfo() { const r = await fetch(base, { headers: H() }); if (!r.ok) throw httpErr(r.status, 'GitHub 저장소 정보를 못 읽었어'); return r.json(); },
    async getJSON(path) {        // { data, sha } | { data:null, sha:null } (없음)
      const r = await fetch(`${base}/contents/${enc(path)}?ref=${encodeURIComponent(c.branch)}`, { headers: H() });
      if (r.status === 404) return { data: null, sha: null };
      if (!r.ok) throw httpErr(r.status, 'GitHub 에서 목록을 못 읽었어');
      const j = await r.json();
      return { data: JSON.parse(Buffer.from(j.content || '', 'base64').toString('utf8') || 'null'), sha: j.sha };
    },
    async getRaw(path) {
      const r = await fetch(`${base}/contents/${enc(path)}?ref=${encodeURIComponent(c.branch)}`, { headers: H({ 'Accept': 'application/vnd.github.raw' }) });
      if (!r.ok) throw httpErr(r.status === 404 ? 404 : 502, '이미지를 못 읽었어');
      return Buffer.from(await r.arrayBuffer());
    },
    async put(path, buf, message, sha) {
      const body = { message, content: buf.toString('base64'), branch: c.branch }; if (sha) body.sha = sha;
      const r = await fetch(`${base}/contents/${enc(path)}`, { method: 'PUT', headers: H({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
      if (r.status === 409 || r.status === 422) throw Object.assign(httpErr(409, 'sha 충돌'), { conflict: true });
      if (!r.ok) throw httpErr(r.status === 401 || r.status === 403 ? 502 : r.status, 'GitHub 커밋 실패(' + r.status + ')');
      return r.json();
    },
    async del(path, sha, message) {
      const r = await fetch(`${base}/contents/${enc(path)}`, { method: 'DELETE', headers: H({ 'Content-Type': 'application/json' }), body: JSON.stringify({ message, sha, branch: c.branch }) });
      if (r.status === 404) return null;
      if (r.status === 409 || r.status === 422) throw Object.assign(httpErr(409, 'sha 충돌'), { conflict: true });
      if (!r.ok) throw httpErr(502, 'GitHub 삭제 실패(' + r.status + ')');
      return r.json();
    },
    async sha(path) { const r = await fetch(`${base}/contents/${enc(path)}?ref=${encodeURIComponent(c.branch)}`, { headers: H() }); if (r.status === 404) return null; if (!r.ok) throw httpErr(502, 'GitHub 조회 실패'); return (await r.json()).sha; },
  };
}
function httpErr(status, message) { return Object.assign(new Error(message), { status }); }
// 목록 파일을 읽고 고쳐 쓴다 — 동시에 누가 고쳐 sha 가 어긋나면 다시 읽어 재시도
async function updateJSON(g, path, empty, mutate, message, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const cur = await g.getJSON(path);
    const data = cur.data == null ? JSON.parse(JSON.stringify(empty)) : cur.data;
    const next = mutate(data);
    if (next === false) return data;                          // 바꿀 것 없음
    try { await g.put(path, Buffer.from(JSON.stringify(next, null, 1) + '\n'), message, cur.sha); return next; }
    catch (e) { if (!e.conflict || i === tries - 1) throw e; await new Promise(r => setTimeout(r, 60 * (i + 1) + Math.random() * 80)); }
  }
}

let publicCache = null;   // { v:boolean, t }
async function isPublic(c, g) {
  if (publicCache && Date.now() - publicCache.t < 10 * 60 * 1000) return publicCache.v;
  try { const info = await g.repoInfo(); publicCache = { v: info.private === false, t: Date.now() }; }
  catch (e) { publicCache = { v: false, t: Date.now() }; }   // 모르면 비공개로 보고 프록시
  return publicCache.v;
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  const chunks = []; let n = 0;
  for await (const ch of req) { n += ch.length; if (n > 4.6 * 1024 * 1024) throw httpErr(413, '요청이 너무 커 (최대 3MB 이미지)'); chunks.push(ch); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function send(res, status, obj, headers) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  Object.entries(headers || {}).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(obj));
}

async function handler(req, res) {
  const c = cfg();
  const url = new URL(req.url, 'http://x');
  try {
    if (!c.token) return send(res, 200, { enabled: false, reason: 'not-configured', message: '서버에 GITHUB_TOKEN 이 없어 공용 저장이 꺼져 있어' });
    const g = gh(c);
    const idxPath = `${c.dir}/index.json`, hidPath = `${c.dir}/hidden.json`;
    if (req.method === 'GET') {
      const file = url.searchParams.get('file');
      if (file) {
        if (!/^[a-z0-9-]{6,64}$/.test(file)) return send(res, 400, { error: '잘못된 id' });
        const idx = (await g.getJSON(idxPath)).data || { items: [] };
        const it = (idx.items || []).find(x => x.id === file); if (!it) return send(res, 404, { error: '없는 이미지' });
        const buf = await g.getRaw(it.path);
        res.statusCode = 200; res.setHeader('Content-Type', MIME[it.ext] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.end(buf);
      }
      const [idx, hid, pub] = await Promise.all([g.getJSON(idxPath), g.getJSON(hidPath), isPublic(c, g)]);
      const items = ((idx.data && idx.data.items) || []).map(it => Object.assign({}, it, {
        url: pub ? `https://raw.githubusercontent.com/${c.repo}/${c.branch}/${it.path.split('/').map(encodeURIComponent).join('/')}` : `/api/stock?file=${it.id}`,
      }));
      return send(res, 200, { enabled: true, writable: !!c.password, public: pub, items, hidden: (hid.data && hid.data.keys) || [] });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'GET·POST 만 돼' }, { Allow: 'GET, POST' });
    if (!c.password) return send(res, 403, { error: '서버에 STOCK_PASSWORD 가 없어 업로드·삭제가 꺼져 있어' });
    if (!safeEq(req.headers['x-stock-password'] || '', c.password)) return send(res, 401, { error: '비밀번호가 맞지 않아' });
    const body = await readBody(req);
    if (body.action === 'upload') {
      const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(String(body.dataUrl || ''));
      if (!m || !m[2]) return send(res, 400, { error: 'dataUrl(base64) 이 필요해' });
      const buf = Buffer.from(m[3], 'base64');
      if (!buf.length) return send(res, 400, { error: '빈 파일' });
      if (buf.length > MAX_BYTES) return send(res, 413, { error: `3MB 를 넘는 이미지는 올릴 수 없어 (${Math.round(buf.length / 1024)}KB)` });
      const t = sniff(buf); if (!t) return send(res, 415, { error: 'png·jpg·webp·gif 만 올릴 수 있어 (svg 등 제외)' });
      const hash = crypto.createHash('sha1').update(buf).digest('hex');
      const name = cleanName(body.name), category = cleanCat(body.category);
      // 같은 내용이 이미 있으면 다시 올리지 않는다(로컬 → 공용 옮기기 반복 대비)
      const cur = (await g.getJSON(idxPath)).data;
      const dup = cur && (cur.items || []).find(x => x.hash === hash);
      if (dup) return send(res, 200, { ok: true, item: dup, duplicate: true });
      const id = Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
      const path = `${c.dir}/${id}.${t.ext}`;
      await g.put(path, buf, `chore(stock): 업로드 ${name}`);
      const item = { id, name, category, kb: Math.max(1, Math.round(buf.length / 1024)), ts: Date.now(), ext: t.ext, path, hash };
      await updateJSON(g, idxPath, { items: [] }, d => { d.items = (d.items || []).filter(x => x.id !== id); d.items.unshift(item); return d; }, `chore(stock): 업로드 ${name} (목록)`);
      return send(res, 200, { ok: true, item });
    }
    if (body.action === 'delete') {
      const ids = (body.ids || []).map(String).filter(x => /^[a-z0-9-]{6,64}$/.test(x));
      if (!ids.length) return send(res, 400, { error: '지울 id 가 없어' });
      const idx = (await g.getJSON(idxPath)).data || { items: [] };
      const gone = (idx.items || []).filter(x => ids.includes(x.id));
      for (const it of gone) { const sha = await g.sha(it.path); if (sha) await g.del(it.path, sha, `chore(stock): 삭제 ${it.name}`); }
      await updateJSON(g, idxPath, { items: [] }, d => { const n0 = (d.items || []).length; d.items = (d.items || []).filter(x => !ids.includes(x.id)); return d.items.length === n0 ? false : d; }, `chore(stock): 삭제 ${gone.length}개 (목록)`);
      return send(res, 200, { ok: true, deleted: gone.map(x => x.id) });
    }
    if (body.action === 'hide') {
      const keys = (body.keys || []).map(String).filter(k => k && k.length < 300 && !/[\u0000-\u001f]/.test(k));
      if (!keys.length) return send(res, 400, { error: '숨길 항목이 없어' });
      const on = body.on !== false;
      const next = await updateJSON(g, hidPath, { keys: [] }, d => {
        const s = new Set(d.keys || []); const n0 = s.size; keys.forEach(k => on ? s.add(k) : s.delete(k));
        if (s.size === n0 && [...s].every(k => (d.keys || []).includes(k))) return false;   // 바뀐 것 없음
        d.keys = [...s]; return d;
      }, `chore(stock): ${on ? '숨김' : '숨김 해제'} ${keys.length}개`);
      return send(res, 200, { ok: true, hidden: next.keys || [] });
    }
    return send(res, 400, { error: '알 수 없는 action' });
  } catch (e) {
    return send(res, e.status && e.status >= 400 && e.status < 600 ? e.status : 500, { error: e.message || '서버 오류' });
  }
}
module.exports = handler;
module.exports._test = { sniff, cleanName, MAX_BYTES, resetCache: () => { publicCache = null; } };
