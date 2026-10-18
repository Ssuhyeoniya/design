/* UI 컴포넌트 키트 — 피그마의 컴포넌트처럼 만든 UI(버튼·배지·말풍선 등)를 저장해 두고
 * 블로그 이미지 제작·배너 스튜디오 어디서든 '복사'로 꺼내 쓴다.
 *
 *   저장소   브라우저 IndexedDB 'ui_components' · store 'components' (같은 출처라 세 화면이 함께 쓴다)
 *   형식     { id, name, ts, w, h, thumb(dataURL), origin('blog'|'banner'), nodes:[...] }
 *   노드     앱과 무관한 중립 형식 — 두 앱의 레이어 구조가 달라 저장할 때 한 번, 꺼낼 때 한 번 변환한다.
 *     box    { t:'box', x,y,w,h, fill, radius, stroke, strokeW, opacity, rot,
 *              label:{ text,size,weight,family,color,lh,ls,rich }, pad:{ x, y|null } | null }
 *            label + pad 가 있으면 '오토 레이아웃' — 글자 길이에 패딩을 더해 도형 크기가 정해진다.
 *            pad.y 가 null 이면 높이는 고정, 폭만 늘고 준다.
 *     text   { t:'text', x,y,w,h, text,size,weight,family,color,align,lh,ls,rich }
 *     image  { t:'image', x,y,w,h, src, opacity, radius }
 *     raw    { t:'raw' } — 다른 앱에 대응 요소가 없는 것(스포트라이트·화살표 등). 같은 앱에서만 다시 넣는다.
 *   native  각 노드에는 원래 앱의 레이어 사본(native)을 같이 둔다 — 같은 앱으로 넣을 땐 서식이 그대로 살아난다.
 *   모든 좌표는 컴포넌트 왼쪽 위(0,0) 기준.  자간(ls)은 두 앱 모두 em 단위.
 */
(function () {
  'use strict';
  const DB = 'ui_components', STORE = 'components';

  // ── 저장소 ──────────────────────────────────────────────────────────────
  function db() {
    return new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('이 브라우저에서는 IndexedDB 를 쓸 수 없습니다'));
      const q = indexedDB.open(DB, 1);
      q.onupgradeneeded = () => {
        if (!q.result.objectStoreNames.contains(STORE)) q.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      };
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
      q.onblocked = () => rej(new Error('UI 컴포넌트 저장소를 다른 탭에서 사용 중입니다. 다른 탭을 닫고 새로고침하세요.'));
    });
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(STORE, mode), r = fn(t.objectStore(STORE));
      t.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('저장 중단 (용량 부족일 수 있습니다)'));
    });
  }
  const list = () => tx('readonly', os => os.getAll()).then(a => a.sort((x, y) => y.ts - x.ts));
  const get = id => tx('readonly', os => os.get(id));
  const put = c => tx('readwrite', os => os.put(c));
  const del = id => tx('readwrite', os => os.delete(id));
  async function rename(id, name) {
    const c = await get(id); if (!c) return;
    c.name = name; await put(c);
  }
  // 그룹(폴더) — 컴포넌트의 group 문자열. 빈 문자열 = '그룹 없음'
  async function setGroup(ids, group) {
    for (const id of [].concat(ids)) { const c = await get(id); if (c) { c.group = group || ''; await put(c); } }
  }
  async function renameGroup(from, to) {
    for (const c of await list()) if ((c.group || '') === from) { c.group = to || ''; await put(c); }
  }
  async function groups() {
    const g = new Map();
    for (const c of await list()) g.set(c.group || '', (g.get(c.group || '') || 0) + 1);
    return [...g.entries()].sort((a, b) => a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0], 'ko')).map(([name, count]) => ({ name, count }));
  }

  // ── 글자 측정 ────────────────────────────────────────────────────────────
  const mctx = document.createElement('canvas').getContext('2d');
  const FAMILY = { Pretendard: 'Pretendard, sans-serif', SCDream: 'SCDream, Pretendard, sans-serif' };
  const cssFamily = f => FAMILY[f || 'Pretendard'] || f;
  const plain = t => String(t || '').replace(/\[\[|\]\]/g, '');
  const lines = t => plain(t).split('\n');
  // 눈에 보이는 글자 폭(마지막 글자 뒤 자간 제외)과 줄 높이 합
  function measure(st) {
    mctx.font = `${st.weight || 400} ${st.size}px ${cssFamily(st.family)}`;
    const ls = (st.ls || 0) * st.size, L = lines(st.text);
    const w = Math.max(0, ...L.map(s => s ? mctx.measureText(s).width + Math.max(0, [...s].length - 1) * ls : 0));
    return { w, h: L.length * st.size * (st.lh || 1.3), n: L.length };
  }
  // 오토 레이아웃 박스의 크기 — 글자 + 패딩
  function fit(n) {
    if (n.t !== 'box' || !n.label || !n.pad) return n;
    const m = measure(n.label);
    n.w = Math.round(Math.max(m.w + n.pad.x * 2, n.label.size * 1.2));
    if (n.pad.y != null) n.h = Math.round(m.h + n.pad.y * 2);
    return n;
  }

  // ── 공통 정리 ────────────────────────────────────────────────────────────
  const clone = o => JSON.parse(JSON.stringify(o));
  // 도형 안에 들어 있는 텍스트를 도형의 '라벨'로 묶고 지금 여백을 패딩으로 잡는다 (= 오토 레이아웃 켜기)
  function autoNest(nodes) {
    const used = new Set();
    for (const b of nodes) {
      if (b.t !== 'box' || b.label || b.noNest) continue;
      const inside = x => { const cx = x.cx != null ? x.cx : x.x + x.w / 2, cy = x.cy != null ? x.cy : x.y + x.h / 2;
        return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h; };
      const t = nodes.find(x => x.t === 'text' && !used.has(x) && x.text && x.text.trim() && inside(x) && x.gw <= b.w + 2);
      if (!t) continue;
      // 카드처럼 안에 다른 요소(이미지·다른 글자·작은 도형)도 있으면 버튼이 아니라 배경이다 — 묶지 않는다
      if (nodes.some(x => x !== b && x !== t && inside(x) && !(x.w >= b.w && x.h >= b.h))) continue;
      used.add(t);
      const m = measure(t);
      b.label = { text: t.text, size: t.size, weight: t.weight, family: t.family, color: t.color, lh: t.lh, ls: t.ls, rich: t.rich || null, shadows: t.shadows, native: t.native };
      b.pad = { x: Math.max(0, Math.round((b.w - m.w) / 2)), y: Math.max(0, Math.round((b.h - m.h) / 2)) };
    }
    return nodes.filter(n => !used.has(n));
  }
  // 왼쪽 위를 (0,0) 으로 옮기고 크기를 잰다
  function normalize(nodes) {
    const x0 = Math.min(...nodes.map(n => n.x)), y0 = Math.min(...nodes.map(n => n.y));
    nodes.forEach(n => { n.x = Math.round(n.x - x0); n.y = Math.round(n.y - y0); delete n.cx; delete n.cy; delete n.gw; if (n.clip) { n.clip.x -= x0; n.clip.y -= y0; } });
    const w = Math.max(...nodes.map(n => n.x + n.w)), h = Math.max(...nodes.map(n => n.y + n.h));
    return { nodes, w: Math.round(w), h: Math.round(h) };
  }
  // 캔버스보다 크면 통째로 줄여 넣는다
  function scaled(comp, k) {
    const nodes = clone(comp.nodes);
    if (k === 1) return nodes;
    const sc = st => { if (!st) return; st.size = Math.max(6, Math.round(st.size * k)); };
    for (const n of nodes) {
      for (const p of ['x', 'y', 'w', 'h', 'radius', 'strokeW']) if (n[p] != null) n[p] = Math.round(n[p] * k);
      if (n.t === 'text') sc(n);
      if (n.label) sc(n.label);
      if (n.pad) { n.pad.x = Math.round(n.pad.x * k); if (n.pad.y != null) n.pad.y = Math.round(n.pad.y * k); }
      scaleFx(n.fx, k); scaleSh(n.shadows, k); if (n.label) scaleSh(n.label.shadows, k);
    }
    return nodes;
  }
  function scaleSh(sh, k) { (sh || []).forEach(e => { e.x *= k; e.y *= k; e.blur *= k; }); }
  function scaleFx(fx, k) {
    if (!fx) return;
    if (fx.radii) fx.radii = fx.radii.map(v => v * k);
    if (fx.stroke) fx.stroke.width *= k;
    (fx.effects || []).forEach(e => { if (e.x != null) { e.x *= k; e.y *= k; } e.blur *= k; if (e.spread) e.spread *= k; });
    (fx.fills || []).forEach(p => { if (p.type === 'IMAGE' && p.scaleMode === 'TILE') p.scale = (p.scale || 1) * k; });
  }
  function placeScale(comp, W, H) { return Math.min(1, (W * 0.9) / comp.w, (H * 0.9) / comp.h); }

  // ── 블로그 이미지 제작 ⇄ 중립 ───────────────────────────────────────────
  // 블로그 레이어: t(텍스트) · i(이미지, h = w/ar) · r(도형) · f(스포트라이트)
  //   텍스트에 fitBox 가 있으면 그 도형이 글자에 맞춰 늘고 준다 (fitPad · fitPadY)
  function fromBlog(layers) {
    const ids = new Set(layers.map(l => l.id)), nodes = [], label = new Map();
    for (const l of layers) if (l.type === 't' && l.fitBox && ids.has(l.fitBox)) label.set(l.fitBox, l);
    const fam = l => l.font || 'Pretendard';
    for (const l of layers) {
      const native = { app: 'blog', layer: clone(l) };
      if (l.type === 'r' && l.shape !== 'arrow') {
        const n = { t: 'box', x: l.x, y: l.y, w: l.w, h: l.h, fill: l.fill, radius: l.radius || 0,
          stroke: l.stroke || null, strokeW: l.strokeW || 0, rot: l.rot || 0, native, noNest: !!l.guide, fx: l.fx ? clone(l.fx) : undefined };
        const t = label.get(l.id);
        if (t) {
          n.label = { text: t.text, size: t.size, weight: t.weight, family: fam(t), color: t.color, lh: t.lh, ls: t.ls, rich: t.rich || null, shadows: t.shadows, native: { app: 'blog', layer: clone(t) } };
          n.pad = { x: t.fitPad != null ? t.fitPad : Math.round(t.size * 0.45), y: t.fitPadY != null ? t.fitPadY : null };
        }
        nodes.push(n);
      } else if (l.type === 't') {
        if (l.fitBox && ids.has(l.fitBox)) continue;
        const st = { text: l.text, size: l.size, weight: l.weight, family: fam(l), ls: l.ls, lh: l.lh };
        const m = measure(st);
        const off = l.align === 'center' ? (l.w - m.w) / 2 : l.align === 'right' ? l.w - m.w : 0;
        nodes.push({ t: 'text', x: l.x, y: l.y, w: l.w, h: Math.round(m.h), ...st, color: l.color, align: l.align || 'left',
          rich: l.rich || null, shadows: l.shadows, native, cx: l.x + off + m.w / 2, cy: l.y + m.h / 2, gw: m.w });
      } else if (l.type === 'i') {
        nodes.push({ t: 'image', x: l.x, y: l.y, w: l.w, h: Math.round(l.w / (l.ar || 1)), src: l.src, opacity: 1, radius: 0, native });
      } else {
        const b = l.type === 'f' ? { w: Math.max(l.w, l.topW || 0), h: l.h } : { w: l.w, h: l.h };
        nodes.push({ t: 'raw', x: l.x, y: l.y, w: b.w, h: b.h, native });
      }
    }
    return { ...normalize(autoNest(nodes)), origin: 'blog' };
  }
  // mk = { nid, tLayer, iLayer, rLayer } — 블로그 페이지의 레이어 생성기
  function toBlog(comp, at, k, mk) {
    const out = [], skipped = [];
    const base = (n, extra) => n.native && n.native.app === 'blog' ? Object.assign(clone(n.native.layer), extra) : extra;
    const font = f => (!f || f === 'Pretendard' || f === 'SCDream') ? '' : f;
    for (const n of scaled(comp, k)) {
      const x = at.x + n.x, y = at.y + n.y;
      if (n.t === 'box') {
        const r = mk.rLayer(base(n, { x, y, w: n.w, h: n.h, fill: n.fill, radius: n.radius }));
        if (n.stroke) { r.stroke = n.stroke; r.strokeW = n.strokeW || 3; }
        if (n.rot) r.rot = n.rot;
        if (n.fx) { r.fx = n.fx; delete r.stroke; delete r.shadow; } else delete r.fx;
        if (n.opacity != null && n.opacity < 1) r.opacity = n.opacity;
        delete r.gid; r.id = mk.nid();
        out.push(r);
        if (n.label) {
          const L = n.label, nb = L.native && L.native.app === 'blog' ? clone(L.native.layer) : {};
          const t = mk.tLayer(Object.assign(nb, { text: L.text, size: L.size, weight: L.weight || 700, color: L.color, lh: L.lh || 1.3, ls: L.ls || 0,
            font: font(L.family), x, y, w: n.w, align: 'center' }));
          if (L.rich) t.rich = L.rich; else delete t.rich;
          if (L.shadows && L.shadows.length) t.shadows = L.shadows; else delete t.shadows;
          delete t.gid; t.id = mk.nid();
          if (n.pad) { t.fitBox = r.id; t.fitPad = n.pad.x; t.fitPadY = n.pad.y; t.fitAll = true; delete t.fitDy; }
          else { delete t.fitBox; t.y = Math.round(y + (n.h - measure(t).h) / 2); }
          out.push(t);
        }
      } else if (n.t === 'text') {
        const t = mk.tLayer(base(n, { text: n.text, size: n.size, weight: n.weight || 400, color: n.color, align: n.align, lh: n.lh || 1.3, ls: n.ls || 0,
          font: font(n.family), x, y, w: n.w }));
        if (n.rich) t.rich = n.rich;
        if (n.shadows && n.shadows.length) t.shadows = n.shadows; else delete t.shadows;
        if (n.opacity != null && n.opacity < 1) t.opacity = n.opacity;
        delete t.fitBox; delete t.gid; t.id = mk.nid();
        out.push(t);
      } else if (n.t === 'image') {
        const i = mk.iLayer(base(n, { src: n.src, x, y, w: n.w, ar: n.w / Math.max(1, n.h) }));
        delete i.gid; i.id = mk.nid();
        out.push(i);
      } else if (n.native && n.native.app === 'blog') {
        const l = clone(n.native.layer);
        Object.assign(l, { id: mk.nid(), x, y }); delete l.gid;
        if (k !== 1) for (const p of ['w', 'h', 'topW']) if (l[p] != null) l[p] = Math.round(l[p] * k);
        out.push(l);
      } else skipped.push(n);
    }
    return { layers: out, skipped: skipped.length };
  }

  // ── 배너 스튜디오 ⇄ 중립 ────────────────────────────────────────────────
  // 배너 레이어: text · image · rect (rect 는 글자를 직접 담는다. auto = { padX, padY } 면 오토 레이아웃)
  //   서체는 이름 문자열 — 'Pretendard Bold', 'S-core Dream 6Bold'
  const PRE = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
  const SCD = { 100: '1Thin', 200: '2ExtraLight', 300: '3Light', 400: '4Regular', 500: '5Medium', 600: '6Bold', 700: '7ExtraBold', 800: '8Heavy', 900: '9Black' };
  const PRE_W = Object.fromEntries(Object.entries(PRE).map(([w, n]) => [n, +w]));
  function parseFont(name) {
    const s = String(name || '');
    let m = s.match(/S-?core\s*Dream\s*(\d)/i);
    if (m) return { family: 'SCDream', weight: +m[1] * 100 };
    m = s.match(/Pretendard[-\s]*([A-Za-z]+)?/i);
    return { family: 'Pretendard', weight: (m && PRE_W[m[1]]) || 400 };
  }
  function fontName(family, weight) {
    const w = Math.min(900, Math.max(100, Math.round((weight || 400) / 100) * 100));
    return family === 'SCDream' ? 'S-core Dream ' + SCD[w] : 'Pretendard ' + PRE[w];
  }
  // tm(l) = 배너 페이지의 textMetrics (줄바꿈까지 반영한 실제 렌더 정보)
  function fromBanner(layers, tm) {
    const nodes = [];
    for (const l of layers) {
      const native = { app: 'banner', layer: clone(l) };
      if (l.kind === 'rect') {
        const n = { t: 'box', x: l.x, y: l.y, w: l.w, h: l.h, fill: l.fill, radius: l.radius || 0, opacity: l.opacity == null ? 1 : l.opacity, native, fx: l.fx ? clone(l.fx) : undefined };
        if (l.text && l.text.trim()) {
          const f = parseFont(l.font);
          n.label = { text: l.text, size: l.size, weight: f.weight, family: f.family, color: l.color, lh: l.lh, ls: l.ls, shadows: l.shadows };
          n.pad = l.auto ? { x: l.auto.padX, y: l.auto.padY } : null;
        }
        nodes.push(n);
      } else if (l.kind === 'text') {
        const f = parseFont(l.font), m = tm(l);
        nodes.push({ t: 'text', x: l.x, y: l.y, w: l.w, h: Math.round(Math.max(m.h, l.size)), text: l.text, size: l.size,
          weight: f.weight, family: f.family, color: l.color, align: l.align, lh: l.lh, ls: l.ls, shadows: l.shadows, opacity: l.opacity, native,
          cx: m.left + m.maxW / 2, cy: l.y + m.h / 2, gw: m.maxW });
      } else if (l.kind === 'image') {
        nodes.push({ t: 'image', x: l.x, y: l.y, w: l.w, h: l.h, src: l.src, opacity: l.opacity == null ? 1 : l.opacity, radius: l.radius || 0, native });
      }
    }
    return { ...normalize(autoNest(nodes)), origin: 'banner' };
  }
  function toBanner(comp, at, k, uid) {
    const out = [], skipped = [];
    const base = (n, extra) => {
      const b = n.native && n.native.app === 'banner' ? clone(n.native.layer) : {};
      for (const p of ['lockX', 'lockSize', 'homeY', 'zone', 'slot', 'gid']) delete b[p];
      if (b.role === 'bi' || b.role === 'button' || b.role === 'buttonText' || b.role === 'main' || b.role === 'sub' || b.role === 'logo') b.role = 'free';
      return Object.assign(b, extra, { id: uid() });
    };
    for (const n of scaled(comp, k)) {
      const x = at.x + n.x, y = at.y + n.y;
      if (n.t === 'box') {
        const L = n.label;
        const r = base(n, { kind: 'rect', role: 'shape', name: n.name || (L ? L.text.split('\n')[0].slice(0, 16) : '도형'),
          x, y, w: n.w, h: n.h, fill: n.fill || '#ffffff', radius: n.radius || 0, opacity: n.opacity == null ? 1 : n.opacity });
        if (L) Object.assign(r, { text: L.text.replace(/\[\[|\]\]/g, ''), size: L.size, lh: L.lh || 1.3, ls: L.ls || 0, color: L.color, align: 'center', font: fontName(L.family, L.weight) });
        else Object.assign(r, { text: '', size: r.size || 40, lh: 1.3, ls: -0.02, color: '#111111', align: 'center', font: r.font || 'Pretendard SemiBold' });
        if (L && n.pad) r.auto = { padX: n.pad.x, padY: n.pad.y }; else delete r.auto;
        if (n.fx) r.fx = n.fx; else delete r.fx;
        if (L && L.shadows && L.shadows.length) r.shadows = L.shadows; else delete r.shadows;
        out.push(r);
      } else if (n.t === 'text') {
        out.push(base(n, { kind: 'text', role: 'free', name: (n.text || '텍스트').split('\n')[0].slice(0, 20), x, y, w: n.w,
          text: String(n.text || '').replace(/\[\[|\]\]/g, ''), size: n.size, lh: n.lh || 1.3, ls: n.ls || 0, color: n.color, align: n.align || 'left',
          font: fontName(n.family, n.weight), shadows: n.shadows && n.shadows.length ? n.shadows : undefined, opacity: n.opacity == null ? 1 : n.opacity }));
      } else if (n.t === 'image') {
        out.push(base(n, { kind: 'image', role: 'object', name: '이미지', x, y, w: n.w, h: n.h, src: n.src, opacity: n.opacity == null ? 1 : n.opacity, radius: n.radius || 0 }));
      } else skipped.push(n);
    }
    return { layers: out, skipped: skipped.length };
  }

  // ── 효과 페인터 ─────────────────────────────────────────────────────────
  // 도형(box)을 피그마와 같은 순서로 그린다:  드롭 섀도 → 배경 블러 → 채우기(여러 겹) → 이너 섀도 → 테두리,  레이어 블러는 전체에.
  //   b    = { x,y,w,h, radius, fill, opacity, fx }
  //   fx   = { shape:'rect'|'ellipse', radii:[tl,tr,br,bl], fills:[paint], stroke:{color,width,align}, effects:[effect] }
  //   paint  SOLID { color }  ·  GRADIENT_LINEAR|RADIAL|ANGULAR|DIAMOND { handles:[{x,y}×3](0~1), stops:[{pos,color}] }
  //          IMAGE { src, scaleMode:'FILL'|'FIT'|'TILE'|'CROP', scale, crop:{x,y,w,h}(0~1) }   — 모두 opacity·visible 선택
  //   effect DROP_SHADOW|INNER_SHADOW { x,y,blur,spread,color,behind }  ·  LAYER_BLUR|BACKGROUND_BLUR { blur }
  //   o    = { k: 현재 캔버스 배율(그림자·블러는 장치 픽셀 단위라 곱해 준다), backdrop: 배경 블러용 캔버스 }
  // 색은 'rgba()' 문자열.  블러 값은 피그마·CSS 와 같은 '반경'(= 캔버스 shadowBlur).
  const FAR = 20000;                 // 그림자만 남기려고 도형을 화면 밖으로 보내는 거리
  const imgs = new Map();            // src → HTMLImageElement (로드 완료 시 onImage 콜백으로 다시 그리게 한다)
  let onImage = null;
  function img(src) {
    if (!src) return null;
    let im = imgs.get(src);
    if (!im) {
      im = new Image(); im.crossOrigin = 'anonymous'; imgs.set(src, im);
      im.onload = () => { if (onImage) onImage(src); };
      im.src = src;
    }
    return im.complete && im.naturalWidth ? im : null;
  }
  const radiiOf = b => (b.fx && b.fx.radii) || [b.radius || 0, b.radius || 0, b.radius || 0, b.radius || 0];
  // ins > 0 = 안쪽으로 줄이기, < 0 = 바깥으로 키우기 (스프레드)
  function shapePath(c, b, x, y, w, h, ins) {
    ins = ins || 0;
    x += ins; y += ins; w -= ins * 2; h -= ins * 2;
    if (w <= 0 || h <= 0) return;
    if (b.fx && b.fx.shape === 'ellipse') { c.moveTo(x + w, y + h / 2); c.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); return; }
    const r = radiiOf(b).map(v => v > 0 ? Math.max(0, Math.min(v - ins, w / 2, h / 2)) : 0);
    c.moveTo(x + r[0], y);
    c.arcTo(x + w, y, x + w, y + h, r[1]); c.arcTo(x + w, y + h, x, y + h, r[2]);
    c.arcTo(x, y + h, x, y, r[3]); c.arcTo(x, y, x + w, y, r[0]); c.closePath();
  }
  function paintStyle(c, p, b) {
    const { x, y, w, h } = b, hs = p.handles || [{ x: 0, y: .5 }, { x: 1, y: .5 }, { x: 0, y: 1 }];
    const P = i => ({ x: x + hs[i].x * w, y: y + hs[i].y * h });
    const add = g => { (p.stops || []).forEach(s => g.addColorStop(Math.max(0, Math.min(1, s.pos)), s.color)); return g; };
    if (p.type === 'GRADIENT_LINEAR') { const a = P(0), z = P(1); return { style: add(c.createLinearGradient(a.x, a.y, z.x, z.y)) }; }
    if (p.type === 'GRADIENT_ANGULAR' && c.createConicGradient) {
      const a = P(0), z = P(1);
      return { style: add(c.createConicGradient(Math.atan2(z.y - a.y, z.x - a.x), a.x, a.y)) };
    }
    if (p.type === 'GRADIENT_RADIAL' || p.type === 'GRADIENT_DIAMOND' || p.type === 'GRADIENT_ANGULAR') {
      const a = P(0), z = P(1), v = P(2);
      const rx = Math.max(.5, Math.hypot(z.x - a.x, z.y - a.y)), ry = Math.max(.5, Math.hypot(v.x - a.x, v.y - a.y));
      return { style: add(c.createRadialGradient(0, 0, 0, 0, 0, rx)), tf: [a.x, a.y, Math.atan2(z.y - a.y, z.x - a.x), ry / rx] };
    }
    return { style: p.color || '#000' };
  }
  // 이미지 채우기 — 피그마의 채우기(FILL) · 맞추기(FIT) · 자르기(CROP) · 바둑판(TILE)
  function drawImageFill(c, p, b) {
    const im = img(p.src); if (!im) return;
    const { x, y, w, h } = b, iw = im.naturalWidth, ih = im.naturalHeight;
    const mode = p.scaleMode || 'FILL';
    if (mode === 'TILE') {
      const s = p.scale || 1, tw = iw * s, th = ih * s;
      for (let ty = y; ty < y + h; ty += th) for (let tx = x; tx < x + w; tx += tw) c.drawImage(im, tx, ty, tw, th);
      return;
    }
    if (mode === 'CROP' && p.crop) {
      const cr = p.crop;
      c.drawImage(im, cr.x * iw, cr.y * ih, cr.w * iw, cr.h * ih, x, y, w, h); return;
    }
    const k = mode === 'FIT' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
    const dw = iw * k, dh = ih * k;
    c.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  function fillsOf(b) {
    if (b.fx && b.fx.fills) return b.fx.fills.filter(p => p.visible !== false);
    return b.fill ? [{ type: 'SOLID', color: b.fill }] : [];
  }
  function paintBox(c, b, o) {
    o = o || {};
    const k = o.k || 1, fx = b.fx || {};
    const eff = (fx.effects || []).filter(e => e.visible !== false);
    const blur = eff.find(e => e.type === 'LAYER_BLUR');
    if (blur && !o.noLayerBlur) {                      // 레이어 블러 — 따로 그린 뒤 흐리게 얹는다
      const off = document.createElement('canvas'); off.width = c.canvas.width; off.height = c.canvas.height;
      const oc = off.getContext('2d'); oc.setTransform(c.getTransform());
      paintBox(oc, b, Object.assign({}, o, { noLayerBlur: true }));
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.filter = `blur(${(blur.blur / 2) * k}px)`; c.drawImage(off, 0, 0); c.restore();
      return;
    }
    const { x, y, w, h } = b;
    const path = ins => { c.beginPath(); shapePath(c, b, x, y, w, h, ins); };
    const outside = () => { c.beginPath(); c.rect(x - FAR / 2, y - FAR / 2, w + FAR, h + FAR); shapePath(c, b, x, y, w, h, 0); c.clip('evenodd'); };
    c.save();
    c.globalAlpha *= b.opacity == null ? 1 : b.opacity;
    // 1) 드롭 섀도 — 기본은 도형 뒤로 비치지 않는다 (피그마 '투명 영역 뒤 그림자 표시' 꺼짐)
    for (const e of eff.filter(e => e.type === 'DROP_SHADOW')) {
      c.save();
      if (!e.behind) outside();
      c.shadowColor = e.color; c.shadowBlur = e.blur * k;
      c.shadowOffsetX = (e.x + FAR) * k; c.shadowOffsetY = e.y * k;
      c.translate(-FAR, 0); path(-(e.spread || 0)); c.fillStyle = '#000'; c.fill();
      c.restore();
    }
    // 2) 배경 블러 — 아래에 깔린 그림을 도형 모양으로 흐리게
    const bb = eff.find(e => e.type === 'BACKGROUND_BLUR');
    if (bb && o.backdrop) {
      c.save(); path(0); c.clip();
      c.setTransform(1, 0, 0, 1, 0, 0); c.filter = `blur(${(bb.blur / 2) * k}px)`; c.drawImage(o.backdrop, 0, 0);
      c.restore();
    }
    // 3) 채우기 — 아래 겹부터
    for (const p of fillsOf(b)) {
      c.save(); c.globalAlpha *= p.opacity == null ? 1 : p.opacity;
      path(0);
      if (p.type === 'IMAGE') { c.clip(); drawImageFill(c, p, b); }
      else {
        const s = paintStyle(c, p, b);
        c.fillStyle = s.style;
        if (s.tf) { c.translate(s.tf[0], s.tf[1]); c.rotate(s.tf[2]); c.scale(1, s.tf[3]); }
        c.fill();
      }
      c.restore();
    }
    // 4) 이너 섀도
    for (const e of eff.filter(e => e.type === 'INNER_SHADOW')) {
      c.save(); path(0); c.clip();
      c.shadowColor = e.color; c.shadowBlur = e.blur * k;
      c.shadowOffsetX = (e.x + FAR) * k; c.shadowOffsetY = e.y * k;
      c.translate(-FAR, 0);
      const m = e.blur + Math.abs(e.x) + Math.abs(e.y) + Math.abs(e.spread || 0) + 50;
      c.beginPath(); c.rect(x - m, y - m, w + m * 2, h + m * 2); shapePath(c, b, x, y, w, h, e.spread || 0);
      c.fillStyle = '#000'; c.fill('evenodd');
      c.restore();
    }
    // 5) 테두리 — 안쪽(기본)·바깥쪽·가운데
    const st = fx.stroke || (b.stroke ? { color: b.stroke, width: b.strokeW || 3, align: 'INSIDE' } : null);
    if (st && st.width > 0) {
      c.save();
      if (st.align === 'OUTSIDE') outside(); else if (st.align !== 'CENTER') { path(0); c.clip(); }
      c.lineWidth = st.align === 'CENTER' ? st.width : st.width * 2;
      c.strokeStyle = st.color; path(0); c.stroke();
      c.restore();
    }
    c.restore();
  }
  // 효과가 도형 밖으로 번지는 여백
  function outset(b) {
    const fx = b.fx || {}; let m = 0;
    for (const e of (fx.effects || [])) {
      if (e.visible === false) continue;
      if (e.type === 'DROP_SHADOW') m = Math.max(m, Math.max(Math.abs(e.x), Math.abs(e.y)) + e.blur + Math.max(0, e.spread || 0));
      if (e.type === 'LAYER_BLUR') m = Math.max(m, e.blur * 1.5);
    }
    if (fx.stroke && fx.stroke.align !== 'INSIDE') m = Math.max(m, fx.stroke.width);
    return Math.ceil(m + 2);
  }
  // DOM 으로 그리는 화면(블로그 이미지 제작)용 — 도형을 PNG 로 구워 <img> 로 얹는다. 배경 블러는 화면 쪽 CSS 가 맡는다
  const urlCache = new Map();
  function paintURL(b, scale) {
    scale = scale || 2;
    const key = JSON.stringify([b.w, b.h, b.radius, b.fill, b.opacity, b.fx, scale]);
    const hit = urlCache.get(key); if (hit) return hit;
    const m = outset(b), cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round((b.w + m * 2) * scale)); cv.height = Math.max(1, Math.round((b.h + m * 2) * scale));
    const c = cv.getContext('2d'); c.scale(scale, scale);
    paintBox(c, Object.assign({}, b, { x: m, y: m }), { k: scale });
    const pending = fillsOf(b).some(p => p.type === 'IMAGE' && !img(p.src));
    const out = { url: cv.toDataURL('image/png'), m };
    if (!pending) { if (urlCache.size > 300) urlCache.clear(); urlCache.set(key, out); }
    return out;
  }
  const hasFx = b => !!(b && b.fx && ((b.fx.effects && b.fx.effects.length) || (b.fx.fills && b.fx.fills.some(p => p.type !== 'SOLID' || p.opacity != null && p.opacity < 1)) ||
    (b.fx.fills && b.fx.fills.length > 1) || b.fx.stroke || b.fx.radii || b.fx.shape === 'ellipse'));
  const textShadowCSS = sh => (sh || []).map(s => `${s.x}px ${s.y}px ${s.blur}px ${s.color}`).join(',');

  // ── 썸네일 ──────────────────────────────────────────────────────────────
  const loadImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  function rr(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    c.beginPath(); c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function drawLines(c, st, x, y, w, align) {
    c.font = `${st.weight || 400} ${st.size}px ${cssFamily(st.family)}`;
    try { c.letterSpacing = ((st.ls || 0) * st.size).toFixed(2) + 'px'; } catch (e) { /* 미지원 브라우저 */ }
    c.fillStyle = st.color || '#111'; c.textBaseline = 'middle';
    c.textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
    const ax = align === 'center' ? x + w / 2 : align === 'right' ? x + w : x, L = st.size * (st.lh || 1.3);
    const draw = () => lines(st.text).forEach((s, i) => c.fillText(s, ax, y + i * L + L / 2));
    for (const s of (st.shadows || [])) {             // 글자 그림자 — 겹마다 한 번씩
      c.save(); c.shadowColor = s.color; c.shadowBlur = s.blur * (c.getTransform().a || 1);
      c.shadowOffsetX = s.x * (c.getTransform().a || 1); c.shadowOffsetY = s.y * (c.getTransform().d || 1); draw(); c.restore();
    }
    draw();
  }
  async function thumb(comp, max) {
    max = max || 360;
    // 이미지 채우기는 미리 받아 둔다 (썸네일은 한 번만 그린다)
    await Promise.all(comp.nodes.flatMap(n => (n.fx && n.fx.fills || []).filter(p => p.type === 'IMAGE'))
      .map(p => new Promise(res => { const im = img(p.src); if (im) return res(); const i = imgs.get(p.src); i.addEventListener('load', res); i.addEventListener('error', res); })));
    const m = Math.max(0, ...comp.nodes.map(n => n.t === 'box' ? outset(n) : 0));
    const k = Math.min(1, max / Math.max(comp.w + m * 2, comp.h + m * 2, 1)), pad = 8 + Math.round(m * k);
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(comp.w * k) + pad * 2); cv.height = Math.max(1, Math.round(comp.h * k) + pad * 2);
    const c = cv.getContext('2d');
    c.translate(pad, pad); c.scale(k, k);
    for (const n of comp.nodes) {
      c.save(); c.globalAlpha = n.opacity == null ? 1 : n.opacity;
      if (n.t === 'box') {
        paintBox(c, n, { k });
        if (n.label) { const mm = measure(n.label); drawLines(c, n.label, n.x, n.y + (n.h - mm.h) / 2, n.w, 'center'); }
      } else if (n.t === 'text') drawLines(c, n, n.x, n.y, n.w, n.align);
      else if (n.t === 'image') {
        const im = await loadImg(n.src);
        if (im) { if (n.radius) { rr(c, n.x, n.y, n.w, n.h, n.radius); c.clip(); } c.drawImage(im, n.x, n.y, n.w, n.h); }
      } else if (n.t === 'raw') {
        c.setLineDash([6, 4]); c.strokeStyle = '#9aa1ab'; c.lineWidth = 2; c.strokeRect(n.x, n.y, n.w, n.h);
      }
      c.restore();
    }
    return cv.toDataURL('image/png');
  }

  // ── 피그마 → 중립 ───────────────────────────────────────────────────────
  // 피그마 REST API(GET /v1/files/:key/nodes) 의 노드 트리를 편집 가능한 노드로 바꾼다.
  //   텍스트 → text,  사각형·프레임·컴포넌트·원 → box (채우기·테두리·효과·모서리 그대로),
  //   오토 레이아웃 프레임에 텍스트 하나만 있으면 → 라벨 + 패딩(Hug) = 오토 레이아웃 박스,
  //   이미지 채우기 → box 의 IMAGE 채우기 (imageFills: imageRef → 주소),
  //   벡터·아이콘·회전·마스크처럼 직접 그릴 수 없는 것 → 피그마가 렌더한 PNG (rasters: nodeId → 주소)
  const VECTORISH = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE', 'REGULAR_POLYGON', 'POLYGON', 'ARROW']);
  const CONTAINER = new Set(['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION', 'RECTANGLE', 'ELLIPSE']);
  const frgba = (c, op) => {
    const a = +((c.a == null ? 1 : c.a) * (op == null ? 1 : op)).toFixed(3);
    const h = v => Math.round(v * 255).toString(16).padStart(2, '0');
    return a >= 1 ? '#' + h(c.r) + h(c.g) + h(c.b) : `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
  };
  const visible = n => n.visible !== false;
  const hasText = n => n.type === 'TEXT' || (n.children || []).some(c => visible(c) && hasText(c));
  const rotated = n => { const t = n.relativeTransform; return !!(t && (Math.abs(t[0][1]) > 1e-3 || Math.abs(t[1][0]) > 1e-3)) || !!(n.rotation && Math.abs(n.rotation) > .01); };
  function figPaint(p, imageFills) {
    if (!visible(p)) return null;
    const op = p.opacity == null ? 1 : p.opacity;
    if (p.type === 'SOLID') return { type: 'SOLID', color: frgba(p.color, op) };
    if (/^GRADIENT_/.test(p.type)) return { type: p.type, handles: (p.gradientHandlePositions || []).map(h => ({ x: h.x, y: h.y })),
      stops: (p.gradientStops || []).map(s => ({ pos: s.position, color: frgba(s.color, op) })) };
    if (p.type === 'IMAGE') {
      const src = imageFills && imageFills[p.imageRef]; if (!src) return null;
      const o = { type: 'IMAGE', src, scaleMode: p.scaleMode || 'FILL', opacity: op < 1 ? op : undefined };
      if (p.scalingFactor) o.scale = p.scalingFactor;
      if (p.scaleMode === 'CROP' && p.imageTransform) {               // [[sx,0,tx],[0,sy,ty]] — 보이는 부분(0~1)
        const t = p.imageTransform; o.crop = { x: t[0][2], y: t[1][2], w: t[0][0], h: t[1][1] };
      }
      return o;
    }
    return null;
  }
  function figEffects(n) {
    return (n.effects || []).filter(visible).map(e => {
      if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') return { type: e.type, x: (e.offset || {}).x || 0, y: (e.offset || {}).y || 0,
        blur: e.radius || 0, spread: e.spread || 0, color: frgba(e.color || { r: 0, g: 0, b: 0, a: .25 }), behind: !!e.showShadowBehindNode };
      if (e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') return { type: e.type, blur: e.radius || 0 };
      return null;
    }).filter(Boolean);
  }
  const FIG_FONTS = [[/pretendard/i, 'Pretendard'], [/s-?core\s*dream|scdream|에스코어/i, 'SCDream'], [/noto sans (kr|korean)|본고딕/i, "'Noto Sans KR',sans-serif"],
    [/nanum\s*gothic|나눔고딕/i, "'Nanum Gothic',sans-serif"], [/nanum\s*myeongjo|나눔명조/i, "'Nanum Myeongjo',serif"], [/gowun\s*dodum/i, "'Gowun Dodum',sans-serif"],
    [/gowun\s*batang/i, "'Gowun Batang',serif"], [/jua/i, "'Jua',sans-serif"], [/do\s*hyeon/i, "'Do Hyeon',sans-serif"], [/black\s*han\s*sans/i, "'Black Han Sans',sans-serif"]];
  function figFont(fam, warn) {
    for (const [re, v] of FIG_FONTS) if (re.test(fam || '')) return v;
    if (fam) warn(`서체 '${fam}' 은(는) 없어서 프리텐다드로 바꿨습니다`);
    return 'Pretendard';
  }
  function fromFigma(root, opts) {
    opts = opts || {};
    const rasters = opts.rasters || {}, imageFills = opts.imageFills || {}, warns = new Set();
    const warn = m => warns.add(m);
    const ox = root.absoluteBoundingBox.x, oy = root.absoluteBoundingBox.y;
    const nodes = [];
    // 프레임의 '내용 자르기(Clip content)' — 넘친 부분은 피그마처럼 잘라야 한다
    let clip = null;
    const inter = (a, c) => { const x = Math.max(a.x, c.x), y = Math.max(a.y, c.y), x2 = Math.min(a.x + a.w, c.x + c.w), y2 = Math.min(a.y + a.h, c.y + c.h);
      return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null; };
    function push(node) {
      if (clip) {
        const r = { x: node.x, y: node.y, w: node.w, h: node.h }, i = inter(r, clip);
        if (!i) return;                                                // 완전히 잘려 안 보이는 것
        const inside = i.w >= r.w - .5 && i.h >= r.h - .5;
        if (!inside) {
          const imgFill = node.fx && (node.fx.fills || []).some(p => p.type === 'IMAGE');
          if (node.t === 'image' || (node.t === 'box' && imgFill && !node.label)) node.clip = { ...clip };   // 그림은 나중에 픽셀로 자른다 (applyClips)
          else if (node.t === 'box' && !node.label) Object.assign(node, i);                                // 단색·그라데이션 도형은 크기만 줄인다
          else warn(`'${node.name}' 일부가 프레임 밖으로 넘쳐 보일 수 있습니다`);
        }
      }
      nodes.push(node);
    }
    const bb = n => { const b = n.absoluteBoundingBox || { x: 0, y: 0, width: 0, height: 0 }; return { x: b.x - ox, y: b.y - oy, w: b.width, h: b.height }; };
    const raster = (n, op) => {
      const src = rasters[n.id];
      if (!src) { warn(`'${n.name}' 을(를) 그림으로 받지 못해 빠졌습니다`); return; }
      const r = n.absoluteRenderBounds || n.absoluteBoundingBox;
      push({ t: 'image', x: r.x - ox, y: r.y - oy, w: r.width, h: r.height, src, opacity: 1, radius: 0, name: n.name, fromFigma: n.id });
    };
    const textNode = (n, op) => {
      const st = n.style || {}, b = bb(n);
      const fill = (n.fills || []).filter(visible)[0];
      const size = st.fontSize || 16;
      let text = n.characters || '';
      if (st.textCase === 'UPPER') text = text.toUpperCase(); else if (st.textCase === 'LOWER') text = text.toLowerCase();
      if (n.characterStyleOverrides && n.characterStyleOverrides.some(Boolean)) warn(`'${n.name}' 의 글자별 서식(일부 색·굵기)은 첫 서식으로 통일했습니다`);
      const t = { t: 'text', x: b.x, y: b.y, w: b.w, text, size, weight: st.fontWeight || 400, family: figFont(st.fontFamily, warn),
        color: fill && fill.type === 'SOLID' ? frgba(fill.color, (fill.opacity == null ? 1 : fill.opacity)) : '#000000',
        align: { CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'left' }[st.textAlignHorizontal] || 'left',
        lh: st.lineHeightPx ? +(st.lineHeightPx / size).toFixed(3) : 1.3, ls: st.letterSpacing ? +(st.letterSpacing / size).toFixed(4) : 0,
        opacity: op, name: n.name };
      const sh = figEffects(n).filter(e => e.type === 'DROP_SHADOW').map(e => ({ x: e.x, y: e.y, blur: e.blur, color: e.color }));
      if (sh.length) t.shadows = sh;
      if (fill && fill.type !== 'SOLID') warn(`'${n.name}' 글자의 그라데이션·이미지 채우기는 단색으로 바꿨습니다`);
      const m = measure(t);
      // 피그마에서 한 줄(또는 자동 폭)이던 글자는 브라우저 글꼴이 조금만 넓어도 줄바꿈된다 — 폭에 여유를 주고 정렬 기준점은 지킨다
      const L1 = st.lineHeightPx || size * 1.3, oneLine = b.h < L1 * (text.split('\n').length + 0.5);
      if (n.textAutoResize === 'WIDTH_AND_HEIGHT' || oneLine) {
        const need = Math.ceil(m.w * 1.06 + size * 0.3);
        if (need > t.w) { const d = need - t.w; if (t.align === 'center') t.x -= d / 2; else if (t.align === 'right') t.x -= d; t.w = need; }
      }
      t.h = Math.round(m.h);
      if (st.textAlignVertical === 'CENTER') t.y += (b.h - m.h) / 2; else if (st.textAlignVertical === 'BOTTOM') t.y += b.h - m.h;
      const off = t.align === 'center' ? (t.w - m.w) / 2 : t.align === 'right' ? t.w - m.w : 0;
      Object.assign(t, { cx: t.x + off + m.w / 2, cy: t.y + m.h / 2, gw: m.w });
      return t;
    };
    function walk(n, op) {
      if (!visible(n)) return;
      op = (op == null ? 1 : op) * (n.opacity == null ? 1 : n.opacity);
      const kids = (n.children || []).filter(visible);
      // 그릴 수 없는 것 → 피그마가 렌더한 그림. 글자가 들어 있으면 글자를 살리려고 그림으로 굽지 않는다
      const imgFill = (n.fills || []).some(p => visible(p) && p.type === 'IMAGE');
      const oddPaint = [...(n.fills || []), ...(n.strokes || [])].some(p => visible(p) && !/^(SOLID|IMAGE|GRADIENT_(LINEAR|RADIAL|ANGULAR|DIAMOND))$/.test(p.type));
      const mask = kids.some(c => c.isMask);
      const partialArc = n.type === 'ELLIPSE' && n.arcData && (Math.abs(n.arcData.endingAngle - n.arcData.startingAngle) < 6.28 || n.arcData.innerRadius > 0);
      const blend = n.blendMode && !/^(PASS_THROUGH|NORMAL)$/.test(n.blendMode);
      if (VECTORISH.has(n.type) || !CONTAINER.has(n.type) && n.type !== 'TEXT' || partialArc || oddPaint || mask || blend || (rotated(n) && n !== root)) {
        if (n.type === 'TEXT') { if (rotated(n)) warn(`'${n.name}' 글자의 회전은 빼고 가져왔습니다`); push(textNode(n, op)); return; }
        if (!hasText(n)) return raster(n, op);
        warn(`'${n.name}' 은(는) 그대로 그릴 수 없는 요소(회전·마스크·혼합 모드)가 있어 근사치로 가져왔습니다`);
      }
      if (n.type === 'TEXT') { push(textNode(n, op)); return; }
      const b = bb(n);
      const fills = (n.fills || []).map(p => figPaint(p, imageFills)).filter(Boolean);
      if (imgFill && fills.every(p => p.type !== 'IMAGE')) {
        if (!hasText(n) && !kids.length) return raster(n, op);
        warn(`'${n.name}' 의 이미지 채우기를 받지 못했습니다`);
      }
      const sp = (n.strokes || []).filter(visible).map(p => figPaint(p, imageFills)).filter(p => p && p.type === 'SOLID')[0];
      const effects = figEffects(n);
      if (n.type !== 'GROUP' && (fills.length || sp || effects.length || n.layoutMode && n.layoutMode !== 'NONE')) {
        const fx = { fills };
        if (n.type === 'ELLIPSE') fx.shape = 'ellipse';
        if (n.rectangleCornerRadii) fx.radii = n.rectangleCornerRadii.slice();
        if (sp && (n.strokeWeight || 0) > 0) fx.stroke = { color: sp.color, width: n.strokeWeight, align: n.strokeAlign || 'INSIDE' };
        if (effects.length) fx.effects = effects;
        const solid = fills.find(p => p.type === 'SOLID');
        const box = { t: 'box', x: b.x, y: b.y, w: b.w, h: b.h, fill: solid ? solid.color : 'transparent', radius: n.cornerRadius || 0,
          opacity: op, fx, name: n.name, noNest: true };
        // 오토 레이아웃 — 텍스트 하나만 담은 프레임은 글자 + 패딩으로 크기가 정해지는 박스가 된다
        const texts = kids.filter(c => c.type === 'TEXT');
        if (n.layoutMode && n.layoutMode !== 'NONE' && texts.length === 1 && kids.length === 1 && !rotated(texts[0])) {
          const H = n.layoutMode === 'HORIZONTAL';
          const hugX = n.layoutSizingHorizontal ? n.layoutSizingHorizontal === 'HUG' : (H ? n.primaryAxisSizingMode : n.counterAxisSizingMode) === 'AUTO';
          const hugY = n.layoutSizingVertical ? n.layoutSizingVertical === 'HUG' : (H ? n.counterAxisSizingMode : n.primaryAxisSizingMode) === 'AUTO';
          const t = textNode(texts[0], op);
          box.label = { text: t.text, size: t.size, weight: t.weight, family: t.family, color: t.color, lh: t.lh, ls: t.ls, shadows: t.shadows };
          const pl = n.paddingLeft || 0, pr = n.paddingRight || 0, pt = n.paddingTop || 0, pb = n.paddingBottom || 0;
          if (hugX) box.pad = { x: Math.round((pl + pr) / 2), y: hugY ? Math.round((pt + pb) / 2) : null };
          if (pl !== pr || (hugY && pt !== pb)) warn(`'${n.name}' 의 좌우·상하 패딩이 달라 평균값으로 맞췄습니다`);
          if (t.align !== 'center' && (!hugX || n.primaryAxisAlignItems !== 'CENTER' && n.counterAxisAlignItems !== 'CENTER'))
            if (!hugX) warn(`'${n.name}' 의 글자 정렬을 가운데로 맞췄습니다`);
          push(box); return;
        }
        if (n.layoutMode && n.layoutMode !== 'NONE' && texts.length && kids.length > 1)
          warn(`'${n.name}' 은(는) 글자 외 요소가 함께 있어, 글자를 고쳐도 도형 크기가 자동으로 바뀌지 않습니다`);
        push(box);
      }
      const prev = clip;
      if (n.clipsContent) {
        const c = clip ? inter(b, clip) : b;
        clip = c ? { ...c, r: clip && clip.r != null && !n.cornerRadius ? clip.r : (n.rectangleCornerRadii || [n.cornerRadius || 0, n.cornerRadius || 0, n.cornerRadius || 0, n.cornerRadius || 0]) } : { x: 0, y: 0, w: 0, h: 0 };
      }
      kids.forEach(c => walk(c, op));
      clip = prev;
    }
    walk(root, 1);
    if (!nodes.length) throw new Error('가져올 수 있는 요소가 없습니다');
    // 루트 기준 좌표 → 정규화 (효과는 도형 밖으로 번져도 좌표에는 넣지 않는다)
    const res = normalize(nodes);
    return { ...res, origin: 'figma', warnings: [...warns] };
  }
  // 잘라내기(clip)가 남은 그림·이미지 채우기 도형을 실제 픽셀로 잘라 PNG 로 바꾼다 (모서리 둥근 프레임도 반영)
  async function applyClips(conv) {
    let n = 0;
    for (const node of conv.nodes) {
      if (!node.clip) continue;
      const c = node.clip, i = (() => { const x = Math.max(node.x, c.x), y = Math.max(node.y, c.y), x2 = Math.min(node.x + node.w, c.x + c.w), y2 = Math.min(node.y + node.h, c.y + c.h); return { x, y, w: x2 - x, h: y2 - y }; })();
      const S = 2, cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(i.w * S)); cv.height = Math.max(1, Math.round(i.h * S));
      const g = cv.getContext('2d'); g.scale(S, S); g.translate(-i.x, -i.y);
      g.beginPath(); shapePath(g, { fx: { radii: c.r || [0, 0, 0, 0] } }, c.x, c.y, c.w, c.h, 0); g.clip();
      if (node.t === 'image') {
        const im = await loadImg(node.src); if (!im) { delete node.clip; continue; }
        g.drawImage(im, node.x, node.y, node.w, node.h);
      } else {
        await Promise.all((node.fx.fills || []).filter(p => p.type === 'IMAGE').map(p => loadImg(p.src).then(im => { if (im) imgs.set(p.src, im); })));
        paintBox(g, node, { k: S });
      }
      let src; try { src = cv.toDataURL('image/png'); } catch (e) { delete node.clip; continue; }   // 다른 출처 주소(만료 대비 미변환)면 자르지 않는다
      Object.assign(node, { t: 'image', x: i.x, y: i.y, w: i.w, h: i.h, src, opacity: 1, radius: 0 });
      delete node.clip; delete node.fx; delete node.fill; n++;
    }
    if (n) Object.assign(conv, normalize(conv.nodes));
    return conv;
  }
  // 피그마에서 따로 받아야 할 것 — PNG 로 렌더할 노드 id, 이미지 채우기 ref
  function figmaNeeds(root) {
    const rasters = [], refs = new Set();
    (function walk(n) {
      if (!visible(n)) return;
      (n.fills || []).forEach(p => { if (visible(p) && p.type === 'IMAGE' && p.imageRef) refs.add(p.imageRef); });
      const kids = (n.children || []).filter(visible);
      const oddPaint = [...(n.fills || []), ...(n.strokes || [])].some(p => visible(p) && !/^(SOLID|IMAGE|GRADIENT_(LINEAR|RADIAL|ANGULAR|DIAMOND))$/.test(p.type));
      const partialArc = n.type === 'ELLIPSE' && n.arcData && (Math.abs(n.arcData.endingAngle - n.arcData.startingAngle) < 6.28 || n.arcData.innerRadius > 0);
      const blend = n.blendMode && !/^(PASS_THROUGH|NORMAL)$/.test(n.blendMode);
      const odd = VECTORISH.has(n.type) || !CONTAINER.has(n.type) && n.type !== 'TEXT' || partialArc || oddPaint || kids.some(c => c.isMask) || blend || (rotated(n) && n !== root);
      if (odd && n.type !== 'TEXT' && !hasText(n)) { rasters.push(n.id); return; }
      kids.forEach(walk);
    })(root);
    return { rasters, imageRefs: [...refs] };
  }
  // 피그마 링크 → { fileKey, nodeId }
  function parseFigmaLink(u) {
    const m = String(u || '').match(/figma\.com\/(?:design|file|proto|board)\/([A-Za-z0-9]+)/);
    if (!m) return null;
    const q = String(u).match(/[?&]node-id=([0-9]+)[-:%3A]+([0-9]+)/i);
    return { fileKey: m[1], nodeId: q ? q[1] + ':' + q[2] : null };
  }

  // 저장: 레이어 묶음을 중립 형식으로 바꿔 썸네일과 함께 넣는다
  async function save(name, conv, group) {
    if (!conv.nodes.length) throw new Error('저장할 요소가 없습니다');
    const comp = { name, ts: Date.now(), w: conv.w, h: conv.h, origin: conv.origin, nodes: conv.nodes, group: group || '' };
    if (conv.warnings && conv.warnings.length) comp.warnings = conv.warnings;
    if (conv.source) comp.source = conv.source;
    comp.thumb = await thumb(comp);
    comp.id = await put(comp);
    return comp;
  }
  // 다른 PC·팀원과 나눌 때 쓰는 JSON 내보내기/가져오기
  function exportJSON(items) {
    return JSON.stringify({ kind: 'ui-components', version: 1, items: items.map(c => { const o = clone(c); delete o.id; return o; }) }, null, 1);
  }
  async function importJSON(text) {
    const d = JSON.parse(text);
    const items = Array.isArray(d) ? d : d && d.kind === 'ui-components' ? d.items : null;
    if (!items) throw new Error('UI 컴포넌트 파일이 아닙니다');
    let n = 0;
    for (const c of items) {
      if (!c || !Array.isArray(c.nodes)) continue;
      const o = clone(c); delete o.id; o.ts = Date.now() + n;
      if (!o.thumb) o.thumb = await thumb(o);
      await put(o); n++;
    }
    return n;
  }

  window.UIKit = { list, get, put, del, rename, setGroup, renameGroup, groups, save, thumb, measure, fit, fromBlog, toBlog, fromBanner, toBanner, placeScale,
    exportJSON, importJSON, parseFont, fontName, fromFigma, figmaNeeds, parseFigmaLink, applyClips,
    paintBox, paintURL, outset, hasFx, textShadowCSS, img, set onImage(fn) { onImage = fn; } };
})();
