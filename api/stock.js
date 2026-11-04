/* 공용 스톡 이미지 API (Vercel 서버리스 함수, Node 18+) — design 저장소의 데이터 브랜치(기본 stock-data)에 이미지·목록을 커밋한다.
 *
 * 환경변수 (Vercel → Settings → Environment Variables, Production 에만. 브라우저로는 절대 보내지 않는다)
 *   GITHUB_TOKEN    fine-grained 토큰 — design 저장소 Contents: Read and write 만
 *   STOCK_PASSWORD  업로드·삭제·숨김을 허용할 공유 비밀번호 (없으면 쓰기 전부 거부)
 *   GITHUB_REPO     기본 'Ssuhyeoniya/design'
 *   GITHUB_BRANCH   기본 'stock-data' — 이미지 커밋을 main 과 분리(main 배포·프로덕션 흐름을 건드리지 않음). 없으면 기본 브랜치에서 자동 생성
 *   STOCK_DIR       기본 'assets/user-stock'       GITHUB_API     기본 'https://api.github.com' (테스트용)
 *
 * GET  /api/stock            → { enabled, writable, public, branch, items:[…], hidden:[…] }   (CDN s-maxage=15, 인스턴스 메모리 15초. 비밀번호가 맞는 ?t= 요청만 우회)
 * GET  /api/stock?file=<id>  → 이미지 바이트 (비공개 저장소용 프록시, id 는 불변이라 CDN 하루 캐시 + 인스턴스 메모리 5분)
 * POST /api/stock  (헤더 x-stock-password)  { action:'upload'|'delete'|'hide', … }
 *
 * 오류 코드: 401 = 비밀번호 틀림(이것만) · 429 = 비밀번호 실패가 너무 많음 · 400 = 잘못된 요청 · 413/415 = 크기/형식
 *           502 + code:'upstream_auth' = GitHub 토큰 문제(만료·권한) · 502 + code:'upstream' = 그 밖의 GitHub 오류
 * 크기 3MB: Vercel 함수 요청 본문 한도 4.5MB, base64 로 보내면 약 1.37배.
 * 비밀번호 실패 제한(10분 20회 → 5분 잠금, IP 당 동시 확인 1개)은 함수 인스턴스 메모리 기준이라 인스턴스가 여럿이면 각각 따로 센다.
 */
'use strict';
const crypto = require('crypto');

const MAX_BYTES = 3 * 1024 * 1024;
const BUST_MIN = 5 * 1000;
const LIST_TTL = 15 * 1000, FILE_TTL = 5 * 60 * 1000, FILE_CACHE_MAX = 24 * 1024 * 1024;
const FAIL_WINDOW = 10 * 60 * 1000, FAIL_MAX = 20, FAIL_DELAY = 800, LOCK_MS = 5 * 60 * 1000, FAIL_MAP_MAX = 5000;
const cfg = () => ({
  token: process.env.GITHUB_TOKEN || '',
  password: process.env.STOCK_PASSWORD || '',
  repo: process.env.GITHUB_REPO || 'Ssuhyeoniya/design',
  branch: process.env.GITHUB_BRANCH || 'stock-data',
  dir: (process.env.STOCK_DIR || 'assets/user-stock').replace(/^\/+|\/+$/g, ''),
  api: (process.env.GITHUB_API || 'https://api.github.com').replace(/\/+$/, ''),
});

function sniff(buf) {   // 형식은 확장자·MIME 이 아니라 파일 앞부분 서명으로 (SVG 는 스크립트를 담을 수 있어 받지 않는다)
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.slice(0, 6).toString('latin1'))) return { ext: 'gif', mime: 'image/gif' };
  if (buf.length >= 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}
const MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const cleanName = s => String(s || '이미지').replace(/[\u0000-\u001f\u007f<>"`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || '이미지';
const cleanCat = s => String(s || '기본').replace(/[\u0000-\u001f\u007f<>"`\\/]/g, '').trim().slice(0, 40) || '기본';
// 비밀번호 비교 — 양쪽을 sha256 으로 같은 길이로 만든 뒤 비교(길이 정보도 새지 않게)
const sha = s => crypto.createHash('sha256').update(String(s), 'utf8').digest();
const pwOk = (given, want) => crypto.timingSafeEqual(sha(given), sha(want)) && String(want).length > 0;

function httpErr(status, message, code) { return Object.assign(new Error(message), { status, code }); }
// GitHub 에서 온 오류는 모두 502 — 401·403 은 토큰 문제로 구분(브라우저가 '비밀번호 틀림'과 헷갈리지 않게)
function ghErr(status, what) {
  if (status === 401 || status === 403) return httpErr(502, `서버 설정(토큰) 문제 — 관리자에게 알려 주세요 (GitHub ${status}, ${what})`, 'upstream_auth');
  return httpErr(502, `GitHub 오류 (${status}, ${what}) — 잠시 뒤 다시 시도해 주세요`, 'upstream');
}

function gh(c) {
  const base = `${c.api}/repos/${c.repo}`;
  const H = extra => Object.assign({ 'Authorization': `Bearer ${c.token}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'design-stock-api' }, extra || {});
  const enc = p => p.split('/').map(encodeURIComponent).join('/');
  const call = async (url, opt, what) => { try { return await fetch(url, opt); } catch (e) { throw httpErr(502, `GitHub 에 연결 못 함 (${what})`, 'upstream'); } };
  const cref = `?ref=${encodeURIComponent(c.branch)}`;
  return {
    async repoInfo() { const r = await call(base, { headers: H() }, '저장소 정보'); if (!r.ok) throw ghErr(r.status, '저장소 정보'); return r.json(); },
    async branchSha(b) { const r = await call(`${base}/git/ref/heads/${enc(b)}`, { headers: H() }, '브랜치'); if (r.status === 404) return null; if (!r.ok) throw ghErr(r.status, '브랜치'); return (await r.json()).object.sha; },
    async createBranch(b, sha) {
      const r = await call(`${base}/git/refs`, { method: 'POST', headers: H({ 'Content-Type': 'application/json' }), body: JSON.stringify({ ref: `refs/heads/${b}`, sha }) }, '브랜치 만들기');
      if (r.status === 422) return;   // 동시에 다른 요청이 먼저 만들었음
      if (!r.ok) throw ghErr(r.status, '브랜치 만들기');
    },
    async getJSON(path) {
      const r = await call(`${base}/contents/${enc(path)}${cref}`, { headers: H() }, '목록 읽기');
      if (r.status === 404) return { data: null, sha: null };
      if (!r.ok) throw ghErr(r.status, '목록 읽기');
      const j = await r.json();
      return { data: JSON.parse(Buffer.from(j.content || '', 'base64').toString('utf8') || 'null'), sha: j.sha };
    },
    async getRaw(path) {
      const r = await call(`${base}/contents/${enc(path)}${cref}`, { headers: H({ 'Accept': 'application/vnd.github.raw' }) }, '이미지 읽기');
      if (r.status === 404) throw httpErr(404, '이미지가 없어');
      if (!r.ok) throw ghErr(r.status, '이미지 읽기');
      return Buffer.from(await r.arrayBuffer());
    },
    async put(path, buf, message, sha) {
      const body = { message, content: buf.toString('base64'), branch: c.branch }; if (sha) body.sha = sha;
      const r = await call(`${base}/contents/${enc(path)}`, { method: 'PUT', headers: H({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) }, '커밋');
      if (r.status === 409 || r.status === 422) throw Object.assign(httpErr(409, 'sha 충돌'), { conflict: true });
      if (!r.ok) throw ghErr(r.status, '커밋');
      return r.json();
    },
    async del(path, sha, message) {
      const r = await call(`${base}/contents/${enc(path)}`, { method: 'DELETE', headers: H({ 'Content-Type': 'application/json' }), body: JSON.stringify({ message, sha, branch: c.branch }) }, '삭제');
      if (r.status === 404) return null;
      if (r.status === 409 || r.status === 422) throw Object.assign(httpErr(409, 'sha 충돌'), { conflict: true });
      if (!r.ok) throw ghErr(r.status, '삭제');
      return r.json();
    },
    async sha(path) { const r = await call(`${base}/contents/${enc(path)}${cref}`, { headers: H() }, '조회'); if (r.status === 404) return null; if (!r.ok) throw ghErr(r.status, '조회'); return (await r.json()).sha; },
  };
}
async function updateJSON(g, path, empty, mutate, message, tries = 6) {   // sha 충돌이면 최신을 다시 읽어 재시도
  for (let i = 0; i < tries; i++) {
    const cur = await g.getJSON(path);
    const data = cur.data == null ? JSON.parse(JSON.stringify(empty)) : cur.data;
    const next = mutate(data);
    if (next === false) return data;
    try { await g.put(path, Buffer.from(JSON.stringify(next, null, 1) + '\n'), message, cur.sha); return next; }
    catch (e) { if (!e.conflict || i === tries - 1) throw e; await new Promise(r => setTimeout(r, 60 * (i + 1) + Math.random() * 80)); }
  }
}

// ── 인스턴스 메모리 상태 (함수 인스턴스가 살아 있는 동안만)
let publicCache = null, branchReady = null, listCache = null;
const fileCache = new Map();   // id → { buf, mime, at } — 프록시 이미지 5분, 합계 24MB 상한(오래된 것부터 버림)
let fileCacheBytes = 0;
const fails = new Map();       // ip → { t:[실패 시각…], lock:잠금 해제 시각 }
const inflight = new Set();    // 지금 비밀번호 확인 중인 ip
async function isPublic(c, g) {
  if (publicCache && Date.now() - publicCache.t < 10 * 60 * 1000) return publicCache;
  try { const info = await g.repoInfo(); publicCache = { v: info.private === false, def: info.default_branch || 'main', t: Date.now() }; }
  catch (e) { if (e.code === 'upstream_auth') throw e; publicCache = { v: false, def: 'main', t: Date.now() }; }   // 모르면 비공개로 보고 프록시
  return publicCache;
}
// 데이터 브랜치가 없으면 기본 브랜치(main)의 지금 커밋에서 만든다 — 이미지 커밋이 main 배포 흐름을 건드리지 않게
async function ensureBranch(c, g) {
  if (branchReady === c.branch) return;
  if (!(await g.branchSha(c.branch))) {
    const info = await isPublic(c, g);
    const from = await g.branchSha(info.def || 'main'); if (!from) throw httpErr(502, '기본 브랜치를 찾지 못했어', 'upstream');
    await g.createBranch(c.branch, from);
  }
  branchReady = c.branch;
}
// 클라이언트 IP — x-forwarded-for 의 '첫' 값은 요청한 사람이 마음대로 넣을 수 있어(위조로 잠금 우회·남의 IP 잠그기) 쓰지 않는다.
// Vercel 은 x-real-ip 를 직접 설정하므로(클라이언트가 보낸 값을 덮어씀) 그것을 먼저 쓰고, 없으면 x-forwarded-for 의 '마지막' 값
// (가장 가까운 프록시가 붙인 값)을 쓴다. 둘 다 없으면 소켓 주소.
// 단, 이 헤더들을 믿는 것은 Vercel 에서 돌 때(process.env.VERCEL)뿐 — 그 밖(직접 띄운 Node 서버 등)에서는 누구나 위조할 수 있어
// 소켓 주소만 쓴다(그 경우 프록시 뒤라면 모두 같은 IP 로 보여 IP 제한이 약해진다 — 문서에 적음)
function clientIp(req) {
  if (!process.env.VERCEL) return String((req.socket && req.socket.remoteAddress) || '?');
  const real = String(req.headers['x-real-ip'] || '').trim(); if (real) return real;
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  if (xff.length) return xff[xff.length - 1];
  return String((req.socket && req.socket.remoteAddress) || '?');
}
function pruneFails(now) {
  for (const [ip, f] of fails) { f.t = f.t.filter(x => now - x < FAIL_WINDOW); if (!f.t.length && !(f.lock > now)) fails.delete(ip); }
  if (fails.size > FAIL_MAP_MAX) { const old = [...fails.entries()].sort((a, b) => (a[1].t[0] || 0) - (b[1].t[0] || 0)); for (const [ip] of old.slice(0, fails.size - FAIL_MAP_MAX)) fails.delete(ip); }
}
function lockedFor(ip) { const f = fails.get(ip), now = Date.now(); return f && f.lock > now ? Math.ceil((f.lock - now) / 1000) : 0; }
function noteFail(ip) {
  const now = Date.now(); if (fails.size > FAIL_MAP_MAX || Math.random() < 0.05) pruneFails(now);
  const f = fails.get(ip) || { t: [], lock: 0 }; f.t = f.t.filter(x => now - x < FAIL_WINDOW); f.t.push(now);
  if (f.t.length >= FAIL_MAX) { f.lock = now + LOCK_MS; f.t = []; }   // 10분에 20회 → 5분 잠금
  fails.set(ip, f);
}
// 비밀번호 확인 — IP 마다 동시에 1개만(병렬로 여러 개를 던져 지연·횟수 제한을 피하는 대입을 막는다).
// 실패 횟수에 비례해 지연을 늘리는 방식은 병렬 요청에는 효과가 없고 정상 사용자의 오타 지연만 커져서, 동시 1개 제한을 골랐다.
// 결과: 'ok' | 'bad'(401) | 'locked'(429) | 'busy'(429)
async function checkPassword(req, c) {
  const ip = clientIp(req);
  if (lockedFor(ip)) return { r: 'locked', ip };
  if (inflight.has(ip)) return { r: 'busy', ip };
  inflight.add(ip);
  try {
    if (pwOk(req.headers['x-stock-password'] || '', c.password)) return { r: 'ok', ip };
    noteFail(ip); await new Promise(r => setTimeout(r, FAIL_DELAY));
    return { r: 'bad', ip };
  } finally { inflight.delete(ip); }
}
function deny(res, chk) {
  if (chk.r === 'locked') return send(res, 429, { error: `비밀번호를 너무 많이 틀렸어 — ${Math.ceil(lockedFor(chk.ip) / 60)}분 뒤 다시 시도해 줘 (같은 회사 공인 IP 를 쓰면 함께 잠길 수 있어)`, code: 'locked' }, { 'Retry-After': String(lockedFor(chk.ip)) });
  if (chk.r === 'busy') return send(res, 429, { error: '이전 요청을 확인하는 중이야 — 잠시 뒤 다시 시도해 줘', code: 'busy' }, { 'Retry-After': '1' });
  return send(res, 401, { error: '비밀번호가 맞지 않아' });
}

async function readBody(req) {
  let raw;
  if (req.body !== undefined && req.body !== null) { if (typeof req.body !== 'string') return req.body; raw = req.body; }
  else { const chunks = []; let n = 0;
    for await (const ch of req) { n += ch.length; if (n > 4.6 * 1024 * 1024) throw httpErr(413, '요청이 너무 커 (최대 3MB 이미지)'); chunks.push(ch); }
    raw = Buffer.concat(chunks).toString('utf8'); }
  try { const j = JSON.parse(raw || '{}'); if (!j || typeof j !== 'object') throw 0; return j; }
  catch (e) { throw httpErr(400, '요청 형식이 올바르지 않아'); }
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
        let hit = fileCache.get(file);
        if (!hit || Date.now() - hit.at > FILE_TTL) {
          if (hit) { fileCacheBytes -= hit.buf.length; fileCache.delete(file); }
          const idx = listCache && Date.now() - listCache.at < LIST_TTL ? { items: listCache.raw } : ((await g.getJSON(idxPath)).data || { items: [] });
          const it = (idx.items || []).find(x => x.id === file); if (!it) return send(res, 404, { error: '없는 이미지' });
          hit = { buf: await g.getRaw(it.path), mime: MIME[it.ext] || 'application/octet-stream', at: Date.now() };
          if (hit.buf.length <= FILE_CACHE_MAX / 4) {
            fileCache.set(file, hit); fileCacheBytes += hit.buf.length;
            for (const [k, v] of fileCache) { if (fileCacheBytes <= FILE_CACHE_MAX) break; fileCache.delete(k); fileCacheBytes -= v.buf.length; }   // 오래된 것부터
          }
        }
        const buf = hit.buf;
        res.statusCode = 200; res.setHeader('Content-Type', hit.mime);
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, immutable'); res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.end(buf);
      }
      // 캐시 우회는 비밀번호가 맞는 요청의 ?t= 만(방금 쓴 화면이 최신을 받게). 요청 헤더(no-cache·Pragma)나 인증 없는 ?t= 는 무시한다
      // — 누구나 우회하면 GitHub 호출이 요청 수만큼 늘어난다. 우회 시도도 비밀번호 확인(지연·횟수 제한)을 거친다
      let bust = false;
      if (url.searchParams.has('t') && req.headers['x-stock-password'] && c.password) {
        const chk = await checkPassword(req, c); if (chk.r !== 'ok') return deny(res, chk); bust = true;
      }
      const fresh = listCache && Date.now() - listCache.at < LIST_TTL;
      // 인증된 우회도 마지막 갱신 5초 이내면 캐시 — 우회를 반복해 GitHub 토큰 한도(5000/h)를 소진하지 못하게(최대 720/h)
      if (fresh && !(bust && Date.now() - listCache.at > BUST_MIN)) return send(res, 200, listCache.body, { 'Cache-Control': bust ? 'private, no-store' : 's-maxage=15, stale-while-revalidate=60', 'X-Stock-Cache': 'mem' });
      const [idx, hid, pub] = await Promise.all([g.getJSON(idxPath), g.getJSON(hidPath), isPublic(c, g)]);
      const items = ((idx.data && idx.data.items) || []).map(it => Object.assign({}, it, {
        url: pub.v ? `https://raw.githubusercontent.com/${c.repo}/${encodeURIComponent(c.branch)}/${it.path.split('/').map(encodeURIComponent).join('/')}` : `/api/stock?file=${it.id}`,
      }));
      const body = { enabled: true, writable: !!c.password, public: pub.v, branch: c.branch, items, hidden: (hid.data && hid.data.keys) || [] };
      listCache = { at: Date.now(), body, raw: (idx.data && idx.data.items) || [] };
      return send(res, 200, body, { 'Cache-Control': bust ? 'private, no-store' : 's-maxage=15, stale-while-revalidate=60' });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'GET·POST 만 돼' }, { Allow: 'GET, POST' });
    if (!c.password) return send(res, 403, { error: '서버에 STOCK_PASSWORD 가 없어 업로드·삭제가 꺼져 있어' });
    const chk = await checkPassword(req, c); if (chk.r !== 'ok') return deny(res, chk);
    const body = await readBody(req);
    if (!['upload', 'delete', 'hide'].includes(body.action)) return send(res, 400, { error: '알 수 없는 action' });
    await ensureBranch(c, g);
    listCache = null;
    if (body.action === 'delete') { /* 지운 이미지는 프록시 메모리 캐시에서도 뺀다 */ (body.ids || []).forEach(id => { const h = fileCache.get(String(id)); if (h) { fileCacheBytes -= h.buf.length; fileCache.delete(String(id)); } }); }
    if (body.action === 'upload') {
      const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(String(body.dataUrl || ''));
      if (!m || !m[2]) return send(res, 400, { error: 'dataUrl(base64) 이 필요해' });
      const buf = Buffer.from(m[3], 'base64');
      if (!buf.length) return send(res, 400, { error: '빈 파일' });
      if (buf.length > MAX_BYTES) return send(res, 413, { error: `3MB 를 넘는 이미지는 올릴 수 없어 (${Math.round(buf.length / 1024)}KB)` });
      const t = sniff(buf); if (!t) return send(res, 415, { error: 'png·jpg·webp·gif 만 올릴 수 있어 (svg 등 제외)' });
      const hash = crypto.createHash('sha1').update(buf).digest('hex');
      const name = cleanName(body.name), category = cleanCat(body.category);
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
      for (const it of gone) { const s = await g.sha(it.path); if (s) await g.del(it.path, s, `chore(stock): 삭제 ${it.name}`); }
      await updateJSON(g, idxPath, { items: [] }, d => { const n0 = (d.items || []).length; d.items = (d.items || []).filter(x => !ids.includes(x.id)); return d.items.length === n0 ? false : d; }, `chore(stock): 삭제 ${gone.length}개 (목록)`);
      return send(res, 200, { ok: true, deleted: gone.map(x => x.id) });
    }
    // hide
    const keys = (body.keys || []).map(String).filter(k => k && k.length < 300 && !/[\u0000-\u001f]/.test(k));
    if (!keys.length) return send(res, 400, { error: '숨길 항목이 없어' });
    const on = body.on !== false;
    const next = await updateJSON(g, hidPath, { keys: [] }, d => {
      const s = new Set(d.keys || []); const n0 = s.size; keys.forEach(k => on ? s.add(k) : s.delete(k));
      if (s.size === n0 && [...s].every(k => (d.keys || []).includes(k))) return false;
      d.keys = [...s]; return d;
    }, `chore(stock): ${on ? '숨김' : '숨김 해제'} ${keys.length}개`);
    return send(res, 200, { ok: true, hidden: next.keys || [] });
  } catch (e) {
    const st = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    return send(res, st, { error: st === 500 ? '서버 오류 — 잠시 뒤 다시 시도해 주세요' : (e.message || '오류'), code: e.code || undefined });
  }
}
module.exports = handler;
module.exports._test = { sniff, cleanName, pwOk, clientIp, MAX_BYTES, reset: () => { publicCache = null; branchReady = null; listCache = null; fails.clear(); inflight.clear(); fileCache.clear(); fileCacheBytes = 0; }, failsSize: () => fails.size };
