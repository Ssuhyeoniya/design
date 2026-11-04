// bump-build / check-build 테스트 — 저장소 사본(임시 폴더)에서 실행
import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function sandbox() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'build-')); fs.mkdirSync(path.join(d, 'tools')); fs.mkdirSync(path.join(d, 'banner_studio'));
  for (const f of ['tools/build-files.mjs', 'tools/bump-build.mjs', 'tools/check-build.mjs', 'version.json']) fs.copyFileSync(path.join(repo, f), path.join(d, f));
  for (const f of ['blog_image_studio_v4_5.html', 'banner_studio/index.html', 'library.html']) fs.writeFileSync(path.join(d, f), fs.readFileSync(path.join(repo, f), 'utf8').match(/<meta name="app-build"[^>]*>/)[0]);
  return d;
}
const run = (d, f, ...a) => { try { return { code: 0, out: execFileSync('node', [path.join(d, 'tools', f), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { code: e.status, out: String(e.stderr) }; } };
test('저장소의 빌드 번호 4곳이 지금 일치', () => { assert.equal(run(repo.replace(/\/tools$/, ''), 'check-build.mjs').code, 0); });
test('bump-build 로 4곳을 같은 값으로 올리고 check-build 통과', () => {
  const d = sandbox();
  assert.equal(run(d, 'bump-build.mjs', '20991231-7').code, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'version.json'), 'utf8')).build, '20991231-7');
  assert.match(fs.readFileSync(path.join(d, 'banner_studio/index.html'), 'utf8'), /content="20991231-7"/);
  assert.equal(run(d, 'check-build.mjs').code, 0);
  assert.equal(run(d, 'bump-build.mjs').code, 0);                        // 인수 없이 → 오늘 날짜 번호
  assert.equal(run(d, 'check-build.mjs').code, 0);
});
test('한 곳만 다르면 check-build 실패', () => {
  const d = sandbox(); const f = path.join(d, 'library.html');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/content="[^"]*"/, 'content="19990101-1"'));
  const r = run(d, 'check-build.mjs'); assert.equal(r.code, 1); assert.match(r.out, /불일치/);
});
