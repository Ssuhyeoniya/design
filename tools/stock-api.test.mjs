// api/stock.js 단위 테스트 — GitHub Contents API 목 서버로 업로드·삭제·숨김·복원·충돌 재시도·비밀번호·형식/크기 거부
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// ── 목 GitHub: 브랜치별 메모리 파일 + 커밋 기록, 일부러 sha 충돌·인증 실패 만들기
function mockGitHub({ isPrivate = false, withData = false } = {}) {
  const files = new Map();             // `${branch}:${path}` → { buf, sha }
  const refs = new Map([['main', 'c0']]); if (withData) refs.set('stock-data', 'c0');
  const commits = [];
  let conflictsLeft = 0, n = 0, failAuth = 0, failAll = 0;
  const calls = { index: 0, raw: 0, all: 0 };
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (s, o, raw) => { res.statusCode = s; if (raw) { res.end(raw); return; } res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    calls.all++; if (/index\.json/.test(u.pathname) && req.method === 'GET') calls.index++; if (/raw/.test(req.headers.accept || '')) calls.raw++;
    if (req.headers.authorization !== 'Bearer TEST_TOKEN') return send(401, { message: 'bad token' });
    if (failAuth > 0) { failAuth--; return send(401, { message: 'Bad credentials' }); }
    if (failAll > 0) { failAll--; return send(500, { message: 'boom' }); }
    let body = ''; for await (const ch of req) body += ch;
    const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(u.pathname); if (!m) return send(404, {});
    const rest = m[3] || '';
    if (!rest) return send(200, { private: isPrivate, default_branch: 'main' });
    let r;
    if ((r = /^\/git\/ref\/heads\/(.+)$/.exec(rest))) { const b = decodeURIComponent(r[1]); return refs.has(b) ? send(200, { object: { sha: refs.get(b) } }) : send(404, {}); }
    if (rest === '/git/refs' && req.method === 'POST') { const j = JSON.parse(body); const b = j.ref.replace('refs/heads/', ''); if (refs.has(b)) return send(422, {}); refs.set(b, j.sha); commits.push({ op: 'branch', branch: b, from: j.sha }); return send(201, {}); }
    if (!(r = /^\/contents\/(.+)$/.exec(rest))) return send(404, {});
    const path = decodeURIComponent(r[1]);
    if (req.method === 'GET') {
      const br = u.searchParams.get('ref') || 'main'; const f = files.get(br + ':' + path); if (!f) return send(404, { message: 'Not Found' });
      if (/raw/.test(req.headers.accept || '')) return send(200, null, f.buf);
      return send(200, { sha: f.sha, content: f.buf.toString('base64'), encoding: 'base64' });
    }
    const j = JSON.parse(body); const br = j.branch || 'main';
    if (!refs.has(br)) return send(404, { message: 'Branch not found' });
    const key = br + ':' + path, f = files.get(key);
    if (req.method === 'PUT') {
      if (/index\.json|hidden\.json/.test(path) && conflictsLeft > 0) { conflictsLeft--; return send(409, { message: 'conflict' }); }
      if (f && j.sha !== f.sha) return send(409, { message: 'sha mismatch' });
      if (!f && j.sha) return send(422, { message: 'sha for new file' });
      const sha = 's' + (++n); files.set(key, { buf: Buffer.from(j.content, 'base64'), sha }); commits.push({ op: 'put', path, message: j.message, branch: br });
      return send(f ? 200 : 201, { content: { sha } });
    }
    if (req.method === 'DELETE') { if (!f) return send(404, {}); if (j.sha !== f.sha) return send(409, {}); files.delete(key); commits.push({ op: 'del', path, message: j.message, branch: br }); return send(200, {}); }
    send(405, {});
  });
  return new Promise(rv => srv.listen(0, () => rv({ srv, files, refs, commits, calls, url: `http://127.0.0.1:${srv.address().port}`,
    conflict: k => { conflictsLeft = k; }, authFail: k => { failAuth = k; }, allFail: k => { failAll = k; } })));
}
// api 핸들러를 실제 HTTP 로 띄운다
function serveHandler(handler) {
  const srv = http.createServer((req, res) => handler(req, res));
  return new Promise(r => srv.listen(0, () => r({ srv, url: `http://127.0.0.1:${srv.address().port}/api/stock` })));
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8DwnwEKGBkYGAAqqAP/0f2iNAAAAABJRU5ErkJggg==', 'base64');
const dataUrl = (buf, mime = 'image/png') => `data:${mime};base64,${buf.toString('base64')}`;

async function setup(opts = {}) {
  const gh = await mockGitHub(opts);
  process.env.GITHUB_TOKEN = 'TEST_TOKEN'; process.env.STOCK_PASSWORD = 'pw-123'; process.env.GITHUB_API = gh.url;
  process.env.GITHUB_REPO = 'Ssuhyeoniya/design'; delete process.env.GITHUB_BRANCH; delete process.env.STOCK_DIR;
  delete require.cache[require.resolve('../api/stock.js')];
  const handler = require('../api/stock.js'); handler._test.reset();
  const api = await serveHandler(handler);
  const post = (body, pw = 'pw-123', raw) => fetch(api.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(pw != null ? { 'x-stock-password': pw } : {}) }, body: raw != null ? raw : JSON.stringify(body) });
  const close = () => { gh.srv.close(); api.srv.close(); };
  return { gh, api, post, close };
}

test('업로드 → 이미지 파일·index.json 커밋, 목록에 나옴(공개 저장소 = raw URL)', async () => {
  const t = await setup();
  try {
    const r = await t.post({ action: 'upload', name: '쿠폰.png', category: '이벤트', dataUrl: dataUrl(PNG) });
    assert.equal(r.status, 200); const j = await r.json(); assert.ok(j.ok && j.item.id);
    assert.ok(t.gh.files.has('stock-data:' + j.item.path) && /^assets\/user-stock\/.+\.png$/.test(j.item.path));
    assert.ok(t.gh.commits.some(c => c.message === 'chore(stock): 업로드 쿠폰.png' && c.branch === 'stock-data'));
    assert.ok(!t.gh.commits.some(c => c.op !== 'branch' && c.branch === 'main'), 'main 에는 커밋하지 않음');
    const l = await (await fetch(t.api.url)).json();
    assert.equal(l.enabled, true); assert.equal(l.items.length, 1); assert.equal(l.items[0].name, '쿠폰.png');
    assert.match(l.items[0].url, /^https:\/\/raw\.githubusercontent\.com\/Ssuhyeoniya\/design\/stock-data\/assets\/user-stock\//);
    assert.equal(l.branch, 'stock-data');
    // 같은 내용 다시 올리면 중복으로 건너뜀
    const r2 = await (await t.post({ action: 'upload', name: '쿠폰 사본.png', dataUrl: dataUrl(PNG) })).json();
    assert.equal(r2.duplicate, true);
    assert.equal((await (await fetch(t.api.url + '?t=1')).json()).items.length, 1);
  } finally { t.close(); }
});

test('비공개 저장소 → 이미지 URL 은 /api 프록시, 프록시가 바이트를 돌려줌', async () => {
  const t = await setup({ isPrivate: true });
  try {
    const j = await (await t.post({ action: 'upload', name: 'a.png', dataUrl: dataUrl(PNG) })).json();
    const l = await (await fetch(t.api.url)).json();
    assert.equal(l.items[0].url, `/api/stock?file=${j.item.id}`);
    const img = await fetch(t.api.url + '?file=' + j.item.id);
    assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);
    assert.equal((await fetch(t.api.url + '?file=../../etc')).status, 400);
  } finally { t.close(); }
});

test('삭제 → 파일 삭제 커밋 + 목록에서 제거', async () => {
  const t = await setup();
  try {
    const a = (await (await t.post({ action: 'upload', name: 'a.png', dataUrl: dataUrl(PNG) })).json()).item;
    const r = await t.post({ action: 'delete', ids: [a.id] }); assert.equal(r.status, 200);
    assert.ok(!t.gh.files.has('stock-data:' + a.path)); assert.ok(t.gh.commits.some(c => c.op === 'del' && c.message === 'chore(stock): 삭제 a.png'));
    assert.equal((await (await fetch(t.api.url + '?t=1')).json()).items.length, 0);
  } finally { t.close(); }
});

test('숨김·복원 → hidden.json', async () => {
  const t = await setup();
  try {
    let j = await (await t.post({ action: 'hide', keys: ['assets/campaign-library/a.png', 'banner_studio/stock/b.png'], on: true })).json();
    assert.deepEqual(j.hidden.sort(), ['assets/campaign-library/a.png', 'banner_studio/stock/b.png']);
    j = await (await t.post({ action: 'hide', keys: ['banner_studio/stock/b.png'], on: false })).json();
    assert.deepEqual(j.hidden, ['assets/campaign-library/a.png']);
    const l = await (await fetch(t.api.url + '?t=1')).json(); assert.deepEqual(l.hidden, ['assets/campaign-library/a.png']);
  } finally { t.close(); }
});

test('sha 충돌 → 최신을 다시 읽어 재시도해 성공', async () => {
  const t = await setup();
  try {
    t.gh.conflict(3);
    const r = await t.post({ action: 'upload', name: 'c.png', dataUrl: dataUrl(PNG) });
    assert.equal(r.status, 200);
    assert.equal((await (await fetch(t.api.url + '?t=1')).json()).items.length, 1);
    t.gh.conflict(2);
    const h = await t.post({ action: 'hide', keys: ['x/y.png'], on: true }); assert.equal(h.status, 200);
  } finally { t.close(); }
});

test('동시 업로드 2건 — 둘 다 목록에 남음', async () => {
  const t = await setup();
  try {
    const PNG2 = Buffer.concat([PNG, Buffer.from([0])]);
    const [a, b] = await Promise.all([t.post({ action: 'upload', name: 'p1.png', dataUrl: dataUrl(PNG) }), t.post({ action: 'upload', name: 'p2.png', dataUrl: dataUrl(PNG2) })]);
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    const names = (await (await fetch(t.api.url + '?t=1')).json()).items.map(x => x.name).sort();
    assert.deepEqual(names, ['p1.png', 'p2.png']);
  } finally { t.close(); }
});

test('비밀번호 없음·틀림 → 401, 서버에 비밀번호 미설정 → 403', async () => {
  const t = await setup();
  try {
    assert.equal((await t.post({ action: 'hide', keys: ['a'] }, null)).status, 401);
    assert.equal((await t.post({ action: 'hide', keys: ['a'] }, 'wrong')).status, 401);
    assert.equal((await t.post({ action: 'hide', keys: ['a'] }, 'pw-123-but-much-longer')).status, 401);   // 길이가 달라도 같은 경로(해시 비교)
    process.env.STOCK_PASSWORD = '';
    assert.equal((await t.post({ action: 'hide', keys: ['a'] }, 'pw-123')).status, 403);
    assert.equal((await (await fetch(t.api.url)).json()).writable, false);
  } finally { t.close(); }
});

test('형식·크기 거부: svg·텍스트 415, 3MB 초과 413', async () => {
  const t = await setup();
  try {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    assert.equal((await t.post({ action: 'upload', name: 'x.svg', dataUrl: dataUrl(svg, 'image/svg+xml') })).status, 415);
    assert.equal((await t.post({ action: 'upload', name: 'fake.png', dataUrl: dataUrl(Buffer.from('not an image'), 'image/png') })).status, 415);
    const big = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]);
    assert.equal((await t.post({ action: 'upload', name: 'big.png', dataUrl: dataUrl(big) })).status, 413);
    assert.equal(t.gh.commits.filter(c => c.op !== 'branch').length, 0);
  } finally { t.close(); }
});

test('토큰 미설정 → enabled:false (공용 저장 꺼짐)', async () => {
  const t = await setup();
  try {
    process.env.GITHUB_TOKEN = '';
    const l = await (await fetch(t.api.url)).json(); assert.equal(l.enabled, false);
  } finally { t.close(); }
});

test('S1 GitHub 401·403(토큰 만료·권한) → 502 code:upstream_auth (401 은 비밀번호에만)', async () => {
  const t = await setup();
  try {
    t.gh.authFail(5);
    const r = await t.post({ action: 'hide', keys: ['a'], on: true });
    assert.equal(r.status, 502); const j = await r.json(); assert.equal(j.code, 'upstream_auth'); assert.match(j.error, /토큰/);
    t.gh.authFail(3);
    const g = await fetch(t.api.url + '?t=1'); assert.equal(g.status, 502); assert.equal((await g.json()).code, 'upstream_auth');
    t.gh.allFail(3);
    const g2 = await fetch(t.api.url + '?t=2'); assert.equal(g2.status, 502); assert.equal((await g2.json()).code, 'upstream');
  } finally { t.close(); }
});

test('S2 잘못된 JSON 본문 → 400 일반 문구(파서 메시지 노출 안 함)', async () => {
  const t = await setup();
  try {
    const r = await t.post(null, 'pw-123', '{not json'); assert.equal(r.status, 400);
    const j = await r.json(); assert.equal(j.error, '요청 형식이 올바르지 않아'); assert.ok(!/Unexpected|JSON/.test(j.error));
  } finally { t.close(); }
});

test('데이터 브랜치 stock-data 자동 생성(main 의 지금 커밋에서) · 읽기·프록시도 그 브랜치', async () => {
  const t = await setup({ isPrivate: true });
  try {
    assert.ok(!t.gh.refs.has('stock-data'));
    const j = await (await t.post({ action: 'upload', name: 'b.png', dataUrl: dataUrl(PNG) })).json();
    assert.equal(t.gh.refs.get('stock-data'), 'c0'); assert.ok(t.gh.commits.some(c => c.op === 'branch' && c.branch === 'stock-data' && c.from === 'c0'));
    assert.ok(t.gh.files.has('stock-data:assets/user-stock/index.json') && !t.gh.files.has('main:assets/user-stock/index.json'));
    const l = await (await fetch(t.api.url + '?t=1')).json(); assert.equal(l.items.length, 1);
    const img = await fetch(t.api.url + '?file=' + j.item.id); assert.equal(img.status, 200);
    // GITHUB_BRANCH 로 바꿀 수 있음
    process.env.GITHUB_BRANCH = 'other'; const r = await t.post({ action: 'hide', keys: ['k'] }); assert.equal(r.status, 200); assert.ok(t.gh.refs.has('other'));
  } finally { t.close(); }
});

test('캐시: 목록 s-maxage=15 · 메모리 15초 · 요청 헤더 no-cache·인증 없는 ?t= 로는 우회 안 됨 · 비밀번호 맞는 ?t= 만 우회 · 쓰기 뒤 무효화', async () => {
  const t = await setup({ isPrivate: true });
  try {
    const a = await fetch(t.api.url); assert.match(a.headers.get('cache-control'), /s-maxage=15, stale-while-revalidate=60/);
    const n0 = t.gh.calls.index;
    for (let i = 0; i < 10; i++) await fetch(t.api.url + '?t=' + i, { headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
    for (let i = 0; i < 10; i++) await fetch(t.api.url, { cache: 'no-store' });
    assert.equal(t.gh.calls.index, n0, '인증 없는 우회 시도 20회 → GitHub 목록 호출 0');
    const wrong = await fetch(t.api.url + '?t=x', { headers: { 'x-stock-password': 'nope' } }); assert.equal(wrong.status, 401);
    await new Promise(r => setTimeout(r, 5100));
    const right = await fetch(t.api.url + '?t=y', { headers: { 'x-stock-password': 'pw-123' } });
    assert.equal(right.status, 200); assert.equal(right.headers.get('cache-control'), 'private, no-store'); assert.equal(t.gh.calls.index, n0 + 1, '비밀번호 맞는 ?t= 만 새로 읽음');
    const j = await (await t.post({ action: 'upload', name: 'c.png', dataUrl: dataUrl(PNG) })).json();
    const d = await fetch(t.api.url); assert.equal(d.headers.get('x-stock-cache'), null); assert.equal((await d.json()).items.length, 1);   // 쓰기 뒤엔 새로 읽음
    // 프록시: CDN 하루 immutable + 메모리 5분 — 같은 id 두 번째는 GitHub raw 호출 없음
    const r0 = t.gh.calls.raw;
    const img = await fetch(t.api.url + '?file=' + j.item.id); assert.match(img.headers.get('cache-control'), /s-maxage=86400.*immutable/);
    await fetch(t.api.url + '?file=' + j.item.id); await fetch(t.api.url + '?file=' + j.item.id);
    assert.equal(t.gh.calls.raw, r0 + 1, '프록시 메모리 캐시');
  } finally { t.close(); }
});

test('비밀번호: 해시 비교 · 오답 800ms 지연 · 10분 20회 → 5분 잠금(429, Retry-After≤300)', async () => {
  const t = await setup();
  try {
    const h = require('../api/stock.js')._test;
    assert.equal(h.pwOk('pw-123', 'pw-123'), true); assert.equal(h.pwOk('pw-12', 'pw-123'), false); assert.equal(h.pwOk('', ''), false);
    const t0 = Date.now(); const r = await t.post({ action: 'hide', keys: ['a'] }, 'nope'); const dt = Date.now() - t0;
    assert.equal(r.status, 401); assert.ok(dt >= 780, '오답 지연 ' + dt + 'ms');
    for (let i = 0; i < 19; i++) assert.equal((await t.post({ action: 'hide', keys: ['a'] }, 'nope')).status, 401);
    const over = await t.post({ action: 'hide', keys: ['a'] }, 'nope'); assert.equal(over.status, 429); assert.ok(+over.headers.get('retry-after') <= 300 && +over.headers.get('retry-after') > 0);
    const oj = await over.json(); assert.match(oj.error, /같은 회사 공인 IP/); assert.equal(oj.code, 'locked');
    assert.equal((await t.post({ action: 'hide', keys: ['a'] }, 'pw-123')).status, 429);   // 잠긴 동안은 맞아도 거부
  } finally { t.close(); }
});

test('병렬 대입 차단: 같은 IP 의 동시 비밀번호 확인은 1개만(나머지 즉시 429)', async () => {
  const t = await setup();
  try {
    const rs = await Promise.all(Array.from({ length: 5 }, () => t.post({ action: 'hide', keys: ['a'] }, 'nope')));
    const st = rs.map(r => r.status).sort();
    assert.deepEqual(st, [401, 429, 429, 429, 429]);
    const busy = await Promise.all(rs.filter(r => r.status === 429).map(r => r.json()));
    assert.ok(busy.every(j => j.code === 'busy'), '동시 확인 중 429 는 code:busy');
  } finally { t.close(); }
});

test('IP(Vercel): x-real-ip 우선, 없으면 x-forwarded-for 마지막 값 — 첫 값 위조로 잠금 우회·남 잠그기 불가', async () => {
  const t = await setup(); process.env.VERCEL = '1';
  try {
    const h = require('../api/stock.js')._test;
    assert.equal(h.clientIp({ headers: { 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1, 9.9.9.9' }, socket: {} }), '9.9.9.9');
    assert.equal(h.clientIp({ headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }, socket: {} }), '2.2.2.2');
    assert.equal(h.clientIp({ headers: {}, socket: { remoteAddress: '3.3.3.3' } }), '3.3.3.3');
    // 같은 x-real-ip 에서 첫 XFF 값을 바꿔 가며 틀려도 결국 잠김
    const post = (pw, xff) => fetch(t.api.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-stock-password': pw, 'x-real-ip': '7.7.7.7', 'x-forwarded-for': xff + ', 7.7.7.7' }, body: '{"action":"hide","keys":["a"]}' });
    for (let i = 0; i < 20; i++) await post('nope', '10.0.0.' + i);
    assert.equal((await post('pw-123', '10.9.9.9')).status, 429);
    // 다른 사람(x-real-ip 다름)은 영향 없음 — 위조 XFF 로 남을 잠글 수 없음
    const other = await fetch(t.api.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-stock-password': 'pw-123', 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '7.7.7.7' }, body: '{"action":"hide","keys":["a"]}' });
    assert.equal(other.status, 200);
  } finally { delete process.env.VERCEL; t.close(); }
});

test('IP(Vercel 밖): x-real-ip·XFF 를 믿지 않고 소켓 주소 — 헤더를 바꿔도 같은 IP 로 잠김', async () => {
  const t = await setup(); delete process.env.VERCEL;
  try {
    const h = require('../api/stock.js')._test;
    assert.equal(h.clientIp({ headers: { 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1' }, socket: { remoteAddress: '3.3.3.3' } }), '3.3.3.3');
    for (let i = 0; i < 20; i++) await fetch(t.api.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-stock-password': 'nope', 'x-real-ip': '10.0.0.' + i, 'x-forwarded-for': '10.1.0.' + i }, body: '{"action":"hide","keys":["a"]}' });
    const r = await fetch(t.api.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-stock-password': 'pw-123', 'x-real-ip': '10.9.9.9' }, body: '{"action":"hide","keys":["a"]}' });
    assert.equal(r.status, 429, '헤더 위조로 잠금 우회 불가');
  } finally { t.close(); }
});

test('인증된 ?t= 우회 반복·동시 → GitHub 목록 호출 5초에 1회 이하, 쓰기 직후 첫 우회는 바로 최신', async () => {
  const t = await setup();
  try {
    await fetch(t.api.url);                                     // 캐시 데움
    const n0 = t.gh.calls.index;
    for (let i = 0; i < 8; i++) await fetch(t.api.url + '?t=s' + i, { headers: { 'x-stock-password': 'pw-123' } });
    await Promise.all(Array.from({ length: 6 }, (_, i) => fetch(t.api.url + '?t=c' + i, { headers: { 'x-stock-password': 'pw-123' } })));
    assert.ok(t.gh.calls.index - n0 <= 1, '5초 안 우회 14회 → 목록 호출 ' + (t.gh.calls.index - n0));
    // 쓰기 → 쓴 브라우저의 첫 우회는 바로 최신(쓰기가 캐시를 비움)
    const up = await (await t.post({ action: 'upload', name: 'z.png', dataUrl: dataUrl(PNG) })).json();
    const l = await (await fetch(t.api.url + '?t=after', { headers: { 'x-stock-password': 'pw-123' } })).json();
    assert.ok(l.items.some(x => x.id === up.item.id));
  } finally { t.close(); }
});
