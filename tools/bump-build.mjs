#!/usr/bin/env node
// 빌드 번호 한 번에 올리기 — 세 화면 HTML 의 <meta name="app-build"> 와 version.json 4곳을 같은 값으로
//   node tools/bump-build.mjs            → 오늘 날짜 기준 다음 번호 (예: 20261104-5 → 20261104-6, 날짜가 바뀌면 YYYYMMDD-1)
//   node tools/bump-build.mjs 20261105-1 → 그 값으로
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { HTML, VERSION, META } from './build-files.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const cur = (() => { try { return JSON.parse(read(VERSION)).build || ''; } catch { return ''; } })();
let next = process.argv[2];
if (!next) {
  const d = new Date(), today = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const m = /^(\d{8})-(\d+)$/.exec(cur);
  next = m && m[1] === today ? `${today}-${+m[2] + 1}` : `${today}-1`;
}
if (!/^\d{8}-\d+$/.test(next)) { console.error('빌드 번호 형식은 YYYYMMDD-N 이어야 해:', next); process.exit(1); }
for (const f of HTML) {
  const s = read(f);
  if (!META.test(s)) { console.error(`${f} 에 <meta name="app-build"> 가 없어`); process.exit(1); }
  fs.writeFileSync(path.join(root, f), s.replace(META, `<meta name="app-build" content="${next}">`));
}
let v = {}; try { v = JSON.parse(read(VERSION)); } catch { }
v.build = next; fs.writeFileSync(path.join(root, VERSION), JSON.stringify(v, null, 1) + '\n');
console.log(`빌드 번호 ${cur || '(없음)'} → ${next} (${[...HTML, VERSION].join(', ')})`);
