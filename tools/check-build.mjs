#!/usr/bin/env node
// 빌드 번호 일치 검사 — 세 화면 HTML 의 <meta name="app-build"> 와 version.json 이 모두 같아야 통과(다르면 종료 코드 1)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { HTML, VERSION, META } from './build-files.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vals = {};
for (const f of HTML) { const m = META.exec(fs.readFileSync(path.join(root, f), 'utf8')); vals[f] = m ? m[1] : null; }
try { vals[VERSION] = JSON.parse(fs.readFileSync(path.join(root, VERSION), 'utf8')).build || null; } catch { vals[VERSION] = null; }
const set = new Set(Object.values(vals));
if (set.size !== 1 || set.has(null)) { console.error('빌드 번호 불일치:', vals, '\n→ node tools/bump-build.mjs 로 한 번에 맞춰 줘'); process.exit(1); }
console.log('빌드 번호 일치:', [...set][0]);
