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
    c.name = name; c.ts = Date.now(); await put(c);
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
      const t = nodes.find(x => x.t === 'text' && !used.has(x) && x.text && x.text.trim() &&
        x.cx >= b.x && x.cx <= b.x + b.w && x.cy >= b.y && x.cy <= b.y + b.h && x.gw <= b.w + 2);
      if (!t) continue;
      used.add(t);
      const m = measure(t);
      b.label = { text: t.text, size: t.size, weight: t.weight, family: t.family, color: t.color, lh: t.lh, ls: t.ls, rich: t.rich || null, native: t.native };
      b.pad = { x: Math.max(0, Math.round((b.w - m.w) / 2)), y: Math.max(0, Math.round((b.h - m.h) / 2)) };
    }
    return nodes.filter(n => !used.has(n));
  }
  // 왼쪽 위를 (0,0) 으로 옮기고 크기를 잰다
  function normalize(nodes) {
    const x0 = Math.min(...nodes.map(n => n.x)), y0 = Math.min(...nodes.map(n => n.y));
    nodes.forEach(n => { n.x = Math.round(n.x - x0); n.y = Math.round(n.y - y0); delete n.cx; delete n.cy; delete n.gw; });
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
    }
    return nodes;
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
          stroke: l.stroke || null, strokeW: l.strokeW || 0, rot: l.rot || 0, native, noNest: !!l.guide };
        const t = label.get(l.id);
        if (t) {
          n.label = { text: t.text, size: t.size, weight: t.weight, family: fam(t), color: t.color, lh: t.lh, ls: t.ls, rich: t.rich || null, native: { app: 'blog', layer: clone(t) } };
          n.pad = { x: t.fitPad != null ? t.fitPad : Math.round(t.size * 0.45), y: t.fitPadY != null ? t.fitPadY : null };
        }
        nodes.push(n);
      } else if (l.type === 't') {
        if (l.fitBox && ids.has(l.fitBox)) continue;
        const st = { text: l.text, size: l.size, weight: l.weight, family: fam(l), ls: l.ls, lh: l.lh };
        const m = measure(st);
        const off = l.align === 'center' ? (l.w - m.w) / 2 : l.align === 'right' ? l.w - m.w : 0;
        nodes.push({ t: 'text', x: l.x, y: l.y, w: l.w, h: Math.round(m.h), ...st, color: l.color, align: l.align || 'left',
          rich: l.rich || null, native, cx: l.x + off + m.w / 2, cy: l.y + m.h / 2, gw: m.w });
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
        delete r.gid; r.id = mk.nid();
        out.push(r);
        if (n.label) {
          const L = n.label, nb = L.native && L.native.app === 'blog' ? clone(L.native.layer) : {};
          const t = mk.tLayer(Object.assign(nb, { text: L.text, size: L.size, weight: L.weight || 700, color: L.color, lh: L.lh || 1.3, ls: L.ls || 0,
            font: font(L.family), x, y, w: n.w, align: 'center' }));
          if (L.rich) t.rich = L.rich; else delete t.rich;
          delete t.gid; t.id = mk.nid();
          if (n.pad) { t.fitBox = r.id; t.fitPad = n.pad.x; t.fitPadY = n.pad.y; t.fitAll = true; delete t.fitDy; }
          else { delete t.fitBox; t.y = Math.round(y + (n.h - measure(t).h) / 2); }
          out.push(t);
        }
      } else if (n.t === 'text') {
        const t = mk.tLayer(base(n, { text: n.text, size: n.size, weight: n.weight || 400, color: n.color, align: n.align, lh: n.lh || 1.3, ls: n.ls || 0,
          font: font(n.family), x, y, w: n.w }));
        if (n.rich) t.rich = n.rich;
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
        const n = { t: 'box', x: l.x, y: l.y, w: l.w, h: l.h, fill: l.fill, radius: l.radius || 0, opacity: l.opacity == null ? 1 : l.opacity, native };
        if (l.text && l.text.trim()) {
          const f = parseFont(l.font);
          n.label = { text: l.text, size: l.size, weight: f.weight, family: f.family, color: l.color, lh: l.lh, ls: l.ls };
          n.pad = l.auto ? { x: l.auto.padX, y: l.auto.padY } : null;
        }
        nodes.push(n);
      } else if (l.kind === 'text') {
        const f = parseFont(l.font), m = tm(l);
        nodes.push({ t: 'text', x: l.x, y: l.y, w: l.w, h: Math.round(Math.max(m.h, l.size)), text: l.text, size: l.size,
          weight: f.weight, family: f.family, color: l.color, align: l.align, lh: l.lh, ls: l.ls, native,
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
        out.push(r);
      } else if (n.t === 'text') {
        out.push(base(n, { kind: 'text', role: 'free', name: (n.text || '텍스트').split('\n')[0].slice(0, 20), x, y, w: n.w,
          text: String(n.text || '').replace(/\[\[|\]\]/g, ''), size: n.size, lh: n.lh || 1.3, ls: n.ls || 0, color: n.color, align: n.align || 'left',
          font: fontName(n.family, n.weight) }));
      } else if (n.t === 'image') {
        out.push(base(n, { kind: 'image', role: 'object', name: '이미지', x, y, w: n.w, h: n.h, src: n.src, opacity: n.opacity == null ? 1 : n.opacity, radius: n.radius || 0 }));
      } else skipped.push(n);
    }
    return { layers: out, skipped: skipped.length };
  }

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
    lines(st.text).forEach((s, i) => c.fillText(s, ax, y + i * L + L / 2));
  }
  async function thumb(comp, max) {
    max = max || 360;
    const k = Math.min(1, max / Math.max(comp.w, comp.h, 1)), pad = 8;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(comp.w * k) + pad * 2); cv.height = Math.max(1, Math.round(comp.h * k) + pad * 2);
    const c = cv.getContext('2d');
    c.translate(pad, pad); c.scale(k, k);
    for (const n of comp.nodes) {
      c.save(); c.globalAlpha = n.opacity == null ? 1 : n.opacity;
      if (n.t === 'box') {
        rr(c, n.x, n.y, n.w, n.h, n.radius); c.fillStyle = n.fill || '#fff'; c.fill();
        if (n.stroke) { c.lineWidth = n.strokeW || 3; c.strokeStyle = n.stroke; c.stroke(); }
        if (n.label) { const m = measure(n.label); drawLines(c, n.label, n.x, n.y + (n.h - m.h) / 2, n.w, 'center'); }
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

  // 저장: 레이어 묶음을 중립 형식으로 바꿔 썸네일과 함께 넣는다
  async function save(name, conv) {
    if (!conv.nodes.length) throw new Error('저장할 요소가 없습니다');
    const comp = { name, ts: Date.now(), w: conv.w, h: conv.h, origin: conv.origin, nodes: conv.nodes };
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

  window.UIKit = { list, get, put, del, rename, save, thumb, measure, fit, fromBlog, toBlog, fromBanner, toBanner, placeScale, exportJSON, importJSON, parseFont, fontName };
})();
