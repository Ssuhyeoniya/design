#!/usr/bin/env node
/* 캠페인 이미지 에셋 라이브러리 · 배너 기획안 관리 CLI
   Agent 04(앱 CRM 캠페인 기획) · Agent 05(크리에이티브 스튜디오)가 저장소에 기록할 때 쓴다.
   사용법: node tools/creative-lib.mjs <명령> [--옵션 값 …]   (저장소 루트에서 실행, --root 로 변경 가능)

   asset:add     이미지 등록 (체크섬 중복이면 기존 Asset ID 반환, 파일 복사 안 함)
   asset:link    저장소에 이미 있는 파일을 복사 없이 등록 (--path)
   asset:search  키워드·카테고리·비율로 기존 에셋 검색
   plan:save     기획안 저장 (바뀐 경우에만 버전+1, 이력·스냅샷 기록, 에셋 사용 이력 갱신)
   plan:show     기획안 + 연결된 이미지 실제 경로 조회
   validate      전체 점검 (분리 저장·참조 무결성·파일 고정·중복)                                  */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const P = require('../banner_studio/plans.js');

export const CATEGORIES = ['food', 'lifestyle', 'office', 'seasonal', 'promotion', 'backgrounds', 'shared'];
const LIB = 'assets/campaign-library';
const REG = LIB + '/metadata/assets.json';
const PLANS = 'data/banner-plans';
const INDEX = PLANS + '/index.json';

// ── 파일 유틸 ─────────────────────────────────────────────
const rd = (root, rel, dflt) => { try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); } catch { return dflt; } };
const wr = (root, rel, obj) => {
  const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(obj, null, 2) + '\n');
};
export const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

// PNG / JPEG / WebP 헤더에서 해상도를 읽는다 (외부 패키지 없이)
export function imageSize(buf) {
  if (buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const fmt = buf.toString('ascii', 12, 16);
    if (fmt === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (fmt === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
    if (fmt === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  }
  return { w: null, h: null };
}
const gcd = (a, b) => b ? gcd(b, a % b) : a;
const ratioOf = (w, h) => { if (!w || !h) return null; const g = gcd(w, h); return `${w / g}:${h / g}`; };

export function loadRegistry(root) { return rd(root, REG, { version: 1, assets: [] }); }
export function loadIndex(root) { return rd(root, INDEX, { version: 1, plans: [] }); }

function nextAssetId(reg, category) {
  const pre = `asset-${category}-`;
  const n = reg.assets.filter(a => a.assetId.startsWith(pre)).map(a => +a.assetId.slice(pre.length) || 0);
  return pre + String((n.length ? Math.max(...n) : 0) + 1).padStart(3, '0');
}

// ── 에셋 ─────────────────────────────────────────────
/* 등록 규칙
   - 체크섬이 같은 파일이 이미 있으면 새로 저장하지 않고 기존 Asset ID 를 돌려준다 (duplicate: true)
   - 파일은 {category}/{assetId}{ext} 로 복사하고 이후 덮어쓰지 않는다 (경로 고정)
   - 수정본은 parentAssetId 로 원본과 연결한 새 Asset ID 를 받는다 */
export function addAsset(root, o) {
  if (!CATEGORIES.includes(o.category)) throw new Error(`카테고리는 ${CATEGORIES.join('/')} 중 하나여야 합니다 (받은 값: ${o.category})`);
  const reg = loadRegistry(root);
  const src = o.path ? path.join(root, o.path) : o.file;
  const buf = fs.readFileSync(src);
  const sum = sha256(buf);
  const dup = reg.assets.find(a => a.checksum === sum);
  if (dup) return { asset: dup, duplicate: true };
  if (o.parentAssetId && !reg.assets.some(a => a.assetId === o.parentAssetId)) throw new Error('원본 Asset ID 가 없습니다: ' + o.parentAssetId);

  const assetId = nextAssetId(reg, o.category);
  let rel;
  if (o.path) rel = o.path.split(path.sep).join('/');            // 링크 등록 — 기존 파일을 그대로 가리킨다
  else {
    rel = `${LIB}/${o.category}/${assetId}${path.extname(src).toLowerCase()}`;
    const dst = path.join(root, rel);
    if (fs.existsSync(dst)) throw new Error('같은 경로에 파일이 있습니다 — 덮어쓰지 않습니다: ' + rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  const { w, h } = imageSize(buf);
  const asset = {
    assetId,
    fileName: path.basename(rel),
    originalName: path.basename(src),
    category: o.category,
    description: o.description || '',
    keywords: o.keywords || [],
    width: w, height: h, ratio: ratioOf(w, h),
    generator: { tool: o.tool || null, model: o.model || null, prompt: o.prompt || null },
    createdAt: o.createdAt || new Date().toISOString().slice(0, 10),
    path: rel,
    checksum: sum,
    bytes: buf.length,
    license: o.license || '',
    reusable: o.reusable !== false,
    parentAssetId: o.parentAssetId || null,
    relation: o.parentAssetId ? (o.relation || 'edit') : null,
    usage: [],
  };
  reg.assets.push(asset);
  wr(root, REG, reg);
  return { asset, duplicate: false };
}

/* 검색 — 키워드·설명·카테고리 일치도로 점수를 매긴다. 재사용 불가 에셋은 뺀다. */
export function searchAssets(root, { q = '', category, ratio, minWidth } = {}) {
  const terms = String(q).toLowerCase().split(/[\s,]+/).filter(Boolean);
  return loadRegistry(root).assets
    .filter(a => a.reusable !== false)
    .filter(a => !category || a.category === category)
    .filter(a => !ratio || a.ratio === ratio)
    .filter(a => !minWidth || (a.width || 0) >= minWidth)
    .map(a => {
      const hay = [a.description, a.fileName, a.category, ...(a.keywords || [])].join(' ').toLowerCase();
      const kw = (a.keywords || []).map(k => k.toLowerCase());
      const score = terms.reduce((s, t) => s + (kw.includes(t) ? 3 : hay.includes(t) ? 1 : 0), 0);
      return { score, asset: a };
    })
    .filter(r => !terms.length || r.score > 0)
    .sort((x, y) => y.score - x.score);
}

// ── 기획안 ─────────────────────────────────────────────
const planRel = p => `${PLANS}/campaigns/${p.campaignId}/${p.bannerId}.json`;
const verRel = (id, v) => `${PLANS}/versions/${id}/v${v}.json`;

export function loadPlan(root, bannerId) {
  const hit = loadIndex(root).plans.find(p => p.bannerId === bannerId);
  return hit ? rd(root, hit.path, null) : null;
}

/* 저장 — 검증 → 이전 버전과 비교 → 바뀐 경우에만 버전+1·이력·스냅샷 → 인덱스·사용 이력 갱신 */
export function savePlan(root, draft, meta = {}) {
  const reg = loadRegistry(root);
  const prev = loadPlan(root, draft.bannerId);
  const base = { version: prev ? prev.version : 0, history: prev ? prev.history : [], ...draft };
  const errs = P.validatePlan(base, reg);
  if (errs.length) throw new Error('기획안 검증 실패\n - ' + errs.join('\n - '));
  if (prev && prev.campaignId !== draft.campaignId) throw new Error('캠페인 ID 는 바꿀 수 없습니다 — 새 Banner ID 로 저장하세요');

  const next = P.nextVersion(prev, draft, meta);
  if (!next) return { saved: false, plan: prev, changed: [] };
  wr(root, planRel(next), next);
  wr(root, verRel(next.bannerId, next.version), next);

  const idx = loadIndex(root);
  const row = { bannerId: next.bannerId, campaignId: next.campaignId, bannerName: next.bannerName, templateId: next.templateId, version: next.version, path: planRel(next), updatedAt: next.updatedAt };
  const i = idx.plans.findIndex(p => p.bannerId === next.bannerId);
  if (i >= 0) idx.plans[i] = row; else idx.plans.push(row);
  wr(root, INDEX, idx);
  refreshUsage(root);
  return { saved: true, plan: next, changed: next.history[next.history.length - 1].changed };
}

// 사용 이력은 현재 기획안들에서 다시 계산한다 (손으로 맞추다 어긋나는 일이 없게)
export function refreshUsage(root) {
  const reg = loadRegistry(root);
  const use = new Map();
  for (const row of loadIndex(root).plans) {
    const plan = rd(root, row.path, null); if (!plan) continue;
    for (const { slot, assetId } of P.imageSlots(plan)) {
      if (!use.has(assetId)) use.set(assetId, []);
      use.get(assetId).push({ bannerId: plan.bannerId, campaignId: plan.campaignId, slot, planVersion: plan.version });
    }
  }
  for (const a of reg.assets) a.usage = use.get(a.assetId) || [];
  wr(root, REG, reg);
}

export function resolvePlan(root, bannerId) {
  const plan = loadPlan(root, bannerId);
  if (!plan) return null;
  const amap = P.assetMap(loadRegistry(root));
  return {
    plan,
    images: P.imageSlots(plan).map(({ slot, assetId }) => {
      const a = amap.get(assetId);
      return { slot, assetId, path: a ? a.path : null, exists: a ? fs.existsSync(path.join(root, a.path)) : false };
    }),
  };
}

// ── 전체 점검 ─────────────────────────────────────────────
export function validateAll(root) {
  const errors = [], warns = [];
  const reg = loadRegistry(root);
  const seen = new Map();
  for (const a of reg.assets) {
    const f = path.join(root, a.path);
    if (!fs.existsSync(f)) { errors.push(`${a.assetId}: 파일 없음 ${a.path}`); continue; }
    const sum = sha256(fs.readFileSync(f));
    if (sum !== a.checksum) errors.push(`${a.assetId}: 파일이 등록 후 바뀌었습니다 (체크섬 불일치) — 기존 배너가 의도치 않게 바뀔 수 있습니다`);
    if (seen.has(a.checksum)) errors.push(`${a.assetId}: ${seen.get(a.checksum)} 와 같은 파일 중복 등록`);
    seen.set(a.checksum, a.assetId);
    if (a.path.startsWith(PLANS)) errors.push(`${a.assetId}: 이미지가 기획안 폴더에 있습니다`);
  }
  for (const row of loadIndex(root).plans) {
    const plan = rd(root, row.path, null);
    if (!plan) { errors.push(`${row.bannerId}: 기획안 파일 없음 ${row.path}`); continue; }
    for (const e of P.validatePlan(plan, reg)) errors.push(`${row.bannerId}: ${e}`);
  }
  // 기획안 폴더에 이미지 파일이 섞이면 안 된다
  const walk = d => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
  for (const f of walk(path.join(root, PLANS))) if (/\.(png|jpe?g|webp|gif|svg)$/i.test(f)) errors.push(`기획안 폴더에 이미지 파일: ${path.relative(root, f)}`);
  for (const a of reg.assets) if (!a.usage || !a.usage.length) warns.push(`${a.assetId}: 아직 사용하는 배너 없음`);
  return { errors, warns };
}

// ── CLI ─────────────────────────────────────────────
function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const k = argv[i].slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; o[k] = v; }
    else o._.push(argv[i]);
  }
  return o;
}
const list = v => v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : [];

function main() {
  const a = args(process.argv.slice(2));
  const root = path.resolve(a.root || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const cmd = a._[0];
  const out = x => console.log(JSON.stringify(x, null, 2));
  const assetOpts = () => ({
    category: a.category, description: a.desc, keywords: list(a.keywords), tool: a.tool, model: a.model, prompt: a.prompt,
    license: a.license, reusable: a.reusable !== 'false', parentAssetId: a.parent, relation: a.relation,
  });
  switch (cmd) {
    case 'asset:add': {
      const r = addAsset(root, { ...assetOpts(), file: a.file });
      console.error(r.duplicate ? `이미 있는 이미지입니다 — 기존 ${r.asset.assetId} 를 쓰세요 (새로 저장하지 않음)` : `등록했습니다 — ${r.asset.assetId}`);
      return out(r);
    }
    case 'asset:link': {
      const r = addAsset(root, { ...assetOpts(), path: a.path });
      console.error(r.duplicate ? `이미 있는 이미지입니다 — ${r.asset.assetId}` : `등록했습니다 (복사 없이 링크) — ${r.asset.assetId}`);
      return out(r);
    }
    case 'asset:search':
      return out(searchAssets(root, { q: a.q || '', category: a.category, ratio: a.ratio, minWidth: a.minWidth && +a.minWidth })
        .map(r => ({ score: r.score, assetId: r.asset.assetId, path: r.asset.path, category: r.asset.category, ratio: r.asset.ratio, size: `${r.asset.width}x${r.asset.height}`, description: r.asset.description, usedBy: r.asset.usage.length })));
    case 'plan:save': {
      const draft = JSON.parse(fs.readFileSync(a.file, 'utf8'));
      const r = savePlan(root, draft, { by: a.by, summary: a.summary });
      console.error(r.saved ? `저장했습니다 — ${r.plan.bannerId} v${r.plan.version} (변경: ${r.changed.join(', ')})` : '바뀐 내용이 없어 저장하지 않았습니다');
      return out({ saved: r.saved, bannerId: r.plan.bannerId, version: r.plan.version, changed: r.changed });
    }
    case 'plan:show': return out(resolvePlan(root, a.banner));
    case 'validate': {
      const r = validateAll(root);
      r.warns.forEach(w => console.error('확인:', w));
      r.errors.forEach(e => console.error('오류:', e));
      console.error(r.errors.length ? `오류 ${r.errors.length}건` : '이상 없음');
      process.exitCode = r.errors.length ? 1 : 0; return;
    }
    default:
      console.error('명령: asset:add | asset:link | asset:search | plan:save | plan:show | validate'); process.exitCode = 2;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
