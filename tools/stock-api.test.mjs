// api/stock.js 단위 테스트 — GitHub Contents API 목 서버로 업로드·삭제·숨김·복원·충돌 재시도·비밀번호·형식/크기 거부
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// ── 목 GitHub: 메모리 파일 시스템 + 커밋 기록, 일부러 sha 충돌 만들기
function mockGitHub({ isPrivate = false } = {}) {
  const files = new Map();             // path → { buf, sha }
  const commits = [];
  let conflictsLeft = 0, n = 0;
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (s, o, raw) => { res.statusCode = s; if (raw) { res.end(raw); return; } res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== 'Bearer TEST_TOKEN') return send(401, { message: 'bad token' });
    const m = /^\/repos\/([^/]+)\/([^/]+)(?:\/contents\/(.+))?$/.exec(u.pathname);
    if (!m) return send(404, {});
    if (!m[3]) return send(200, { private: isPrivate });
    const path = decodeURIComponent(m[3]);
    let body = ''; for await (const ch of req) body += ch;
    if (req.method === 'GET') {
      const f = files.get(path); if (!f) return send(404, { message: 'Not Found' });
      if (/raw/.test(req.headers.accept || '')) return send(200, null, f.buf);
      return send(200, { sha: f.sha, content: f.buf.toString('base64'), encoding: 'base64' });
    }
    if (req.method === 'PUT') {
      const j = JSON.parse(body), f = files.get(path);
      if (/index\.json|hidden\.json/.test(path) && conflictsLeft > 0) { conflictsLeft--; return send(409, { message: 'conflict' }); }
      if (f && j.sha !== f.sha) return send(409, { message: 'sha mismatch' });
      if (!f && j.sha) return send(422, { message: 'sha for new file' });
      const sha = 's' + (++n); files.set(path, { buf: Buffer.from(j.content, 'base64'), sha }); commits.push({ op: 'put', path, message: j.message, branch: j.branch });
      return send(f ? 200 : 201, { content: { sha } });
    }
    if (req.method === 'DELETE') {
      const j = JSON.parse(body), f = files.get(path); if (!f) return send(404, {});
      if (j.sha !== f.sha) return send(409, {});
      files.delete(path); commits.push({ op: 'del', path, message: j.message }); return send(200, {});
    }
    send(405, {});
  });
  return new Promise(r => srv.listen(0, () => r({ srv, files, commits, url: `http://127.0.0.1:${srv.address().port}`, conflict: k => { conflictsLeft = k; } })));
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
  process.env.GITHUB_REPO = 'Ssuhyeoniya/design'; process.env.GITHUB_BRANCH = 'main'; delete process.env.STOCK_DIR;
  delete require.cache[require.resolve('../api/stock.js')];
  const handler = require('../api/stock.js'); handler._test.resetCache();
  const api = await serveHandler(handler);
  const post = (body, pw = 'pw-123') => fetch(api.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(pw != null ? { 'x-stock-password': pw } : {}) }, body: JSON.stringify(body) });
  const close = () => { gh.srv.close(); api.srv.close(); };
  return { gh, api, post, close };
}

test('업로드 → 이미지 파일·index.json 커밋, 목록에 나옴(공개 저장소 = raw URL)', async () => {
  const t = await setup();
  try {
    const r = await t.post({ action: 'upload', name: '쿠폰.png', category: '이벤트', dataUrl: dataUrl(PNG) });
    assert.equal(r.status, 200); const j = await r.json(); assert.ok(j.ok && j.item.id);
    assert.ok(t.gh.files.has(j.item.path) && /^assets\/user-stock\/.+\.png$/.test(j.item.path));
    assert.ok(t.gh.commits.some(c => c.message === 'chore(stock): 업로드 쿠폰.png' && c.branch === 'main'));
    const l = await (await fetch(t.api.url)).json();
    assert.equal(l.enabled, true); assert.equal(l.items.length, 1); assert.equal(l.items[0].name, '쿠폰.png');
    assert.match(l.items[0].url, /^https:\/\/raw\.githubusercontent\.com\/Ssuhyeoniya\/design\/main\/assets\/user-stock\//);
    // 같은 내용 다시 올리면 중복으로 건너뜀
    const r2 = await (await t.post({ action: 'upload', name: '쿠폰 사본.png', dataUrl: dataUrl(PNG) })).json();
    assert.equal(r2.duplicate, true);
    assert.equal((await (await fetch(t.api.url)).json()).items.length, 1);
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
    assert.ok(!t.gh.files.has(a.path)); assert.ok(t.gh.commits.some(c => c.op === 'del' && c.message === 'chore(stock): 삭제 a.png'));
    assert.equal((await (await fetch(t.api.url)).json()).items.length, 0);
  } finally { t.close(); }
});

test('숨김·복원 → hidden.json', async () => {
  const t = await setup();
  try {
    let j = await (await t.post({ action: 'hide', keys: ['assets/campaign-library/a.png', 'banner_studio/stock/b.png'], on: true })).json();
    assert.deepEqual(j.hidden.sort(), ['assets/campaign-library/a.png', 'banner_studio/stock/b.png']);
    j = await (await t.post({ action: 'hide', keys: ['banner_studio/stock/b.png'], on: false })).json();
    assert.deepEqual(j.hidden, ['assets/campaign-library/a.png']);
    const l = await (await fetch(t.api.url)).json(); assert.deepEqual(l.hidden, ['assets/campaign-library/a.png']);
  } finally { t.close(); }
});

test('sha 충돌 → 최신을 다시 읽어 재시도해 성공', async () => {
  const t = await setup();
  try {
    t.gh.conflict(3);
    const r = await t.post({ action: 'upload', name: 'c.png', dataUrl: dataUrl(PNG) });
    assert.equal(r.status, 200);
    assert.equal((await (await fetch(t.api.url)).json()).items.length, 1);
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
    const names = (await (await fetch(t.api.url)).json()).items.map(x => x.name).sort();
    assert.deepEqual(names, ['p1.png', 'p2.png']);
  } finally { t.close(); }
});

test('비밀번호 없음·틀림 → 401, 서버에 비밀번호 미설정 → 403', async () => {
  const t = await setup();
  try {
    assert.equal((await t.post({ action: 'hide', keys: ['a'] }, null)).status, 401);
    assert.equal((await t.post({ action: 'hide', keys: ['a'] }, 'wrong')).status, 401);
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
    assert.equal(t.gh.commits.length, 0);
  } finally { t.close(); }
});

test('토큰 미설정 → enabled:false (공용 저장 꺼짐)', async () => {
  const t = await setup();
  try {
    process.env.GITHUB_TOKEN = '';
    const l = await (await fetch(t.api.url)).json(); assert.equal(l.enabled, false);
  } finally { t.close(); }
});
