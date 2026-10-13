/* 배너 기획안 ↔ 이미지 에셋 라이브러리 연결 로직
   브라우저(배너 스튜디오)와 Node(tools/creative-lib.mjs) 가 같은 코드를 쓴다.

   원칙 — 이미지 에셋과 배너 기획안은 따로 저장한다.
     에셋 레지스트리 : assets/campaign-library/metadata/assets.json   (이미지 파일 + 메타데이터)
     배너 기획안     : data/banner-plans/campaigns/{campaignId}/{bannerId}.json
   기획안에는 이미지 파일·dataURL 을 넣지 않고 Asset ID 만 적는다.
   templateId / optionValues.type 은 data/banner_specs.json 의 배너 타입 키(splash, popup …)를 그대로 쓴다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BannerPlans = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const REQUIRED = ['bannerId', 'campaignId', 'bannerName', 'templateId', 'optionValues', 'purpose', 'target',
    'content', 'assets', 'designConcept', 'period', 'version', 'history'];

  // 기획안 assets 의 키 규칙: {slot}ImageAssetId — 예) mainImageAssetId → 슬롯 'main'
  const SLOT_RE = /^(.+)ImageAssetId$/;
  const slotKey = slot => slot + 'ImageAssetId';

  // 카피 ↔ 스튜디오 레이어 role (app.js seedLayers 가 만드는 role 그대로)
  const COPY_ROLE = { mainCopy: 'main', subCopy: 'sub', cta: 'buttonText', brandText: 'logo' };

  const clone = o => JSON.parse(JSON.stringify(o));

  function assetMap(registry) {
    const m = new Map();
    for (const a of (registry && registry.assets) || []) m.set(a.assetId, a);
    return m;
  }

  // 레지스트리의 path 는 저장소 루트 기준. base 는 호출하는 쪽에서 루트까지의 상대경로 (스튜디오는 '../')
  function assetUrl(asset, base) {
    return (base || '') + asset.path.split('/').map(encodeURIComponent).join('/');
  }

  function imageSlots(plan) {
    const out = [];
    for (const [k, id] of Object.entries((plan && plan.assets) || {})) {
      const m = k.match(SLOT_RE);
      if (m && id) out.push({ slot: m[1], assetId: id });
    }
    return out;
  }

  /* 기획안을 이미 시딩된 스튜디오 상태에 입힌다.
     state 는 blankState + seedLayers 를 거친 값이어야 한다 (타입 뼈대는 스튜디오가 만든다).
     이미지 레이어는 배치 설정이 있으면 그대로, 없으면 fit:null 로 돌려줘 스튜디오가 권장 영역에 맞춘다. */
  function applyPlan(state, plan, registry, base) {
    const S = clone(state);
    const ov = plan.optionValues || {};
    if (ov.w) S.w = ov.w;
    if (ov.h) S.h = ov.h;
    if (ov.bg) S.bg = { ...S.bg, ...ov.bg };
    S.name = plan.bannerName;

    const c = plan.content || {};
    for (const [field, role] of Object.entries(COPY_ROLE)) {
      if (c[field] == null) continue;
      const l = S.layers.find(x => x.role === role && x.kind === 'text');
      if (l) l.text = c[field];
    }
    // 레이어별 세부 조정(위치·크기·색) — 카피 외 레이아웃 변경분
    for (const [role, patch] of Object.entries((plan.layout && plan.layout.text) || {})) {
      const l = S.layers.find(x => x.role === role && (x.kind === 'text' || x.kind === 'rect'));
      if (l) Object.assign(l, patch);
    }

    const amap = assetMap(registry), missing = [], images = [];
    const placements = (plan.layout && plan.layout.images) || {};
    for (const { slot, assetId } of imageSlots(plan)) {
      const a = amap.get(assetId);
      if (!a) { missing.push(assetId); continue; }
      const p = placements[slot] || null;
      images.push({
        id: 'plan-' + slot, kind: 'image', role: 'object', slot, assetId,
        name: a.fileName, src: assetUrl(a, base), opacity: 1, radius: 0,
        ...(p ? { x: p.x, y: p.y, w: p.w, h: p.h, crop: p.crop || null, opacity: p.opacity == null ? 1 : p.opacity, radius: p.radius || 0, flip: !!p.flip } : {}),
        needsFit: !p,
      });
    }
    // 이미지는 텍스트 아래에 깐다 (addStockImage 와 같은 순서 규칙)
    const firstText = S.layers.findIndex(x => x.kind === 'text');
    S.layers.splice(firstText >= 0 ? firstText : S.layers.length, 0, ...images);
    S.planRef = { bannerId: plan.bannerId, campaignId: plan.campaignId, version: plan.version };
    return { state: S, missing };
  }

  /* 스튜디오 상태 → 기획안. base(기존 기획안)의 기획 필드(목적·타깃·기간 등)는 유지하고
     스튜디오에서 바뀌는 값(카피·이미지 참조·배치·옵션)만 덮는다. 이미지 바이너리는 절대 담지 않는다. */
  function stateToPlan(state, base) {
    const plan = clone(base || {});
    plan.templateId = state.type;
    plan.optionValues = { ...(plan.optionValues || {}), type: state.type, w: state.w, h: state.h, bg: clone(state.bg) };
    plan.content = { ...(plan.content || {}) };
    for (const [field, role] of Object.entries(COPY_ROLE)) {
      const l = state.layers.find(x => x.role === role && x.kind === 'text');
      if (l) plan.content[field] = l.text;
    }

    const assets = {}, images = {}, unlinked = [];
    const used = new Set();
    for (const l of state.layers.filter(x => x.kind === 'image' && x.role !== 'bi' && !x.hidden)) {
      if (!l.assetId) { unlinked.push(l.name); continue; }   // 브라우저 보관함 이미지 — 라이브러리에 없음
      let slot = l.slot || 'main';
      while (used.has(slot)) slot = slot === 'main' ? 'sub' : slot + '2';
      used.add(slot);
      assets[slotKey(slot)] = l.assetId;
      images[slot] = { x: l.x, y: l.y, w: l.w, h: l.h, crop: l.crop || null, opacity: l.opacity == null ? 1 : l.opacity, radius: l.radius || 0, flip: !!l.flip };
    }
    // 기존 기획안의 이미지 외 참조 키는 남기고, 이미지 슬롯은 현재 상태로 교체
    for (const k of Object.keys(plan.assets || {})) if (!SLOT_RE.test(k)) assets[k] = plan.assets[k];
    plan.assets = assets;
    plan.layout = { ...(plan.layout || {}), images };
    return { plan, unlinked };
  }

  // 비교 대상에서 이력·메타는 뺀다
  const VOLATILE = new Set(['version', 'history', 'updatedAt']);
  function diffPlans(a, b) {
    const out = [];
    const walk = (x, y, path) => {
      if (JSON.stringify(x) === JSON.stringify(y)) return;
      const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
      if (isObj(x) && isObj(y) && path.split('.').length < 3) {
        for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], path ? path + '.' + k : k);
      } else out.push(path);
    };
    const strip = p => Object.fromEntries(Object.entries(p || {}).filter(([k]) => !VOLATILE.has(k)));
    walk(strip(a), strip(b), '');
    return out;
  }

  /* 바뀐 경우에만 버전을 올리고 이력을 남긴다. 바뀐 게 없으면 null. */
  function nextVersion(prev, next, meta) {
    const changed = prev ? diffPlans(prev, next) : ['(신규)'];
    if (prev && !changed.length) return null;
    const out = clone(next);
    out.version = prev ? (prev.version || 0) + 1 : 1;
    out.updatedAt = (meta && meta.at) || new Date().toISOString();
    out.history = [...((prev && prev.history) || []), {
      version: out.version, at: out.updatedAt, by: (meta && meta.by) || 'unknown',
      summary: (meta && meta.summary) || '', changed,
    }];
    return out;
  }

  // dataURL·base64 덩어리가 기획안 어디에도 없어야 한다
  function findBinary(o, path, out) {
    out = out || [];
    if (typeof o === 'string') {
      if (/^data:[^;]+;base64,/.test(o) || (o.length > 2000 && /^[A-Za-z0-9+/=\s]+$/.test(o))) out.push(path || '(root)');
    } else if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) findBinary(v, path ? path + '.' + k : k, out);
    }
    return out;
  }

  function validatePlan(plan, registry) {
    const errors = [];
    for (const k of REQUIRED) if (plan[k] == null) errors.push(`필수 필드 누락: ${k}`);
    if (plan.optionValues && plan.templateId && plan.optionValues.type && plan.optionValues.type !== plan.templateId) {
      errors.push(`templateId(${plan.templateId}) 와 optionValues.type(${plan.optionValues.type}) 이 다릅니다`);
    }
    for (const p of findBinary(plan)) errors.push(`이미지 바이너리 포함 금지: ${p}`);
    const amap = assetMap(registry);
    for (const { slot, assetId } of imageSlots(plan)) {
      if (!amap.has(assetId)) errors.push(`존재하지 않는 Asset ID: ${assetId} (슬롯 ${slot})`);
    }
    return errors;
  }

  // 같은 기획안을 가리키는지 — 스튜디오에서 배너명 + 옵션값(type)으로 조회할 때 쓴다
  function findPlan(index, q) {
    const items = (index && index.plans) || [];
    if (q.bannerId) return items.find(p => p.bannerId === q.bannerId) || null;
    return items.find(p => p.bannerName === q.bannerName && (!q.type || p.templateId === q.type)) || null;
  }

  return { REQUIRED, COPY_ROLE, slotKey, assetMap, assetUrl, imageSlots, applyPlan, stateToPlan, diffPlans, nextVersion, findBinary, validatePlan, findPlan };
});
