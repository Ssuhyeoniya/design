// 이미지 에셋 라이브러리 · 배너 기획안 분리 저장 검증 — node --test tools/creative-lib.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { addAsset, searchAssets, savePlan, loadPlan, loadRegistry, resolvePlan, validateAll, imageSize } from './creative-lib.mjs';

const P = createRequire(import.meta.url)('../banner_studio/plans.js');

// 단색 PNG 를 직접 만든다 (색이 다르면 체크섬도 다르다)
function png(w, h, rgb) {
  const crc = b => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xffffffff; for (const v of b) x = t[(x ^ v) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill(rgb).flat())]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-lib-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-src-'));
  const f = (name, w, h, rgb) => { const p = path.join(tmp, name); fs.writeFileSync(p, png(w, h, rgb)); return p; };
  return { root, f };
}
const plan = (bannerId, assetId, extra = {}) => ({
  bannerId, campaignId: 'saboten-discount', bannerName: '사보텐 할인 ' + bannerId, templateId: 'popup',
  optionValues: { type: 'popup' }, purpose: '할인 인지', target: '전체 사용자',
  content: { mainCopy: '사보텐 최대 15% 할인', subCopy: '식권대장 앱 결제 시 할인', cta: '혜택 확인하기' },
  assets: { mainImageAssetId: assetId }, layout: { images: { main: { x: 500, y: 400, w: 400, h: 400, crop: null } } },
  designConcept: '따뜻한 톤', period: { start: '2026-11-01', end: '2026-11-30' }, ...extra,
});

test('1. 이미지 에셋과 기획안 저장 위치가 분리된다', () => {
  const { root, f } = setup();
  const { asset } = addAsset(root, { file: f('a.png', 40, 30, [200, 80, 40]), category: 'food', description: '돈까스', keywords: ['돈까스', '할인'], tool: 'higgsfield', model: 'test-model', prompt: 'tonkatsu', license: '사내 사용' });
  savePlan(root, plan('home', asset.assetId));
  assert.match(asset.path, /^assets\/campaign-library\/food\//);
  const saved = fs.readFileSync(path.join(root, 'data/banner-plans/campaigns/saboten-discount/home.json'), 'utf8');
  assert.ok(!saved.includes('data:image') && !saved.includes('.png'), '기획안에 이미지 파일·경로가 들어가지 않는다');
  assert.equal(JSON.parse(saved).assets.mainImageAssetId, asset.assetId);
  // 필수 메타데이터
  for (const k of ['assetId', 'fileName', 'category', 'description', 'keywords', 'width', 'height', 'ratio', 'generator', 'createdAt', 'path', 'usage', 'license', 'reusable', 'checksum'])
    assert.ok(k in asset, '메타데이터 ' + k);
  assert.deepEqual([asset.width, asset.height, asset.ratio], [40, 30, '4:3']);
  assert.deepEqual(validateAll(root).errors, []);
});

test('2. 하나의 이미지를 여러 배너가 재사용한다 (사용 이력 기록)', () => {
  const { root, f } = setup();
  const { asset } = addAsset(root, { file: f('a.png', 10, 10, [1, 2, 3]), category: 'food' });
  savePlan(root, plan('home', asset.assetId));
  savePlan(root, plan('popup2', asset.assetId, { campaignId: 'saboten-discount' }));
  const reg = loadRegistry(root);
  assert.equal(reg.assets.length, 1);
  assert.deepEqual(reg.assets[0].usage.map(u => u.bannerId).sort(), ['home', 'popup2']);
  assert.equal(fs.readdirSync(path.join(root, 'assets/campaign-library/food')).length, 1, '파일은 한 벌만');
});

test('3. 카피만 수정하면 이미지는 그대로, 버전·이력만 올라간다', () => {
  const { root, f } = setup();
  const { asset } = addAsset(root, { file: f('a.png', 10, 10, [9, 9, 9]), category: 'food' });
  savePlan(root, plan('home', asset.assetId), { by: 'agent-04' });
  const before = fs.readdirSync(path.join(root, 'assets/campaign-library/food'));
  const p = plan('home', asset.assetId); p.content.mainCopy = '사보텐 최대 20% 할인';
  const r = savePlan(root, p, { by: 'agent-04', summary: '할인율 수정' });
  assert.equal(r.plan.version, 2);
  assert.deepEqual(r.changed, ['content.mainCopy']);
  assert.equal(r.plan.assets.mainImageAssetId, asset.assetId);
  assert.deepEqual(fs.readdirSync(path.join(root, 'assets/campaign-library/food')), before, '이미지 재생성·복제 없음');
  assert.ok(fs.existsSync(path.join(root, 'data/banner-plans/versions/home/v1.json')) && fs.existsSync(path.join(root, 'data/banner-plans/versions/home/v2.json')));
  assert.equal(r.plan.history.length, 2);
  // 바뀐 게 없으면 저장하지 않는다
  assert.equal(savePlan(root, p).saved, false);
});

test('4. 한 배너의 이미지를 바꿔도 다른 배너는 영향이 없다 · 수정본은 새 Asset ID + 원본 연결', () => {
  const { root, f } = setup();
  const a1 = addAsset(root, { file: f('a.png', 10, 10, [10, 10, 10]), category: 'food' }).asset;
  savePlan(root, plan('home', a1.assetId));
  savePlan(root, plan('popup2', a1.assetId));
  const edited = addAsset(root, { file: f('a-edit.png', 10, 10, [20, 20, 20]), category: 'food', parentAssetId: a1.assetId, relation: 'retouch' }).asset;
  assert.notEqual(edited.assetId, a1.assetId);
  assert.equal(edited.parentAssetId, a1.assetId);
  savePlan(root, plan('home', edited.assetId));
  assert.equal(loadPlan(root, 'popup2').assets.mainImageAssetId, a1.assetId, '다른 배너는 원본 유지');
  assert.ok(fs.existsSync(path.join(root, a1.path)), '원본 보존');
  // 원본 파일이 덮어써지면 검증이 잡아낸다 (경로·체크섬 고정)
  fs.writeFileSync(path.join(root, a1.path), png(10, 10, [99, 99, 99]));
  assert.ok(validateAll(root).errors.some(e => e.includes('체크섬 불일치')));
});

test('5. 기존 Asset ID 로 실제 이미지 경로를 불러온다', () => {
  const { root, f } = setup();
  const a = addAsset(root, { file: f('a.png', 10, 10, [5, 5, 5]), category: 'office' }).asset;
  savePlan(root, plan('home', a.assetId));
  const r = resolvePlan(root, 'home');
  assert.deepEqual(r.images, [{ slot: 'main', assetId: a.assetId, path: a.path, exists: true }]);
  assert.throws(() => savePlan(root, plan('bad', 'asset-food-999')), /존재하지 않는 Asset ID/);
});

test('6. 배너명·옵션값으로 기획안을 찾는다', () => {
  const { root, f } = setup();
  const a = addAsset(root, { file: f('a.png', 10, 10, [6, 6, 6]), category: 'food' }).asset;
  savePlan(root, plan('home', a.assetId));
  const idx = JSON.parse(fs.readFileSync(path.join(root, 'data/banner-plans/index.json'), 'utf8'));
  assert.equal(P.findPlan(idx, { bannerName: '사보텐 할인 home', type: 'popup' }).bannerId, 'home');
  assert.equal(P.findPlan(idx, { bannerName: '사보텐 할인 home', type: 'splash' }), null, '옵션값이 다르면 다른 배너');
  assert.throws(() => savePlan(root, plan('x', a.assetId, { optionValues: { type: 'splash' } })), /templateId/);
});

test('7. 스튜디오 상태 ↔ 기획안 변환: 카피·배치 반영, 바이너리 제외', () => {
  const reg = { assets: [{ assetId: 'asset-food-001', fileName: 'x.png', path: 'assets/campaign-library/food/asset-food-001.png' }] };
  const seeded = { type: 'popup', w: 1080, h: 1500, bg: { mode: 'solid', c1: '#000000' }, layers: [
    { id: 'm', kind: 'text', role: 'main', text: '' }, { id: 's', kind: 'text', role: 'sub', text: '' }, { id: 'b', kind: 'text', role: 'buttonText', text: '' }] };
  const p = plan('home', 'asset-food-001');
  const { state, missing } = P.applyPlan(seeded, p, reg, '../');
  assert.deepEqual(missing, []);
  assert.equal(state.layers.find(l => l.role === 'main').text, '사보텐 최대 15% 할인');
  const img = state.layers.find(l => l.kind === 'image');
  assert.equal(img.src, '../assets/campaign-library/food/asset-food-001.png');
  assert.equal(img.x, 500);
  // 미리보기에서 카피를 바꾸고, 브라우저 보관함 이미지(dataURL)를 하나 더 얹는다
  state.layers.find(l => l.role === 'main').text = '새 카피';
  img.x = 520;
  state.layers.push({ id: 'z', kind: 'image', role: 'object', name: 'local.png', src: 'data:image/png;base64,AAAA', x: 0, y: 0, w: 1, h: 1 });
  const { plan: out, unlinked } = P.stateToPlan(state, p);
  assert.deepEqual(unlinked, ['local.png']);
  assert.deepEqual(P.findBinary(out), []);
  assert.equal(out.assets.mainImageAssetId, 'asset-food-001');
  assert.deepEqual(P.diffPlans(p, out).filter(k => !k.startsWith('optionValues')), ['content.mainCopy', 'layout.images.main']);
});

test('8. 같은 파일을 다시 등록하면 새로 저장하지 않고 기존 Asset ID 를 돌려준다', () => {
  const { root, f } = setup();
  const src = f('a.png', 10, 10, [7, 7, 7]);
  const a = addAsset(root, { file: src, category: 'food' });
  const fsCopy = path.join(path.dirname(src), 'renamed-copy.png'); fs.copyFileSync(src, fsCopy);
  const b = addAsset(root, { file: fsCopy, category: 'promotion' });
  assert.equal(b.duplicate, true);
  assert.equal(b.asset.assetId, a.asset.assetId);
  assert.equal(loadRegistry(root).assets.length, 1);
  assert.equal(searchAssets(root, { q: '' }).length, 1);
  assert.deepEqual(imageSize(png(3, 7, [0, 0, 0])), { w: 3, h: 7 });
});
