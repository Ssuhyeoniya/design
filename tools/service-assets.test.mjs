// 블로그 스튜디오 내장 서비스 로고·Q&A 목업 ↔ 이미지 소스(라이브러리) 추출본 일치 검증 — node --test tools/service-assets.test.mjs
// 내장본(blog_image_studio_v4_5.html 의 SERVICE_LOGOS·QNA_MOCKUP dataURL)이 바뀌면 추출본과 바이트가 달라져 실패한다.
// 그때는 바뀐 이미지를 asset:add 로 새 Asset ID(--parent 원본)로 등록하고 이 테스트의 매핑을 갱신한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, imageSize, sha256 } from './creative-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readFileSync(path.join(ROOT, 'blog_image_studio_v4_5.html'), 'utf8');
const REG = loadRegistry(ROOT);

// 내장본 키 → 등록 Asset ID (추출 등록 2026-11-23)
const MAP = {
  '광고대장': 'asset-shared-002', '단체선물대장': 'asset-shared-003', '매점대장': 'asset-shared-004', '문자대장': 'asset-shared-005',
  '배달대장': 'asset-shared-006', '복지대장': 'asset-shared-007', '사무기기대장': 'asset-shared-008', '식권대장': 'asset-shared-009',
  '의무교육대장': 'asset-shared-010', '커피대장': 'asset-shared-011', '퀵대장': 'asset-shared-012', '푸드트럭대장': 'asset-shared-013',
  QNA_MOCKUP: 'asset-shared-014',
};

function embedded() {
  const out = {};
  const blk = HTML.match(/const SERVICE_LOGOS=\{([\s\S]*?)\n\};/);
  assert.ok(blk, 'SERVICE_LOGOS 블록을 찾지 못했습니다');
  for (const m of blk[1].matchAll(/"([^"]+)":\{src:"data:image\/(\w+);base64,([^"]+)",ar:([\d.]+)\}/g)) out[m[1]] = { mime: m[2], buf: Buffer.from(m[3], 'base64'), ar: +m[4] };
  const q = HTML.match(/const QNA_MOCKUP=\{src:"data:image\/(\w+);base64,([^"]+)",ar:([\d.]+)\}/);
  assert.ok(q, 'QNA_MOCKUP 을 찾지 못했습니다');
  out.QNA_MOCKUP = { mime: q[1], buf: Buffer.from(q[2], 'base64'), ar: +q[3] };
  return out;
}
const E = embedded();

test('내장본 키가 서비스 로고 12종 + Q&A 목업으로 등록 매핑과 같다', () => {
  assert.deepEqual(Object.keys(E).sort(), Object.keys(MAP).sort());
  assert.equal(Object.keys(E).filter(k => k !== 'QNA_MOCKUP').length, 12);
});

for (const [key, id] of Object.entries(MAP)) {
  test(`${key} → ${id}: 추출 파일 바이트가 내장 dataURL 디코드 결과와 같다`, () => {
    const a = REG.assets.find(x => x.assetId === id);
    assert.ok(a, `레지스트리에 ${id} 가 없습니다`);
    const e = E[key];
    const file = fs.readFileSync(path.join(ROOT, a.path));
    assert.ok(file.equals(e.buf), `${a.path} 가 내장본과 바이트 단위로 다릅니다`);
    assert.equal(a.checksum, sha256(e.buf));
    assert.equal(a.bytes, e.buf.length);
    assert.equal(path.extname(a.path).slice(1), e.mime === 'jpeg' ? 'jpg' : e.mime);
    assert.equal(a.category, 'shared');
    assert.equal(a.reusable, true);
    assert.equal(a.originalName, `${key}.${e.mime}`);
    if (key !== 'QNA_MOCKUP') { assert.ok(a.description.includes(key), '설명에 서비스명이 없습니다'); assert.ok(a.keywords.includes(key), '키워드에 서비스명이 없습니다'); }
    const { w, h } = imageSize(e.buf);
    assert.deepEqual([a.width, a.height], [w, h]);
    // 내장본 ar 은 템플릿 배치용 근사값(로고는 여백 기준)이라 픽셀 비율과 1% 안에서만 맞춘다
    assert.ok(Math.abs(w / h - e.ar) / e.ar < 0.01, `비율 차이: 픽셀 ${(w / h).toFixed(4)} · 내장 ar ${e.ar}`);
  });
}
