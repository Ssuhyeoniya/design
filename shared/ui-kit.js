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
  // ── 글꼴 ──
  // 프리텐다드·에스코어드림은 각 화면이 이미 갖고 있고, 나머지 무료 글꼴은 저장소 fonts/ 에 있다 (tools/fonts-build.py).
  // 글꼴마다 fonts/<slug>/font.css 가 따로 있어서, 실제로 쓰는 글꼴의 CSS 만 그때 불러온다 (ensureFont).
  const FONT_LIB = [
    ['SCDream', 's-core-dream', [100, 200, 300, 400, 500, 600, 700, 800, 900]],   // 배너 스튜디오 동봉본을 가리킨다
    ['Black Han Sans', 'black-han-sans', [400]],
    ['조선견고딕', 'chosun-bg', [400]],
    ['Do Hyeon', 'do-hyeon', [400]],
    ['Gmarket Sans', 'gmarket-sans', [500]],
    ['Gothic A1', 'gothic-a1', [100, 200, 300, 400, 500, 600, 700, 800, 900]],
    ['Gowun Batang', 'gowun-batang', [400, 700]],
    ['Gowun Dodum', 'gowun-dodum', [400]],
    ['IBM Plex Sans KR', 'ibm-plex-sans-kr', [100, 200, 300, 400, 500, 600, 700]],
    ['Inter', 'inter', [100, 200, 300, 400, 500, 600, 700, 800, 900]],
    ['Jalnan Gothic', 'jalnan-gothic', [400]],
    ['Jua', 'jua', [400]],
    ['Montserrat', 'montserrat', [100, 200, 300, 400, 500, 600, 700, 800, 900]],
    ['Nanum Gothic', 'nanum-gothic', [400, 700, 800]],
    ['Nanum Myeongjo', 'nanum-myeongjo', [400, 700, 800]],
    ['Nanum Pen Script', 'nanum-pen-script', [400]],
    ['NanumSquare Neo', 'nanum-square-neo', [300, 400, 700, 800, 900]],
    ['Noto Sans KR', 'noto-sans-kr', [100, 200, 300, 400, 500, 600, 700, 800, 900]],
    ['Poppins', 'poppins', [100, 200, 300, 400, 500, 600, 700, 800, 900]],
    ['Roboto', 'roboto', [100, 200, 300, 400, 500, 600, 700, 800, 900]],
    ['SUIT', 'suit', [100, 200, 300, 400, 500, 600, 700, 800, 900]],
    ['Song Myung', 'song-myung', [400]],
    ['Spoqa Han Sans Neo', 'spoqa-han-sans-neo', [100, 300, 400, 500, 700]],
    ['Wanted Sans', 'wanted-sans', [400, 500, 600, 700, 800, 900, 1000]]
  ];
  const SYSTEM_UI = '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Malgun Gothic", sans-serif';   // 피그마의 SF Pro(아이폰 화면) — 맥에서는 같은 글꼴
  const FONT_BASE = (() => { try { return new URL('../fonts/', document.currentScript.src).href; } catch (e) { return 'fonts/'; } })();
  const libOf = f => FONT_LIB.find(x => x[0] === f);
  const FAMILY = { Pretendard: 'Pretendard, sans-serif', SCDream: 'SCDream, Pretendard, sans-serif', System: SYSTEM_UI };
  const cssFamily = f => FAMILY[f || 'Pretendard'] || (libOf(f) ? `'${f}', Pretendard, sans-serif` : f);
  // CSS 글꼴 문자열("'Noto Sans KR',sans-serif") 에서 글꼴 이름만
  const familyOf = css => { const m = String(css || '').match(/^\s*['"]?([^'",]+)/); return m ? m[1].trim() : ''; };
  const linked = new Map();          // slug → Promise (CSS 로드)
  const fontDone = new Set();        // '글꼴|굵기' — 받아 둔 것
  let onFont = null;
  function ensureFont(family, weight) {
    const L = libOf(familyOf(family)); if (!L) return Promise.resolve(false);
    let p = linked.get(L[1]);
    if (!p) {
      p = new Promise(res => {
        const ln = document.createElement('link'); ln.rel = 'stylesheet'; ln.href = FONT_BASE + L[1] + '/font.css';
        ln.onload = () => res(true); ln.onerror = () => res(false); document.head.appendChild(ln);
      });
      linked.set(L[1], p);
    }
    const key = L[0] + '|' + (weight || 400);
    if (fontDone.has(key)) return Promise.resolve(true);
    return p.then(ok => ok && document.fonts ? document.fonts.load(`${weight || 400} 16px '${L[0]}'`, '가A').then(() => {
      if (!fontDone.has(key)) { fontDone.add(key); if (onFont) onFont(L[0]); }         // 처음 받았을 때 한 번만 다시 그리게 알린다
      return true;
    }) : ok);
  }
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

  // ── 피그마 그림(bake) ───────────────────────────────────────────────────
  // 피그마 플러그인이 요소마다 피그마가 직접 그린 PNG 를 함께 준다. 레이어에 { src, dx, dy, w, h, alpha, sig } 로 붙여 두고,
  // 레이어 값이 가져온 그대로(sig 가 같음)인 동안은 그 그림을 그대로 그린다 = 피그마와 100% 같다.
  // 글자·색·크기를 고치면 sig 가 달라져 그때부터 편집 가능한 레이어로 다시 그린다 (되돌리면 다시 그림으로).
  const SIG_KEYS = ['w', 'h', 'fill', 'radius', 'fx', 'stroke', 'strokeW', 'text', 'rich', 'size', 'weight', 'font', 'color', 'align', 'lh', 'ls', 'opacity', 'auto', 'tail', 'shape', 'rot', 'shadows', 'tfill'];
  const LABEL_KEYS = ['text', 'rich', 'size', 'weight', 'font', 'color', 'lh', 'ls', 'shadows', 'tfill'];
  // 오토 레이아웃 도형(배너 rect.auto · 블로그 'A:' 표시)은 폭·높이가 글자에서 정해지므로 비교에서 뺀다
  function bakeSig(l, extra, keys) {
    const o = {}, auto = !keys && (l.auto || String(extra || '').startsWith('A:'));
    for (const k of keys || SIG_KEYS) if (l[k] !== undefined && l[k] !== null && !(auto && (k === 'w' || k === 'h'))) o[k] = l[k];
    return JSON.stringify(o) + '|' + (extra || '');
  }
  const bakeOk = (l, extra, keys) => !!(l && l.bake && l.bake.sig === bakeSig(l, extra, keys));
  const labelSig = t => t ? bakeSig(t, '', LABEL_KEYS) : '';
  // 레이어에 그림을 붙인다 (n.bake 는 컴포넌트 좌표, 레이어 기준 상대 좌표로 바꿔 둔다)
  function attachBake(layer, nb, extra) {
    if (!nb) { delete layer.bake; return; }
    layer.bake = { src: nb.src, dx: nb.x - layer.x, dy: nb.y - layer.y, w: nb.w, h: nb.h, alpha: nb.alpha == null ? 1 : nb.alpha, lw: layer.w, lh: layer.h };
    layer.bake.sig = bakeSig(layer, extra);
  }
  const bakeOf = (l, extra) => l.bake && bakeOk(l, extra) ? { src: l.bake.src, x: l.x + l.bake.dx, y: l.y + l.bake.dy, w: l.bake.w, h: l.bake.h, alpha: l.bake.alpha } : undefined;

  // 한 줄 글자인가 — 피그마에서 온 표시(nowrap), 없으면(예전 저장본) 피그마 그림 높이가 한 줄인지로 본다
  const oneLineText = n => !!(n.nowrap || (n.bake && !String(n.text || '').includes('\n') && n.bake.h < (n.size || 16) * (n.lh || 1.3) * 1.6));
  // ── 그룹 계층 (피그마 레이어 패널처럼 그룹 안 그룹) ─────────────────────────
  // 레이어마다 gp = [바깥 그룹 id, …, 안쪽 그룹 id], gpn = 같은 순서의 그룹 이름. gid·gname 은 바깥 그룹(예전 코드 호환)
  const gpOf = l => l.gp && l.gp.length ? l.gp : l.gid != null ? [l.gid] : [];
  const gpnOf = l => { const g = gpOf(l); return g.map((_, i) => (l.gpn && l.gpn[i]) || (i === 0 && l.gname) || '그룹'); };
  function setGp(l, gp, gpn) {
    if (!gp || !gp.length) { delete l.gp; delete l.gpn; delete l.gid; delete l.gname; return; }
    l.gp = gp.slice(); l.gpn = gp.map((_, i) => (gpn && gpn[i]) || '그룹'); l.gid = l.gp[0]; l.gname = l.gpn[0];
  }
  // 저장본 노드 → { gp, gpn } (예전 저장본의 grp 한 단계도 읽는다)
  const nodeGp = n => n.gp && n.gp.length ? { gp: n.gp, gpn: n.gpn || [] } : n.grp ? { gp: [n.grp], gpn: [n.grpName] } : { gp: [], gpn: [] };
  // 요소가 하나뿐인 그룹은 계층에서 뺀다 (노드든 레이어든)
  function pruneGp(list, isLayer) {
    for (let pass = 0; pass < 8; pass++) {
      const cnt = {}; list.forEach(x => (isLayer ? gpOf(x) : x.gp || []).forEach(g => { cnt[g] = (cnt[g] || 0) + 1; }));
      let changed = false;
      list.forEach(x => {
        const g0 = isLayer ? gpOf(x) : x.gp || [], n0 = isLayer ? gpnOf(x) : x.gpn || [];
        const keep = g0.map((g, i) => cnt[g] >= 2 ? i : -1).filter(i => i >= 0);
        if (keep.length === g0.length) return;
        changed = true; const gp = keep.map(i => g0[i]), gpn = keep.map(i => n0[i]);
        if (isLayer) setGp(x, gp, gpn); else if (gp.length) { x.gp = gp; x.gpn = gpn; } else { delete x.gp; delete x.gpn; }
      });
      if (!changed) break;
    }
    return list;
  }
  // 레이어 패널 줄 — layers 는 뒤→앞 순서(그리는 순서). 반환은 앞→뒤(패널 위→아래)
  function layerRows(layers, collapsed) {
    const rows = [], open = [];
    for (const l of layers.slice().reverse()) {
      const gp = gpOf(l), gn = gpnOf(l);
      let k = 0; while (k < open.length && k < gp.length && open[k] === gp[k]) k++;
      open.length = k;
      for (let i = k; i < gp.length; i++) {
        const hidden = open.some(g => collapsed && collapsed.has(g));
        if (!hidden) rows.push({ g: gp[i], name: gn[i], depth: i, path: gp.slice(0, i + 1) });
        open.push(gp[i]);
      }
      if (!open.some(g => collapsed && collapsed.has(g))) rows.push({ l, depth: gp.length });
    }
    return rows;
  }
  const groupMembers = (layers, g) => layers.filter(l => gpOf(l).includes(g));
  // 끌어다 놓기 — dr = { ids, group(옮기는 그룹 id|null) }, target = { l } | { g, path }, mode = before|after|in. 새 배열을 돌려준다
  function moveInTree(layers, dr, target, mode) {
    const moving = layers.filter(x => dr.ids.includes(x.id));
    if (!moving.length) return null;
    if (target.l && dr.ids.includes(target.l.id)) return null;
    if (target.g != null && moving.some(x => gpOf(x).includes(target.g)) && dr.group != null && gpOf(moving[0]).indexOf(dr.group) <= gpOf(moving[0]).indexOf(target.g)) return null;
    const rest = layers.filter(x => !dr.ids.includes(x.id));
    let at, parent;                           // parent = 놓인 자리의 그룹 경로
    if (target.g != null) {
      const mem = rest.filter(x => gpOf(x).includes(target.g)); if (!mem.length) return null;
      const top = rest.indexOf(mem[mem.length - 1]), bottom = rest.indexOf(mem[0]);
      const path = gpOf(mem[0]).slice(0, gpOf(mem[0]).indexOf(target.g) + 1);
      if (mode === 'in') { at = top + 1; parent = path; } else { at = mode === 'before' ? top + 1 : bottom; parent = path.slice(0, -1); }
    } else {
      const ti = rest.indexOf(target.l); at = mode === 'before' ? ti + 1 : ti; parent = gpOf(target.l).slice();
    }
    const pn = (() => { const ref = rest.find(x => { const g = gpOf(x); return parent.every((p, i) => g[i] === p); }); return ref ? gpnOf(ref).slice(0, parent.length) : parent.map(() => '그룹'); })();
    for (const x of moving) {
      const g = gpOf(x), n = gpnOf(x);
      if (dr.group != null) { const i = g.indexOf(dr.group); setGp(x, parent.concat(g.slice(i)), pn.concat(n.slice(i))); }   // 그룹째 — 그 그룹부터 아래는 유지
      else setGp(x, parent, pn);
    }
    rest.splice(at, 0, ...moving);
    pruneGp(rest, true);
    return rest;
  }
  // Ctrl+G — 고른 레이어들의 공통 그룹 안에 새 그룹을 만든다
  function groupLayers(layers, ids, gid) {
    const sel = layers.filter(x => ids.includes(x.id)); if (sel.length < 2) return false;
    const paths = sel.map(gpOf); let k = 0;
    while (paths.every(p => p.length > k && p[k] === paths[0][k])) k++;
    sel.forEach(x => { const g = gpOf(x), n = gpnOf(x); setGp(x, g.slice(0, k).concat([gid], g.slice(k)), n.slice(0, k).concat(['그룹'], n.slice(k))); });
    // 그룹 레이어가 이어지게 — 가장 앞 레이어 자리로 모은다
    const top = Math.max(...sel.map(x => layers.indexOf(x)));
    const rest = layers.filter(x => !ids.includes(x.id)), at = rest.indexOf(layers.slice(0, top + 1).filter(x => !ids.includes(x.id)).pop()) + 1;
    rest.splice(at, 0, ...sel); layers.length = 0; layers.push(...rest);
    return true;
  }
  // Ctrl+Shift+G — 고른 것이 통째로 든 가장 안쪽 그룹을 푼다
  function ungroupLayers(layers, ids) {
    const sel = layers.filter(x => ids.includes(x.id)); if (!sel.length) return false;
    const g0 = gpOf(sel[0]); let target = null;
    for (let i = g0.length - 1; i >= 0; i--) { const g = g0[i]; if (groupMembers(layers, g).every(x => ids.includes(x.id)) && sel.every(x => gpOf(x).includes(g))) { target = g; } }
    // 고른 범위가 정확히 덮는 그룹 중 가장 바깥 = 패널에서 고른 그 그룹
    if (target == null) return false;
    groupMembers(layers, target).forEach(x => { const g = gpOf(x), n = gpnOf(x), i = g.indexOf(target); setGp(x, g.filter((_, j) => j !== i), n.filter((_, j) => j !== i)); });
    return true;
  }
  // 그룹 안으로 한 단계 — 지금 고른 묶음 안에서 l 을 품은 다음 단계 그룹(없으면 l 하나)
  function deeperSelection(layers, curIds, l) {
    const g = gpOf(l);
    for (let i = 0; i < g.length; i++) {
      const mem = groupMembers(layers, g[i]).map(x => x.id);
      const same = mem.length === curIds.length && mem.every(id => curIds.includes(id));
      if (same) return i + 1 < g.length ? groupMembers(layers, g[i + 1]).map(x => x.id) : [l.id];
    }
    return g.length ? groupMembers(layers, g[0]).map(x => x.id) : [l.id];
  }
  // 복사해 붙일 때 그룹 id 를 새로 (map: 옛 id → 새 id)
  function remapGp(l, map, mkid) { const g = gpOf(l); if (!g.length) return; setGp(l, g.map(x => map[x] || (map[x] = mkid())), gpnOf(l)); }
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
      b.label = { text: t.text, size: t.size, weight: t.weight, family: t.family, color: t.color, tfill: t.tfill, lh: t.lh, ls: t.ls, rich: t.rich || null, shadows: t.shadows, native: t.native };
      b.pad = { x: Math.max(0, Math.round((b.w - m.w) / 2)), y: Math.max(0, Math.round((b.h - m.h) / 2)) };
    }
    return nodes.filter(n => !used.has(n));
  }
  // 왼쪽 위를 (0,0) 으로 옮기고 크기를 잰다
  function normalize(nodes) {
    const x0 = Math.min(...nodes.map(n => n.x)), y0 = Math.min(...nodes.map(n => n.y));
    nodes.forEach(n => { n.x = Math.round(n.x - x0); n.y = Math.round(n.y - y0); delete n.cx; delete n.cy; delete n.gw; if (n.clip) { n.clip.x -= x0; n.clip.y -= y0; } if (n.bake) { n.bake.x -= x0; n.bake.y -= y0; } });
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
      if (n.bake) for (const p of ['x', 'y', 'w', 'h']) n.bake[p] *= k;
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
    const fam = l => { if (!l.font) return 'Pretendard'; const f = familyOf(l.font); return f === 'SCDream' || libOf(f) ? f : /apple-system/.test(l.font) ? 'System' : l.font; };
    for (const l of layers) {
      const from0 = nodes.length;
      const native = { app: 'blog', layer: clone(l) };
      if (l.type === 'r' && l.shape !== 'arrow') {
        const n = { t: 'box', x: l.x, y: l.y, w: l.w, h: l.h, fill: l.fill, radius: l.radius || 0,
          stroke: l.stroke || null, strokeW: l.strokeW || 0, rot: l.rot || 0, native, noNest: !!l.guide || !!l.bake, fx: l.fx ? clone(l.fx) : undefined };
        const t = label.get(l.id);
        n.bake = bakeOf(l, t ? 'A:' + labelSig(t) : '');
        if (t) {
          n.label = { text: t.text, size: t.size, weight: t.weight, family: fam(t), color: t.color, tfill: t.tfill, lh: t.lh, ls: t.ls, rich: t.rich || null, shadows: t.shadows, native: { app: 'blog', layer: clone(t) } };
          n.pad = { x: t.fitPad != null ? t.fitPad : Math.round(t.size * 0.45), y: t.fitPadY != null ? t.fitPadY : null };
        }
        nodes.push(n);
      } else if (l.type === 't') {
        if (l.fitBox && ids.has(l.fitBox)) continue;
        const st = { text: l.text, size: l.size, weight: l.weight, family: fam(l), ls: l.ls, lh: l.lh };
        const m = measure(st);
        const off = l.align === 'center' ? (l.w - m.w) / 2 : l.align === 'right' ? l.w - m.w : 0;
        nodes.push({ t: 'text', x: l.x, y: l.y, w: l.w, h: Math.round(m.h), ...st, color: l.color, align: l.align || 'left', tfill: l.tfill, nowrap: l.nowrap,
          rich: l.rich || null, shadows: l.shadows, native, bake: bakeOf(l, ''), cx: l.x + off + m.w / 2, cy: l.y + m.h / 2, gw: m.w });
      } else if (l.type === 'i') {
        nodes.push({ t: 'image', x: l.x, y: l.y, w: l.w, h: Math.round(l.w / (l.ar || 1)), src: l.src, opacity: 1, radius: 0, native, fromFigma: l.figPic ? 'pic' : undefined });
      } else {
        const b = l.type === 'f' ? { w: Math.max(l.w, l.topW || 0), h: l.h } : { w: l.w, h: l.h };
        nodes.push({ t: 'raw', x: l.x, y: l.y, w: b.w, h: b.h, native });
      }
      { const gp = gpOf(l); if (gp.length) { const gn = gpnOf(l); for (const x of nodes.slice(from0)) { x.gp = gp.map(g => 'g' + g); x.gpn = gn.slice(); } } }   // 그룹 계층 → 저장
    }
    return { ...normalize(autoNest(nodes)), origin: 'blog' };
  }
  // mk = { nid, tLayer, iLayer, rLayer } — 블로그 페이지의 레이어 생성기
  function toBlog(comp, at, k, mk) {
    const out = [], skipped = [];
    const base = (n, extra) => n.native && n.native.app === 'blog' ? Object.assign(clone(n.native.layer), extra) : (n.name ? Object.assign({ name: n.name }, extra) : extra);   // 피그마 레이어 이름 유지
    const font = f => (!f || f === 'Pretendard') ? '' : (f === 'System' || libOf(f)) ? cssFamily(f) : f;
    const gmap = {};                      // 피그마 그룹(n.grp) → 레이어 그룹(gid)
    const regroup = (from, n) => { const p = nodeGp(n); if (!p.gp.length) return; const gp = p.gp.map(g => gmap[g] || (gmap[g] = mk.nid())); for (const l of out.slice(from)) setGp(l, gp, p.gpn); };
    for (const n of scaled(comp, k)) {
      const from0 = out.length;
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
          if (L.tfill) t.tfill = clone(L.tfill); else delete t.tfill;
          delete t.gid; t.id = mk.nid();
          if (n.pad) { t.fitBox = r.id; t.fitPad = n.pad.x; t.fitPadY = n.pad.y; t.fitAll = true; delete t.fitDy; }
          else { delete t.fitBox; t.y = Math.round(y + (n.h - measure(t).h) / 2); }
          out.push(t);
          delete t.bake;
          attachBake(r, n.bake, (n.pad ? 'A:' : '') + labelSig(t));      // 버튼 그림에는 글자도 들어 있다 — 도형·글자 둘 다 그대로일 때만 그림으로
          if (r.bake) r.bake.label = t.id;
        } else attachBake(r, n.bake, '');
      } else if (n.t === 'text') {
        const t = mk.tLayer(base(n, { text: n.text, size: n.size, weight: n.weight || 400, color: n.color, align: n.align, lh: n.lh || 1.3, ls: n.ls || 0,
          font: font(n.family), x, y, w: n.w }));
        if (n.rich) t.rich = n.rich;
        if (n.tfill) t.tfill = clone(n.tfill); else delete t.tfill;
        if (oneLineText(n)) t.nowrap = true; else delete t.nowrap;
        if (n.shadows && n.shadows.length) t.shadows = n.shadows; else delete t.shadows;
        if (n.opacity != null && n.opacity < 1) t.opacity = n.opacity;
        delete t.fitBox; delete t.gid; t.id = mk.nid();
        attachBake(t, n.bake, '');
        out.push(t);
      } else if (n.t === 'image') {
        const i = mk.iLayer(base(n, { src: n.src, x, y, w: n.w, ar: n.w / Math.max(1, n.h) }));
        if (n.fromFigma) i.figPic = true;        // 피그마가 그린 요소 그림 — 자르기 모드 대상이 아니다
        delete i.gid; i.id = mk.nid();
        out.push(i);
      } else if (n.native && n.native.app === 'blog') {
        const l = clone(n.native.layer);
        Object.assign(l, { id: mk.nid(), x, y }); delete l.gid;
        if (k !== 1) for (const p of ['w', 'h', 'topW']) if (l[p] != null) l[p] = Math.round(l[p] * k);
        out.push(l);
      } else skipped.push(n);
      regroup(from0, n);
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
    // 무료 글꼴 모음 — '<글꼴 이름> <굵기 이름>' (예: 'Noto Sans KR Bold', 'SUIT ExtraBold', 'System Regular')
    for (const fam of ['System', ...FONT_LIB.map(x => x[0]).sort((a, b) => b.length - a.length)]) {
      if (s.toLowerCase().startsWith(fam.toLowerCase() + ' ') || s.toLowerCase() === fam.toLowerCase()) {
        const rest = s.slice(fam.length).trim(), n = +rest;
        return { family: fam, weight: n >= 100 ? n : (PRE_W[rest.replace(/\s+/g, '')] || 400) };
      }
    }
    m = s.match(/Pretendard[-\s]*([A-Za-z]+)?/i);
    return { family: 'Pretendard', weight: (m && PRE_W[m[1]]) || 400 };
  }
  function fontName(family, weight) {
    const w = Math.min(900, Math.max(100, Math.round((weight || 400) / 100) * 100));
    if (family === 'SCDream') return 'S-core Dream ' + SCD[w];
    const f = familyOf(family);
    if (f === 'System' || libOf(f)) return f + ' ' + PRE[w];
    return 'Pretendard ' + PRE[w];
  }
  // tm(l) = 배너 페이지의 textMetrics (줄바꿈까지 반영한 실제 렌더 정보)
  // frame = { w, h } 이면 좌표를 옮기지 않고 그 크기 그대로 (피그마 프레임 편집 — 캔버스 (0,0) = 프레임 왼쪽 위)
  function fromBanner(layers, tm, frame) {
    const nodes = [];
    for (const l of layers) {
      const from0 = nodes.length;
      const native = { app: 'banner', layer: clone(l) };
      if (l.kind === 'rect') {
        const n = { t: 'box', x: l.x, y: l.y, w: l.w, h: l.h, fill: l.fill, radius: l.radius || 0, opacity: l.opacity == null ? 1 : l.opacity, native, fx: l.fx ? clone(l.fx) : undefined, bake: bakeOf(l), noNest: !!l.bake };
        if (l.text && l.text.trim()) {
          const f = parseFont(l.font);
          n.label = { text: l.text, size: l.size, weight: f.weight, family: f.family, color: l.color, tfill: l.tfill, lh: l.lh, ls: l.ls, shadows: l.shadows };
          n.pad = l.auto ? { x: l.auto.padX, y: l.auto.padY } : null;
        }
        nodes.push(n);
      } else if (l.kind === 'text') {
        const f = parseFont(l.font), m = tm(l);
        nodes.push({ t: 'text', x: l.x, y: l.y, w: l.w, h: Math.round(Math.max(m.h, l.size)), text: l.text, size: l.size,
          weight: f.weight, family: f.family, color: l.color, tfill: l.tfill, nowrap: l.nowrap, align: l.align, lh: l.lh, ls: l.ls, shadows: l.shadows, opacity: l.opacity, native, bake: bakeOf(l),
          cx: m.left + m.maxW / 2, cy: l.y + m.h / 2, gw: m.maxW });
      } else if (l.kind === 'image' && l.crop && !l.flip && !l.white) {   // 위치를 옮긴(자른) 이미지 = 이미지 채우기(자르기) 도형
        nodes.push({ t: 'box', x: l.x, y: l.y, w: l.w, h: l.h, fill: 'transparent', radius: l.radius || 0, opacity: l.opacity == null ? 1 : l.opacity,
          fx: { fills: [{ type: 'IMAGE', src: l.src, scaleMode: 'CROP', crop: { ...l.crop } }] }, native, noNest: true });
      } else if (l.kind === 'image') {
        nodes.push({ t: 'image', x: l.x, y: l.y, w: l.w, h: l.h, src: l.src, opacity: l.opacity == null ? 1 : l.opacity, radius: l.radius || 0, native, fromFigma: l.figPic ? 'pic' : undefined, name: l.name });
      }
      { const gp = gpOf(l); if (gp.length) { const gn = gpnOf(l); for (const x of nodes.slice(from0)) { x.gp = gp.map(g => 'g' + g); x.gpn = gn.slice(); } } }   // 그룹 계층 → 저장
    }
    if (frame) {
      // 피그마 프레임은 레이어 구조를 그대로 둔다 — 화면 배경 같은 큰 도형에 글자를 라벨로 합치면 글자가 사라진다
      const ns = nodes; ns.forEach(n => { delete n.cx; delete n.cy; delete n.gw; });
      return { nodes: ns, w: Math.round(frame.w), h: Math.round(frame.h), fixed: true, frame: true, origin: 'banner' };
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
    const gmap = {};                      // 피그마 그룹(n.grp) → 레이어 그룹(gid)
    const regroup = (from, n) => { const p = nodeGp(n); if (!p.gp.length) return; const gp = p.gp.map(g => gmap[g] || (gmap[g] = uid())); for (const l of out.slice(from)) setGp(l, gp, p.gpn); };
    for (const n of scaled(comp, k)) {
      const from0 = out.length;
      const x = at.x + n.x, y = at.y + n.y;
      if (n.t === 'box') {
        const L = n.label;
        const r = base(n, { kind: 'rect', role: 'shape', name: n.name || (L ? L.text.split('\n')[0].slice(0, 16) : '도형'),
          x, y, w: n.w, h: n.h, fill: n.fill || '#ffffff', radius: n.radius || 0, opacity: n.opacity == null ? 1 : n.opacity });
        if (L) Object.assign(r, { text: L.text.replace(/\[\[|\]\]/g, ''), size: L.size, lh: L.lh || 1.3, ls: L.ls || 0, color: L.color, align: 'center', font: fontName(L.family, L.weight) });
        else Object.assign(r, { text: '', size: r.size || 40, lh: 1.3, ls: -0.02, color: '#111111', align: 'center', font: r.font || 'Pretendard SemiBold' });
        if (L && L.tfill) r.tfill = clone(L.tfill); else delete r.tfill;
        if (L && n.pad) r.auto = { padX: n.pad.x, padY: n.pad.y }; else delete r.auto;
        if (n.fx) r.fx = n.fx; else delete r.fx;
        if (L && L.shadows && L.shadows.length) r.shadows = L.shadows; else delete r.shadows;
        attachBake(r, n.bake);
        out.push(r);
      } else if (n.t === 'text') {
        out.push(base(n, { kind: 'text', role: 'free', name: (n.text || '텍스트').split('\n')[0].slice(0, 20), x, y, w: n.w,
          text: String(n.text || '').replace(/\[\[|\]\]/g, ''), size: n.size, lh: n.lh || 1.3, ls: n.ls || 0, color: n.color, align: n.align || 'left',
          font: fontName(n.family, n.weight), shadows: n.shadows && n.shadows.length ? n.shadows : undefined, opacity: n.opacity == null ? 1 : n.opacity,
          tfill: n.tfill ? clone(n.tfill) : undefined, nowrap: oneLineText(n) || undefined }));
        attachBake(out[out.length - 1], n.bake);
      } else if (n.t === 'image') {
        out.push(base(n, { kind: 'image', role: 'object', figPic: n.fromFigma ? true : undefined, name: n.name || '이미지', x, y, w: n.w, h: n.h, src: n.src, opacity: n.opacity == null ? 1 : n.opacity, radius: n.radius || 0 }));
      } else skipped.push(n);
      regroup(from0, n);
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
  // 글자 그라데이션 (피그마 글자 채우기) — 글자 상자 b 기준. 원형·다이아몬드는 원으로 근사
  function textPaint(c, p, b) {
    const s = paintStyle(c, p, b);
    if (!s.tf) return s.style;
    const hs = p.handles || [{ x: .5, y: .5 }, { x: 1, y: .5 }], a = { x: b.x + hs[0].x * b.w, y: b.y + hs[0].y * b.h }, z = { x: b.x + hs[1].x * b.w, y: b.y + hs[1].y * b.h };
    const g = c.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.max(.5, Math.hypot(z.x - a.x, z.y - a.y)));
    (p.stops || []).forEach(st => g.addColorStop(Math.max(0, Math.min(1, st.pos)), st.color)); return g;
  }
  // CSS 로 — 블로그 화면의 글자(배경을 글자 모양으로 자르기). 피그마 핸들 → CSS 각도·멈춤 위치
  function gradCSS(p, w, h) {
    const hs = p.handles || [{ x: 0, y: .5 }, { x: 1, y: .5 }], st = (p.stops || []);
    if (p.type === 'GRADIENT_LINEAR') {
      const ax = hs[0].x * w, ay = hs[0].y * h, zx = hs[1].x * w, zy = hs[1].y * h, dx = zx - ax, dy = zy - ay;
      const ang = Math.atan2(dx, -dy), L = Math.abs(w * Math.sin(ang)) + Math.abs(h * Math.cos(ang)) || 1;   // CSS 그라데이션 선 길이
      const len = Math.hypot(dx, dy), ux = dx / (len || 1), uy = dy / (len || 1);
      const t0 = ((ax - w / 2) * ux + (ay - h / 2) * uy + L / 2) / L, t1 = t0 + len / L;   // 핸들 시작·끝을 CSS 선 위 비율로
      return `linear-gradient(${(ang * 180 / Math.PI).toFixed(1)}deg, ${st.map(s => `${s.color} ${((t0 + (t1 - t0) * s.pos) * 100).toFixed(1)}%`).join(', ')})`;
    }
    if (p.type === 'GRADIENT_ANGULAR') return `conic-gradient(from ${(Math.atan2(hs[1].y * h - hs[0].y * h, hs[1].x * w - hs[0].x * w) * 180 / Math.PI + 90).toFixed(1)}deg at ${hs[0].x * 100}% ${hs[0].y * 100}%, ${st.map(s => `${s.color} ${(s.pos * 100).toFixed(1)}%`).join(', ')})`;
    const r = Math.hypot((hs[1].x - hs[0].x) * w, (hs[1].y - hs[0].y) * h);
    return `radial-gradient(circle ${r.toFixed(1)}px at ${hs[0].x * 100}% ${hs[0].y * 100}%, ${st.map(s => `${s.color} ${(s.pos * 100).toFixed(1)}%`).join(', ')})`;
  }
  // 자르기(crop) ↔ 이미지가 놓인 사각형 (도형 b 기준). 피그마의 '자르기' 모드에서 이미지를 끌고 키우는 것과 같은 모델
  const cropDest = (cr, b) => ({ x: b.x - cr.x / cr.w * b.w, y: b.y - cr.y / cr.h * b.h, w: b.w / cr.w, h: b.h / cr.h });
  const destCrop = (r, b) => ({ x: (b.x - r.x) / r.w, y: (b.y - r.y) / r.h, w: b.w / r.w, h: b.h / r.h });
  // 채우기·맞추기로 보이던 모양을 그대로 자르기 값으로 (자르기 모드로 들어갈 때 이미지가 튀지 않게)
  function modeCrop(mode, iw, ih, w, h) {
    const k = mode === 'FIT' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih), dw = iw * k, dh = ih * k;
    return destCrop({ x: (w - dw) / 2, y: (h - dh) / 2, w: dw, h: dh }, { x: 0, y: 0, w, h });
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
    if (mode === 'STRETCH') { c.drawImage(im, x, y, w, h); return; }    // 원본 전체를 도형 크기로 늘림
    if (mode === 'CROP' && p.crop) {                // crop = 도형에 보이는 이미지 영역(0~1). 영역이 이미지 밖으로 나가도 되게 이미지 전체를 옮겨 그린다 (도형으로 잘림)
      const r = cropDest(p.crop, b); c.drawImage(im, r.x, r.y, r.w, r.h); return;
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
    c.fillStyle = st.tfill ? textPaint(c, st.tfill, { x, y, w, h: measure(st).h }) : st.color || '#111'; c.textBaseline = 'middle';
    c.textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
    const ax = align === 'center' ? x + w / 2 : align === 'right' ? x + w : x, L = st.size * (st.lh || 1.3);
    const draw = () => lines(st.text).forEach((s, i) => c.fillText(s, ax, y + i * L + L / 2));
    for (const s of (st.shadows || [])) {             // 글자 그림자 — 겹마다 한 번씩
      c.save(); c.shadowColor = s.color; c.shadowBlur = s.blur * (c.getTransform().a || 1);
      c.shadowOffsetX = s.x * (c.getTransform().a || 1); c.shadowOffsetY = s.y * (c.getTransform().d || 1); draw(); c.restore();
    }
    draw();
  }
  // 내려받기용 PNG — 피그마 내보내기처럼 여백 없이 원래 크기 그대로 (scale 배). 피그마 프레임은 프레임 크기로 자르고 배경색을 칠한다
  function png(comp, scale) { return thumb(comp, 0, { scale: scale || 1 }); }
  async function thumb(comp, max, opts) {
    opts = opts || {};
    max = max || 360;
    await loadFonts(comp.nodes);
    // 이미지 채우기는 미리 받아 둔다 (썸네일은 한 번만 그린다)
    await Promise.all(comp.nodes.flatMap(n => (n.fx && n.fx.fills || []).filter(p => p.type === 'IMAGE'))
      .map(p => new Promise(res => { const im = img(p.src); if (im) return res(); const i = imgs.get(p.src); i.addEventListener('load', res); i.addEventListener('error', res); })));
    const isFrame = !!(comp.frame || comp.origin === 'figma');      // 예전에 저장한 피그마 컴포넌트는 frame 표시가 없다
    const m = isFrame ? 0 : Math.max(0, ...comp.nodes.map(n => n.t === 'box' ? outset(n) : 0));
    const k = opts.scale || Math.min(1, max / Math.max(comp.w + m * 2, comp.h + m * 2, 1));
    const pad = (opts.scale ? 0 : 8) + Math.round(m * k);          // 내려받기는 효과가 번지는 만큼만 (프레임은 0)
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(comp.w * k) + pad * 2); cv.height = Math.max(1, Math.round(comp.h * k) + pad * 2);
    const c = cv.getContext('2d');
    c.translate(pad, pad); c.scale(k, k);
    if (isFrame) {                                                    // 피그마 프레임 — 경계 밖은 잘라내고 프레임 배경색을 깐다
      c.beginPath(); c.rect(0, 0, comp.w, comp.h); c.clip();
      if (comp.bg) { c.fillStyle = comp.bg; c.fillRect(0, 0, comp.w, comp.h); }
    }
    for (const n of comp.nodes) {
      c.save(); c.globalAlpha = n.opacity == null ? 1 : n.opacity;
      const bim = n.bake && await loadImg(n.bake.src);
      if (bim) { c.globalAlpha = n.bake.alpha == null ? 1 : n.bake.alpha; c.drawImage(bim, n.bake.x, n.bake.y, n.bake.w, n.bake.h); }
      else if (n.t === 'box') {
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
      // 피그마 REST API 는 '자르기(Crop)' 를 STRETCH + imageTransform 으로 준다.
      // imageTransform [[sx,0,tx],[0,sy,ty]] = 도형에 보이는 이미지 영역(0~1). 그 영역을 도형 크기로 늘려 그린다
      if ((p.scaleMode === 'CROP' || p.scaleMode === 'STRETCH') && p.imageTransform) {
        const t = p.imageTransform; o.scaleMode = 'CROP'; o.crop = { x: t[0][2], y: t[1][2], w: t[0][0], h: t[1][1] };
      } else if (p.scaleMode === 'STRETCH') o.scaleMode = 'STRETCH';
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
  // 피그마 글꼴 이름 → 이미지 스튜디오 글꼴 (영문·한글 이름, 띄어쓰기 차이까지 맞춘다)
  const FIG_FONTS = [[/pretendard/i, 'Pretendard'], [/s-?core\s*dream|scdream|에스코어/i, 'SCDream'],
    [/^(sf\s*pro|sf\s*compact|\.?sf\s*ns|apple\s*sd|-apple-system|system)/i, 'System'],
    [/noto\s*sans\s*(kr|korean|cjk\s*kr)|본고딕/i, 'Noto Sans KR'], [/nanum\s*square\s*neo|나눔스퀘어\s*네오/i, 'NanumSquare Neo'],
    [/nanum\s*square|나눔스퀘어/i, 'NanumSquare Neo'], [/nanum\s*gothic|나눔고딕/i, 'Nanum Gothic'], [/nanum\s*myeongjo|나눔명조/i, 'Nanum Myeongjo'],
    [/nanum\s*pen|나눔손글씨\s*펜/i, 'Nanum Pen Script'], [/ibm\s*plex\s*sans\s*kr/i, 'IBM Plex Sans KR'], [/gothic\s*a1/i, 'Gothic A1'],
    [/black\s*han\s*sans|검은고딕/i, 'Black Han Sans'], [/chosun\s*bg|조선\s*견고딕/i, '조선견고딕'], [/do\s*hyeon|도현/i, 'Do Hyeon'], [/^jua|주아/i, 'Jua'], [/gowun\s*dodum|고운\s*돋움/i, 'Gowun Dodum'],
    [/gowun\s*batang|고운\s*바탕/i, 'Gowun Batang'], [/song\s*myung|송명/i, 'Song Myung'], [/^suit|수트/i, 'SUIT'], [/spoqa/i, 'Spoqa Han Sans Neo'],
    [/wanted\s*sans|원티드/i, 'Wanted Sans'], [/gmarket|지마켓/i, 'Gmarket Sans'], [/jalnan|잘난/i, 'Jalnan Gothic'],
    [/^inter\b/i, 'Inter'], [/^roboto/i, 'Roboto'], [/^montserrat/i, 'Montserrat'], [/^poppins/i, 'Poppins'], [/^(helvetica|arial)/i, 'Inter']];
  function figFont(fam, warn, weight) {
    for (const [re, v] of FIG_FONTS) if (re.test(fam || '')) {
      if (v === 'Gmarket Sans' && weight && weight !== 500) warn(`'${fam}' 은(는) 무료 배포본이 Medium 뿐이라 굵기가 조금 다를 수 있습니다`);
      if (/^(helvetica|arial)/i.test(fam)) warn(`서체 '${fam}' 은(는) 비슷한 Inter 로 바꿨습니다`);
      return v;
    }
    if (fam) warn(`서체 '${fam}' 은(는) 없어서 프리텐다드로 바꿨습니다 — 무료 글꼴이면 알려 주세요, 모음에 넣겠습니다`);
    return 'Pretendard';
  }
  function fromFigma(root, opts) {
    opts = opts || {};
    const rasters = opts.rasters || {}, imageFills = opts.imageFills || {}, warns = new Set();
    const warn = m => warns.add(m);
    const ox = root.absoluteBoundingBox.x, oy = root.absoluteBoundingBox.y;
    const nodes = [];
    const bakes = opts.bakes || {};
    const bakeFor = (n, alpha) => { const b = bakes[n.id]; return b && b.src ? { src: b.src, x: b.x - ox, y: b.y - oy, w: b.w, h: b.h, alpha } : null; };
    // 프레임의 '내용 자르기(Clip content)' — 넘친 부분은 피그마처럼 잘라야 한다
    let clip = null;
    const inter = (a, c) => { const x = Math.max(a.x, c.x), y = Math.max(a.y, c.y), x2 = Math.min(a.x + a.w, c.x + c.w), y2 = Math.min(a.y + a.h, c.y + c.h);
      return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null; };
    const gstack = [];                    // 피그마 레이어 묶음(프레임·그룹·인스턴스) 계층 — 편집기에서 그룹 안 그룹으로 잡힌다
    function push(node) {
      if (gstack.length) { node.gp = gstack.map(g => g.id); node.gpn = gstack.map(g => g.name); }
      if (clip) {
        const r = { x: node.x, y: node.y, w: node.w, h: node.h }, i = inter(r, clip);
        if (!i) return;                                                // 완전히 잘려 안 보이는 것
        const inside = i.w >= r.w - .5 && i.h >= r.h - .5;
        if (!inside && node.bake) {                                      // 피그마 그림을 경계에서 잘라 쓴다 (100% 같게)
          const b = node.bake;
          for (const k of Object.keys(node)) if (!['name', 'fromFigma', 'gp', 'gpn'].includes(k)) delete node[k];
          Object.assign(node, { t: 'image', x: b.x, y: b.y, w: b.w, h: b.h, src: b.src, opacity: b.alpha == null ? 1 : b.alpha, radius: 0, clip: { ...clip } });
        } else if (!inside) {
          // 모서리 없는 단색 사각형만 크기를 줄이고, 나머지(그림·글자·배지·둥근 도형·효과)는 경계에서 픽셀로 잘라 그림으로 바꾼다 (applyClips)
          const fx = node.fx || {}, plain = node.t === 'box' && !node.label && !node.radius && !fx.radii && !fx.effects && !fx.stroke && fx.shape !== 'ellipse' &&
            (fx.fills || []).every(p => p.type === 'SOLID');
          if (plain) Object.assign(node, i);
          else node.clip = { ...clip };
        }
      }
      nodes.push(node);
    }
    const bb = n => { const b = n.absoluteBoundingBox || { x: 0, y: 0, width: 0, height: 0 }; return { x: b.x - ox, y: b.y - oy, w: b.width, h: b.height }; };
    const raster = (n, op) => {
      const src = rasters[n.id];
      if (!src) {
        // 프레임 밖(가로 스크롤로 넘친 카드 등)이라 어차피 안 보이는 요소는 알리지 않는다
        const b = bb(n), outside = clip && !inter(b, clip);
        if (!outside && b.w >= 0.5 && b.h >= 0.5) warn(`'${n.name}' 을(를) 그림으로 받지 못해 빠졌습니다`);
        return;
      }
      const r = n.absoluteRenderBounds || n.absoluteBoundingBox;
      push({ t: 'image', x: r.x - ox, y: r.y - oy, w: r.width, h: r.height, src, opacity: 1, radius: 0, name: n.name, fromFigma: n.id });
    };
    const textNode = (n, op, quiet) => {      // quiet = 피그마 그림이 있는 버튼 라벨 (보이는 건 그대로)
      const st = n.style || {}, b = bb(n);
      const fill = (n.fills || []).filter(visible)[0];
      const size = st.fontSize || 16;
      let text = n.characters || '';
      if (st.textCase === 'UPPER') text = text.toUpperCase(); else if (st.textCase === 'LOWER') text = text.toLowerCase();
      if (n.characterStyleOverrides && n.characterStyleOverrides.some(Boolean)) warn(bakes[n.id] || quiet
        ? `'${n.name}' 은(는) 글자마다 색·굵기가 달라요 — 보이는 건 피그마 그대로지만, 글자를 고치면 첫 서식으로 통일됩니다`
        : `'${n.name}' 의 글자별 서식(일부 색·굵기)은 첫 서식으로 통일했습니다`);
      const t = { t: 'text', x: b.x, y: b.y, w: b.w, text, size, weight: st.fontWeight || 400, family: figFont(st.fontFamily, warn, st.fontWeight),
        color: fill && fill.type === 'SOLID' ? frgba(fill.color, (fill.opacity == null ? 1 : fill.opacity)) : '#000000',
        align: { CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'left' }[st.textAlignHorizontal] || 'left',
        lh: st.lineHeightPx ? +(st.lineHeightPx / size).toFixed(3) : 1.3, ls: st.letterSpacing ? +(st.letterSpacing / size).toFixed(4) : 0,
        opacity: op, name: n.name };
      const sh = figEffects(n).filter(e => e.type === 'DROP_SHADOW').map(e => ({ x: e.x, y: e.y, blur: e.blur, color: e.color }));
      if (sh.length) t.shadows = sh;
      if (fill && /^GRADIENT_/.test(fill.type)) {                       // 글자 그라데이션은 그대로 (고쳐도 그라데이션 유지)
        t.tfill = figPaint(fill); const s0 = (t.tfill.stops || [])[0]; if (s0) t.color = s0.color;
      } else if (fill && fill.type !== 'SOLID') warn(`'${n.name}' 글자의 이미지 채우기는 단색으로 바꿨습니다`);
      const m = measure(t);
      // 피그마에서 한 줄(또는 자동 폭)이던 글자는 브라우저 글꼴이 조금만 넓어도 줄바꿈된다 — 폭에 여유를 주고 정렬 기준점은 지킨다
      const L1 = st.lineHeightPx || size * 1.3, oneLine = b.h < L1 * (text.split('\n').length + 0.5);
      if (oneLine) t.nowrap = true;          // 피그마에서 한 줄이던 글자는 저절로 줄바꿈하지 않는다 (글꼴 폭이 조금 달라도 '60,000' 이 '0' 만 남지 않게)
      if (n.textAutoResize === 'WIDTH_AND_HEIGHT' || oneLine) {
        const need = Math.ceil(m.w * 1.06 + size * 0.3);
        if (need > t.w) { const d = need - t.w; if (t.align === 'center') t.x -= d / 2; else if (t.align === 'right') t.x -= d; t.w = need; }
      }
      t.h = Math.round(m.h);
      if (st.textAlignVertical === 'CENTER') t.y += (b.h - m.h) / 2; else if (st.textAlignVertical === 'BOTTOM') t.y += b.h - m.h;
      const off = t.align === 'center' ? (t.w - m.w) / 2 : t.align === 'right' ? t.w - m.w : 0;
      Object.assign(t, { cx: t.x + off + m.w / 2, cy: t.y + m.h / 2, gw: m.w });
      const tb = bakeFor(n, op / (n.opacity == null ? 1 : n.opacity)); if (tb) t.bake = tb;
      return t;
    };
    function walk(n, op) {
      if (!visible(n)) return;
      const parentOp = op == null ? 1 : op;
      op = parentOp * (n.opacity == null ? 1 : n.opacity);
      const kids = (n.children || []).filter(visible);
      // 피그마가 그린 그림이 있으면 — 글자 없는 요소는 그 그림 한 장으로 (아이콘·사진·벡터·마스크 모두 100% 같다)
      const bk = bakeFor(n, parentOp);
      if (bk && n !== root && n.type !== 'TEXT' && !hasText(n)) {
        push({ t: 'image', x: bk.x, y: bk.y, w: bk.w, h: bk.h, src: bk.src, opacity: parentOp, radius: 0, name: n.name, fromFigma: n.id });
        return;
      }
      // 그릴 수 없는 것 → 피그마가 렌더한 그림. 글자가 들어 있으면 글자를 살리려고 그림으로 굽지 않는다
      const imgFill = (n.fills || []).some(p => visible(p) && p.type === 'IMAGE');
      const oddPaint = [...(n.fills || []), ...(n.strokes || [])].some(p => visible(p) && !/^(SOLID|IMAGE|GRADIENT_(LINEAR|RADIAL|ANGULAR|DIAMOND))$/.test(p.type));
      const mask = kids.some(c => c.isMask);
      const partialArc = n.type === 'ELLIPSE' && n.arcData && (Math.abs(n.arcData.endingAngle - n.arcData.startingAngle) < 6.28 || n.arcData.innerRadius > 0);
      const blend = n.blendMode && !/^(PASS_THROUGH|NORMAL)$/.test(n.blendMode);
      if (VECTORISH.has(n.type) || !CONTAINER.has(n.type) && n.type !== 'TEXT' || partialArc || oddPaint || mask || blend || (rotated(n) && n !== root)) {
        if (n.type === 'TEXT') { if (rotated(n)) warn(`'${n.name}' 글자의 회전은 빼고 가져왔습니다`); push(textNode(n, op)); return; }
        if (!hasText(n)) return raster(n, op);
        if (!Object.keys(bakes).length) warn(`'${n.name}' 은(는) 그대로 그릴 수 없는 요소(회전·마스크·혼합 모드)가 있어 근사치로 가져왔습니다 — 피그마 플러그인으로 가져오면 그대로 나옵니다`);
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
        if (bk) box.bake = bk;                     // 자기 배경(또는 버튼은 글자까지) — 피그마 그림
        // 오토 레이아웃 — 텍스트 하나만 담은 프레임은 글자 + 패딩으로 크기가 정해지는 박스가 된다
        const texts = kids.filter(c => c.type === 'TEXT');
        if (n.layoutMode && n.layoutMode !== 'NONE' && texts.length === 1 && kids.length === 1 && !rotated(texts[0])) {
          const H = n.layoutMode === 'HORIZONTAL';
          const hugX = n.layoutSizingHorizontal ? n.layoutSizingHorizontal === 'HUG' : (H ? n.primaryAxisSizingMode : n.counterAxisSizingMode) === 'AUTO';
          const hugY = n.layoutSizingVertical ? n.layoutSizingVertical === 'HUG' : (H ? n.counterAxisSizingMode : n.primaryAxisSizingMode) === 'AUTO';
          const t = textNode(texts[0], op, !!bk);
          box.label = { text: t.text, size: t.size, weight: t.weight, family: t.family, color: t.color, tfill: t.tfill, lh: t.lh, ls: t.ls, shadows: t.shadows };
          const pl = n.paddingLeft || 0, pr = n.paddingRight || 0, pt = n.paddingTop || 0, pb = n.paddingBottom || 0;
          if (hugX) box.pad = { x: Math.round((pl + pr) / 2), y: hugY ? Math.round((pt + pb) / 2) : null };
          if (pl !== pr || (hugY && pt !== pb)) warn(`'${n.name}' 의 좌우·상하 패딩이 달라 평균값으로 맞췄습니다`);
          if (t.align !== 'center' && (!hugX || n.primaryAxisAlignItems !== 'CENTER' && n.counterAxisAlignItems !== 'CENTER'))
            { /* 정렬은 가운데로 맞춘다 — 피그마 그림이 있으면 보이는 모양은 같다 */ }
          push(box); return;
        }
        if (n.layoutMode && n.layoutMode !== 'NONE' && texts.length && kids.length > 1)
          { /* 글자 외 요소가 함께 든 오토 레이아웃은 크기 자동 조절을 하지 않는다 (정보성이라 알리지 않는다) */ }
        push(box);
      }
      const prev = clip;
      if (n.clipsContent) {
        const c = clip ? inter(b, clip) : b;
        clip = c ? { ...c, r: clip && clip.r != null && !n.cornerRadius ? clip.r : (n.rectangleCornerRadii || [n.cornerRadius || 0, n.cornerRadius || 0, n.cornerRadius || 0, n.cornerRadius || 0]) } : { x: 0, y: 0, w: 0, h: 0 };
      }
      // 마스크 — 마스크 도형 자체는 그리지 않고, 뒤따르는 형제들을 그 영역으로 자른다 (사각·둥근 마스크는 정확, 그 밖의 모양은 영역 근사)
      const pre = clip;
      const asGroup = n !== root && kids.length > 0;
      if (asGroup) gstack.push({ id: n.id, name: n.name });
      for (const c of kids) {
        if (c.isMask) { const mb = bb(c); const ci = clip ? inter(mb, clip) : mb; clip = ci ? { ...ci, r: c.rectangleCornerRadii || [c.cornerRadius || 0, c.cornerRadius || 0, c.cornerRadius || 0, c.cornerRadius || 0] } : { x: 0, y: 0, w: 0, h: 0 }; continue; }
        walk(c, op);
      }
      if (asGroup) gstack.pop();
      clip = pre;
      clip = prev;
    }
    walk(root, 1);
    if (!nodes.length) throw new Error('가져올 수 있는 요소가 없습니다');
    pruneGp(nodes);                        // 요소가 하나뿐인 묶음은 그룹으로 만들지 않는다
    // 루트 기준 좌표 → 정규화 (효과는 도형 밖으로 번져도 좌표에는 넣지 않는다)
    // 내용을 자르는 프레임이면 크기 = 피그마 프레임 크기 그대로 (넘친 요소 때문에 여백이 생기지 않게)
    if (root.clipsContent) {
      nodes.forEach(n => { n.x = Math.round(n.x); n.y = Math.round(n.y); delete n.cx; delete n.cy; delete n.gw; });
      const rf = (root.fills || []).filter(p => visible(p) && p.type === 'SOLID')[0];
      return { nodes, w: Math.round(root.absoluteBoundingBox.width), h: Math.round(root.absoluteBoundingBox.height), fixed: true, frame: true,
        bg: rf ? frgba(rf.color, rf.opacity) : null, origin: 'figma', warnings: [...warns] };
    }
    const res = normalize(nodes);
    return { ...res, origin: 'figma', warnings: [...warns] };
  }
  // 글자를 그림으로 구울 때 쓸 글꼴을 먼저 받아 둔다 (없으면 시스템 글꼴로 그려져 모양이 달라진다)
  async function loadFonts(nodes) {
    if (!document.fonts) return;
    const want = new Map();
    for (const n of nodes) for (const st of [n.t === 'text' ? n : null, n.label].filter(Boolean)) want.set(`${st.weight || 400} 16px ${cssFamily(st.family)}`, st);
    await Promise.all([...want.values()].map(st => ensureFont(st.family, st.weight)));
    await Promise.all([...want.keys()].map(f => document.fonts.load(f, '가A').catch(() => {})));
  }
  // 잘라내기(clip)가 남은 그림·이미지 채우기 도형을 실제 픽셀로 잘라 PNG 로 바꾼다 (모서리 둥근 프레임도 반영)
  async function applyClips(conv) {
    let n = 0;
    if (conv.nodes.some(x => x.clip && (x.t === 'text' || x.label))) await loadFonts(conv.nodes);
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
      } else if (node.t === 'text') {
        drawLines(g, node, node.x, node.y, node.w, node.align);
      } else {
        await Promise.all((node.fx.fills || []).filter(p => p.type === 'IMAGE').map(p => loadImg(p.src).then(im => { if (im) imgs.set(p.src, im); })));
        paintBox(g, node, { k: S });
        if (node.label) { const m = measure(node.label); drawLines(g, node.label, node.x, node.y + (node.h - m.h) / 2, node.w, 'center'); }
      }
      let src; try { src = cv.toDataURL('image/png'); } catch (e) { delete node.clip; continue; }   // 다른 출처 주소(만료 대비 미변환)면 자르지 않는다
      Object.assign(node, { t: 'image', x: i.x, y: i.y, w: i.w, h: i.h, src, opacity: 1, radius: 0 });
      for (const k of ['clip', 'fx', 'fill', 'label', 'pad', 'text', 'shadows']) delete node[k];
      n++;
    }
    if (n && !conv.fixed) Object.assign(conv, normalize(conv.nodes));
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
    if (conv.frame) comp.frame = true;
    if (conv.bg) comp.bg = conv.bg;
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

  // 지금 열린 화면의 버전 — 화면 왼쪽 아래에 작게 보인다 (예전 주소·캐시로 열었는지 바로 알 수 있게)
  const VERSION = '2026-10-25 f';
  const badge = () => { if (document.getElementById('uikitVer')) return; const b = document.createElement('div'); b.id = 'uikitVer'; b.textContent = '버전 ' + VERSION;
    b.style.cssText = 'position:fixed;left:8px;bottom:6px;z-index:9998;font:11px/1.4 -apple-system,sans-serif;color:#6b7280;background:rgba(255,255,255,.85);padding:2px 7px;border-radius:6px;pointer-events:none';
    document.body.appendChild(b); };
  if (document.body) badge(); else document.addEventListener('DOMContentLoaded', badge);
  window.UIKit = { VERSION, list, get, put, del, rename, setGroup, renameGroup, groups, save, thumb, png, measure, fit, fromBlog, toBlog, fromBanner, toBanner, placeScale,
    exportJSON, importJSON, parseFont, fontName, fromFigma, figmaNeeds, parseFigmaLink, applyClips,
    paintBox, paintURL, outset, hasFx, textShadowCSS, img, set onImage(fn) { onImage = fn; },
    bakeOk, bakeSig, labelSig, gpOf, gpnOf, setGp, pruneGp, layerRows, groupMembers, moveInTree, groupLayers, ungroupLayers, deeperSelection, remapGp, cropDest, destCrop, modeCrop, textPaint, gradCSS,
    fonts: FONT_LIB.map(x => ({ family: x[0], weights: x[2] })), ensureFont, loadFonts, cssFamily, familyOf, set onFont(fn) { onFont = fn; } };
})();
