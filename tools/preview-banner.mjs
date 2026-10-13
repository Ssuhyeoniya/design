#!/usr/bin/env node
/* 배너 기획안 미리보기 캡처 — 외부 패키지 없이 로컬 Chrome 을 DevTools 파이프로 조작한다.
   스튜디오가 기획안을 다 그린 뒤(body[data-ready]) 화면과 캔버스(배너 단독)를 PNG 로 저장한다.

   node tools/preview-banner.mjs --plan sample-coupon-popup [--out ./preview] [--view clean|guide] [--url http://127.0.0.1:8765]
   --url 을 주지 않으면 저장소 루트를 임시 정적 서버로 띄운다.                                         */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const a = Object.fromEntries(process.argv.slice(2).join(' ').split(/\s*--/).filter(Boolean).map(s => { const [k, ...v] = s.split(' '); return [k, v.join(' ') || true]; }));
if (!a.plan) { console.error('--plan <bannerId> 가 필요합니다'); process.exit(2); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(a.out || path.join(ROOT, '.preview'));
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));
if (!CHROME) { console.error('Chrome 을 찾지 못했습니다 — CHROME 환경변수로 경로를 지정하세요'); process.exit(2); }

// ── 임시 정적 서버 ─────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.otf': 'font/otf', '.svg': 'image/svg+xml' };
let server, base = a.url;
if (!base) {
  server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}
const url = `${base}/banner_studio/index.html?plan=${encodeURIComponent(a.plan)}&view=${a.view || 'clean'}`;

// ── Chrome (DevTools 파이프: fd3 쓰기, fd4 읽기) ─────────────────────────────
const prof = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'bs-preview-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-pipe', '--no-first-run', '--disable-gpu', `--user-data-dir=${prof}`, '--window-size=1500,950', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
let id = 0, buf = '';
const waiters = new Map();
chrome.stdio[4].on('data', d => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\0')) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  }
});
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const n = ++id;
  waiters.set(n, m => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result));
  chrome.stdio[3].write(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

let code = 0;
try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: s } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false }, s);
  await send('Page.navigate', { url }, s);
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, s)).result.value;
  for (let t = 0; t < 100 && !(await ev('document.body && document.body.dataset.ready === "1"')); t++) await sleep(150);
  await sleep(500);                                   // 이미지·폰트 디코딩 여유
  const info = await ev(`(() => ({
    opened: !!(curPlan && curPlan.bannerId === ${JSON.stringify(a.plan)}),
    bannerId: curPlan && curPlan.bannerId, version: curPlan && curPlan.version, type: S.type, size: S.w + 'x' + S.h,
    images: S.layers.filter(l => l.kind === 'image' && l.role !== 'bi').map(l => ({ assetId: l.assetId || null, loaded: imgCache.has(l.src), x: l.x, y: l.y, w: l.w, h: l.h })),
    verdict: document.querySelector('#verdict').textContent,
    checks: runChecks().filter(c => c.lv !== 'ok').map(c => c.lv + ' ' + c.t + ' — ' + c.m),
    toast: document.querySelector('#toast').textContent,
  }))()`);
  fs.mkdirSync(OUT, { recursive: true });
  const shot = await send('Page.captureScreenshot', { format: 'png' }, s);
  const screen = path.join(OUT, `${a.plan}-studio.png`);
  fs.writeFileSync(screen, Buffer.from(shot.data, 'base64'));
  const art = await ev(`(() => { sel = null; renderArt(); return art.toDataURL('image/png'); })()`);
  const banner = path.join(OUT, `${a.plan}-banner.png`);
  fs.writeFileSync(banner, Buffer.from(art.split(',')[1], 'base64'));
  console.log(JSON.stringify({ url, ...info, files: { studio: screen, banner } }, null, 2));
  if (!info.opened) { console.error('기획안이 열리지 않았습니다 — ' + info.toast); code = 1; }
  if (info.images.some(i => !i.loaded)) { console.error('불러오지 못한 이미지가 있습니다'); code = 1; }
} catch (e) { console.error(e.message); code = 1; }
server && server.close();
await new Promise(r => { chrome.once('exit', r); chrome.kill(); setTimeout(r, 3000); });
try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* 임시 프로필 — 남아도 무해 */ }
process.exit(code);
