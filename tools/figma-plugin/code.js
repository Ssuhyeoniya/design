/* 이미지 스튜디오로 내보내기 — 피그마 플러그인
 * 선택한 프레임을 피그마 REST API(GET /v1/files/:key/nodes)와 같은 모양의 JSON 으로 바꾸고,
 * 이미지 채우기 원본과 직접 그릴 수 없는 요소(벡터·아이콘)의 PNG 를 함께 담아 파일 하나로 내보낸다.
 * 이미지 소스(library.html) → 🧩 UI 컴포넌트 → 🎨 피그마에서 가져오기 → '플러그인 파일' 로 넣으면 된다.
 * REST API 를 쓰지 않으므로 요청 한도·토큰이 필요 없다.
 *
 * 피그마와 100% 같게 — 모든 요소를 피그마가 직접 그린 PNG(bakes)로도 함께 담는다.
 *   글자          → 글자 그림 (고치기 전까지 그대로 보이고, 고치면 그때 편집 가능한 글자로 다시 그린다)
 *   글자 없는 요소 → 통째로 한 장 (아이콘·사진·벡터·마스크 등)
 *   글자를 품은 프레임 → 자기 배경만 한 장 (자식을 뺀 복제본을 그린다) · 글자 하나만 든 오토 레이아웃(버튼)은 글자까지 한 장
 */
figma.showUI(__html__, { width: 360, height: 300 });

const MIXED = figma.mixed;
const VECTORISH = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE', 'REGULAR_POLYGON', 'POLYGON']);
const CONTAINER = new Set(['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION', 'RECTANGLE', 'ELLIPSE']);
const ok = v => v !== MIXED && v !== undefined;

// 그라데이션 변환 행렬 → REST API 의 핸들 좌표 (역행렬로 (0,.5)(1,.5)(0,1) 을 옮긴다)
function handles(t) {
  const [[a, b, c], [d, e, f]] = t, det = a * e - b * d || 1e-9;
  const inv = [[e / det, -b / det, (b * f - c * e) / det], [-d / det, a / det, (c * d - a * f) / det]];
  return [[0, .5], [1, .5], [0, 1]].map(([x, y]) => ({ x: inv[0][0] * x + inv[0][1] * y + inv[0][2], y: inv[1][0] * x + inv[1][1] * y + inv[1][2] }));
}
function paint(p) {
  const o = { type: p.type, visible: p.visible !== false };
  if (p.opacity != null) o.opacity = p.opacity;
  if (p.type === 'SOLID') o.color = Object.assign({ a: 1 }, p.color);
  else if (/^GRADIENT_/.test(p.type)) { o.gradientHandlePositions = handles(p.gradientTransform); o.gradientStops = p.gradientStops.map(s => ({ position: s.position, color: s.color })); }
  else if (p.type === 'IMAGE') {
    o.imageRef = p.imageHash; o.scaleMode = p.scaleMode;
    if (p.imageTransform) o.imageTransform = p.imageTransform;
    if (p.scalingFactor) o.scalingFactor = p.scalingFactor;
  }
  return o;
}
const paints = v => ok(v) ? v.map(paint) : [];
function textStyle(n) {
  const size = ok(n.fontSize) ? n.fontSize : n.getRangeFontSize(0, 1);
  const font = ok(n.fontName) ? n.fontName : n.getRangeFontName(0, 1);
  const weight = ok(n.fontWeight) ? n.fontWeight : n.getRangeFontWeight(0, 1);
  const ls = ok(n.letterSpacing) ? n.letterSpacing : n.getRangeLetterSpacing(0, 1);
  const lh = ok(n.lineHeight) ? n.lineHeight : n.getRangeLineHeight(0, 1);
  return {
    fontFamily: font.family, fontWeight: weight, fontSize: size,
    textAlignHorizontal: n.textAlignHorizontal, textAlignVertical: n.textAlignVertical,
    letterSpacing: ls.unit === 'PERCENT' ? ls.value / 100 * size : ls.value,
    lineHeightPx: lh.unit === 'PIXELS' ? lh.value : lh.unit === 'PERCENT' ? lh.value / 100 * size : size * 1.2,
    textCase: ok(n.textCase) ? n.textCase : 'ORIGINAL',
  };
}
const imageHashes = new Set(), rasterIds = new Set();
const bakeJobs = [];               // { node, mode: 'full' | 'self' }
const visiblePaint = n => ('fills' in n && ok(n.fills) && n.fills.some(p => p.visible !== false)) ||
  ('effects' in n && ok(n.effects) && n.effects.some(e => e.visible !== false)) ||
  ('strokes' in n && ok(n.strokes) && n.strokes.some(p => p.visible !== false) && ok(n.strokeWeight) && n.strokeWeight > 0);
function hasText(n) { return n.type === 'TEXT' || ('children' in n && n.children.some(c => c.visible && hasText(c))); }
function ser(n, isRoot) {
  const o = { id: n.id, name: n.name, type: n.type, visible: n.visible };
  if (n.absoluteBoundingBox) o.absoluteBoundingBox = n.absoluteBoundingBox;
  if (n.absoluteRenderBounds) o.absoluteRenderBounds = n.absoluteRenderBounds;
  for (const k of ['opacity', 'blendMode', 'isMask', 'clipsContent', 'layoutMode', 'primaryAxisSizingMode', 'counterAxisSizingMode', 'layoutSizingHorizontal',
    'layoutSizingVertical', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'itemSpacing', 'primaryAxisAlignItems', 'counterAxisAlignItems',
    'strokeAlign', 'rotation', 'relativeTransform', 'arcData', 'textAutoResize']) if (k in n && ok(n[k])) o[k] = n[k];
  if ('fills' in n) o.fills = paints(n.fills);
  if ('strokes' in n) o.strokes = paints(n.strokes);
  if ('strokeWeight' in n && ok(n.strokeWeight)) o.strokeWeight = n.strokeWeight;
  if ('effects' in n && ok(n.effects)) o.effects = n.effects.map(e => Object.assign({}, e));
  if ('cornerRadius' in n) {
    if (ok(n.cornerRadius)) o.cornerRadius = n.cornerRadius;
    else o.rectangleCornerRadii = [n.topLeftRadius, n.topRightRadius, n.bottomRightRadius, n.bottomLeftRadius];
  }
  if (n.type === 'TEXT') {
    o.characters = n.characters; o.style = textStyle(n);
    try { if (n.getStyledTextSegments(['fills', 'fontName', 'fontSize']).length > 1) o.characterStyleOverrides = [0, 1]; } catch (e) {}
  }
  (o.fills || []).forEach(p => { if (p.type === 'IMAGE' && p.imageRef && p.visible) imageHashes.add(p.imageRef); });
  // 이미지 스튜디오가 직접 그릴 수 없는 것 — PNG 로 같이 보낸다 (글자가 든 것은 글자를 살리려고 굽지 않는다)
  const rot = o.relativeTransform && (Math.abs(o.relativeTransform[0][1]) > 1e-3 || Math.abs(o.relativeTransform[1][0]) > 1e-3);
  const odd = VECTORISH.has(n.type) || (!CONTAINER.has(n.type) && n.type !== 'TEXT') || (o.blendMode && !/^(PASS_THROUGH|NORMAL)$/.test(o.blendMode)) ||
    ('children' in n && n.children.some(c => c.isMask)) || (rot && !isRoot) ||
    [...(o.fills || []), ...(o.strokes || [])].some(p => p.visible && !/^(SOLID|IMAGE|GRADIENT_(LINEAR|RADIAL|ANGULAR|DIAMOND))$/.test(p.type));
  if (n.visible) {
    if (n.type === 'TEXT' || !hasText(n)) bakeJobs.push({ node: n, mode: 'full' });
    else {
      const kids = 'children' in n ? n.children.filter(c => c.visible) : [];
      const label = n.layoutMode && n.layoutMode !== 'NONE' && kids.length === 1 && kids[0].type === 'TEXT';
      if (label) bakeJobs.push({ node: n, mode: 'full' });
      else if (visiblePaint(n)) bakeJobs.push({ node: n, mode: 'self' });
    }
  }
  if (odd && n.type !== 'TEXT' && !hasText(n)) { rasterIds.add(n.id); return o; }
  if ('children' in n) o.children = n.children.map(c => ser(c, false));
  return o;
}
const EXPORT = { format: 'PNG', constraint: { type: 'SCALE', value: 2 } };
// 한 요소를 피그마 그대로 PNG 로. 'self' 는 자식을 뺀 복제본을 페이지 맨 위에 잠깐 만들어 그린 뒤 지운다 (원본은 건드리지 않는다)
async function bake(job) {
  const n = job.node;
  if (job.mode === 'full') {
    // 그림 범위가 없다고 나오는 요소(마스크 안·인스턴스 안 벡터 등)도 상자 크기로 내보내 본다
    const rb = n.absoluteRenderBounds || n.absoluteBoundingBox;
    if (!rb || rb.width < 0.5 || rb.height < 0.5) return { empty: true };   // 크기 0 — 그릴 것이 없다 (알리지 않는다)
    const bytes = await n.exportAsync(EXPORT);
    if (!n.absoluteRenderBounds) {             // 실제 그림 크기(PNG 가로·세로 ÷ 2배)에 맞추고 상자 가운데에 둔다 (테두리가 넘치는 만큼 넓다)
      const pw = bytes[0] === 0x89 ? ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) / 2 : rb.width;
      const ph = bytes[0] === 0x89 ? ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) / 2 : rb.height;
      return { src: b64(bytes), x: rb.x - (pw - rb.width) / 2, y: rb.y - (ph - rb.height) / 2, w: pw, h: ph, approx: true };
    }
    return { src: b64(bytes), x: rb.x, y: rb.y, w: rb.width, h: rb.height };
  }
  let c = n.clone();
  try {
    figma.currentPage.appendChild(c);
    if (c.type === 'INSTANCE') c = c.detachInstance();
    const ab = n.absoluteBoundingBox, w = ab.width, h = ab.height;
    if ('layoutMode' in c && c.layoutMode !== 'NONE') c.layoutMode = 'NONE';
    if ('children' in c) [...c.children].forEach(k => k.remove());
    if ('resizeWithoutConstraints' in c && (Math.abs(c.width - w) > .01 || Math.abs(c.height - h) > .01)) c.resizeWithoutConstraints(w, h);
    const cb = c.absoluteBoundingBox, rb = c.absoluteRenderBounds;
    if (!rb || rb.width < 0.5) return null;
    const out = { src: b64(await c.exportAsync(EXPORT)), x: ab.x + (rb.x - cb.x), y: ab.y + (rb.y - cb.y), w: rb.width, h: rb.height };
    return out;
  } finally { try { c.remove(); } catch (e) {} }
}
// 원본 형식 그대로 담는다 (JPEG·GIF·WEBP 도 있다)
function b64(bytes) {
  const t = bytes[0] === 0xFF && bytes[1] === 0xD8 ? 'jpeg' : bytes[0] === 0x47 && bytes[1] === 0x49 ? 'gif' : bytes[0] === 0x52 && bytes[8] === 0x57 ? 'webp' : 'png';
  return 'data:image/' + t + ';base64,' + figma.base64Encode(bytes);
}

figma.ui.onmessage = async msg => {
  if (msg.type !== 'export') return;
  const sel = figma.currentPage.selection.filter(n => n.absoluteBoundingBox);
  if (!sel.length) { figma.ui.postMessage({ type: 'error', text: '내보낼 프레임을 먼저 선택해 주세요.' }); return; }
  imageHashes.clear(); rasterIds.clear(); bakeJobs.length = 0;
  const frames = sel.map(n => ser(n, true));
  figma.ui.postMessage({ type: 'progress', text: `프레임 ${frames.length}개 · 이미지 ${imageHashes.size}개 · 요소 그림 ${bakeJobs.length}개 담는 중…` });
  const imageFills = {}, rasters = {};
  for (const h of imageHashes) {
    try { const im = figma.getImageByHash(h); if (im) imageFills[h] = b64(await im.getBytesAsync()); } catch (e) {}
  }
  const bakes = {}, errors = [];
  for (const [i, job] of bakeJobs.entries()) {
    try {
      const b = await bake(job);
      if (b && b.empty) { /* 크기 0 */ }
      else if (b) { bakes[job.node.id] = b; if (job.mode === 'full' && rasterIds.has(job.node.id)) rasters[job.node.id] = b.src; }
      else if (job.mode === 'full') errors.push(`${job.node.name}: 그림을 받지 못함`);
    }
    catch (e) { errors.push(`${job.node.name}: ${e && e.message || e}`); }
    if (i % 20 === 19) figma.ui.postMessage({ type: 'progress', text: `요소 그림 ${i + 1}/${bakeJobs.length}…` });
  }
  figma.ui.postMessage({ type: 'done', data: { kind: 'figma-export', version: 2, file: figma.root.name, frames, imageFills, rasters, bakes, errors } });
};
