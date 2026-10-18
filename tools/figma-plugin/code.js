/* 이미지 스튜디오로 내보내기 — 피그마 플러그인
 * 선택한 프레임을 피그마 REST API(GET /v1/files/:key/nodes)와 같은 모양의 JSON 으로 바꾸고,
 * 이미지 채우기 원본과 직접 그릴 수 없는 요소(벡터·아이콘)의 PNG 를 함께 담아 파일 하나로 내보낸다.
 * 이미지 소스(library.html) → 🧩 UI 컴포넌트 → 🎨 피그마에서 가져오기 → '플러그인 파일' 로 넣으면 된다.
 * REST API 를 쓰지 않으므로 요청 한도·토큰이 필요 없다.
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
  if (odd && n.type !== 'TEXT' && !hasText(n)) { rasterIds.add(n.id); return o; }
  if ('children' in n) o.children = n.children.map(c => ser(c, false));
  return o;
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
  imageHashes.clear(); rasterIds.clear();
  const frames = sel.map(n => ser(n, true));
  figma.ui.postMessage({ type: 'progress', text: `프레임 ${frames.length}개 · 이미지 ${imageHashes.size}개 · 그림 ${rasterIds.size}개 담는 중…` });
  const imageFills = {}, rasters = {};
  for (const h of imageHashes) {
    try { const im = figma.getImageByHash(h); if (im) imageFills[h] = b64(await im.getBytesAsync()); } catch (e) {}
  }
  for (const id of rasterIds) {
    try { const n = await figma.getNodeByIdAsync(id); if (n) rasters[id] = b64(await n.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } })); } catch (e) {}
  }
  figma.ui.postMessage({ type: 'done', data: { kind: 'figma-export', version: 1, file: figma.root.name, frames, imageFills, rasters } });
};
