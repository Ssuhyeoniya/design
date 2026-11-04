/* PPT 리모콘 — PPT Helper v2.1 (AutoHotkey, 유수현) 의 기능을 웹 캔버스 레이어에 그대로 옮긴 떠 있는 패널.
 *
 *   정렬    왼쪽·위쪽·오른쪽·가운데·중간·아래쪽 맞춤 (선택 범위 기준, 2개+)
 *   간격    가로 동일 · 세로 동일 (양 끝 고정, 3개+)
 *   붙여정렬 세로(위→아래) · 가로(왼→오른쪽) 간격 없이 붙임 (2개+)
 *   그리드 복사  선택을 가로×세로 배열로 복제
 *   클립보드  선택 레이어를 이름 붙여 영구 저장(IndexedDB) → 붙여넣기 · 이름수정 · 삭제, 목록 더블클릭 = 붙여넣기
 *   단축키  AHK 와 같은 Ctrl+숫자패드 (Num0~9 · Num. · Num+ · Num-), Ctrl+Num* = 리모콘 열기/닫기
 *
 * 페이지는 PPTRemote.mount(adapter) 로 붙인다.
 *   adapter = {
 *     app: 'blog' | 'banner',         // 클립보드 보관 구분 (레이어 형식이 달라 앱별로 따로 저장)
 *     label: '블로그 이미지 제작',
 *     docName(): 현재 문서 이름,
 *     selected(): 선택된 레이어 객체 배열 (화면 순서),
 *     box(l): {x,y,w,h} 화면에 보이는 경계 상자,
 *     move(l, dx, dy): 레이어 이동 (잠금 레이어는 무시해도 된다),
 *     insert(layers, select): 레이어 사본(새 id 부여는 페이지가 한다)을 넣고 select 면 선택한다,
 *     commit(): 다시 그리기 + 되돌리기 기록,
 *     toolbar: 리모콘 버튼을 넣을 요소 (선택), before: 그 안에서 앞에 둘 요소 (선택)
 *   }
 */
(function () {
  'use strict';
  const CSS = `
#pptRemote{position:fixed;z-index:9000;width:640px;background:#f7f7f7;border:1px solid #c9ccd2;border-radius:10px;
  box-shadow:0 12px 36px rgba(0,0,0,.22);font:12px/1.4 'Pretendard','Malgun Gothic',sans-serif;color:#333;user-select:none;overflow:hidden}
#pptRemote[hidden]{display:none}
#pptRemote .pr-head{display:flex;align-items:center;gap:8px;height:36px;padding:0 0 0 12px;background:#fff;border-bottom:1px solid #ddd;cursor:move}
#pptRemote .pr-title{font-weight:700;font-size:13px}
#pptRemote .pr-by{color:#999;font-size:11px}
#pptRemote .pr-sp{flex:1}
#pptRemote .pr-stat{font-size:11px;color:#666;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px}
#pptRemote .pr-stat b{color:#009900;font-weight:600}
#pptRemote .pr-x{width:34px;height:36px;border:0;background:#fff;color:#999;font-size:15px;cursor:pointer}
#pptRemote .pr-x:hover{background:#e81123;color:#fff}
#pptRemote .pr-body{display:flex;padding:8px 10px 10px;gap:10px}
#pptRemote .pr-left{display:grid;grid-template-columns:repeat(6,1fr);gap:5px;width:290px;flex:none}
#pptRemote .pr-left button{grid-column:span 2}
#pptRemote .pr-left button.w3{grid-column:span 3}
#pptRemote button.pr-b{height:34px;border:1px solid #c9ccd2;border-radius:5px;background:#fff;color:#333;font:inherit;font-size:12px;cursor:pointer;padding:0 4px}
#pptRemote button.pr-b:hover{background:#eaf1ff;border-color:#7aa2ff}
#pptRemote button.pr-b:active{background:#d7e4ff}
#pptRemote .pr-div{width:1px;background:#ddd;flex:none}
#pptRemote .pr-right{flex:1;display:flex;flex-direction:column;gap:5px;min-width:0}
#pptRemote .pr-ch{display:flex;align-items:baseline;gap:8px}
#pptRemote .pr-ch b{font-size:12px}
#pptRemote .pr-ch span{color:#aaa;font-size:10px}
#pptRemote .pr-row{display:flex;gap:4px}
#pptRemote .pr-row button.pr-b{flex:1;height:26px;font-size:11px}
#pptRemote .pr-list{height:104px;overflow:auto;background:#fff;border:1px solid #c9ccd2;border-radius:4px}
#pptRemote .pr-it{padding:3px 7px;cursor:default;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pptRemote .pr-it.on{background:#3d7eff;color:#fff}
#pptRemote .pr-empty{padding:8px;color:#aaa;font-size:11px}
#pptRemote .pr-toast{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);background:#222;color:#fff;padding:5px 12px;border-radius:5px;
  font-size:11px;opacity:0;transition:opacity .15s;pointer-events:none;white-space:nowrap}
#pptRemote .pr-toast.on{opacity:.92}
#pptRemote .pr-toast.bad{background:#c62828}
html[data-theme=dark] #pptRemote{background:#22252b;border-color:#3a3f48;color:#ddd}
html[data-theme=dark] #pptRemote .pr-head,html[data-theme=dark] #pptRemote .pr-x{background:#2a2e35;border-color:#3a3f48}
html[data-theme=dark] #pptRemote button.pr-b,html[data-theme=dark] #pptRemote .pr-list{background:#2a2e35;border-color:#454b56;color:#ddd}
html[data-theme=dark] #pptRemote button.pr-b:hover{background:#33405a}
html[data-theme=dark] #pptRemote .pr-div{background:#3a3f48}
html[data-theme=dark] #pptRemote .pr-stat{color:#aaa}
@media (max-width:700px){#pptRemote{width:calc(100vw - 16px)}#pptRemote .pr-body{flex-direction:column}#pptRemote .pr-left{width:auto}#pptRemote .pr-div{display:none}}`;

  // [이름, 동작키, 툴팁, 단축키 코드, 넓은 버튼]
  const BTNS = [
    ['왼쪽 맞춤', 'alignL', '왼쪽 끝 맞춤', 'Numpad7'],
    ['위쪽 맞춤', 'alignT', '위쪽 끝 맞춤', 'Numpad8'],
    ['오른쪽 맞춤', 'alignR', '오른쪽 끝 맞춤', 'Numpad9'],
    ['가운데 맞춤', 'alignC', '가로 중심 맞춤', 'Numpad4'],
    ['중간 맞춤', 'alignM', '세로 중심 맞춤', 'Numpad5'],
    ['가로 동일', 'distH', '가로 간격 균등 (3개+)', 'Numpad6'],
    ['세로 붙여정렬', 'stackV', '위->아래 간격 없이 붙임', 'Numpad1'],
    ['아래쪽 맞춤', 'alignB', '아래쪽 끝 맞춤', 'Numpad2'],
    ['세로 동일', 'distV', '세로 간격 균등 (3개+)', 'Numpad3'],
    ['가로 붙여정렬', 'stackH', '왼->오른쪽 간격 없이 붙임', 'Numpad0', 1],
    ['그리드 복사', 'grid', '그리드 복사', 'NumpadDecimal', 1],
  ];
  const KEYNAME = { NumpadDecimal: 'Num.', NumpadAdd: 'Num+', NumpadSubtract: 'Num-', NumpadMultiply: 'Num*' };
  const keyLabel = c => 'Ctrl+' + (KEYNAME[c] || c.replace('Numpad', 'Num'));

  // ── 보관 (IndexedDB: ppt_remote / clips) ─────────────────────────────
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('이 브라우저에서는 IndexedDB 를 쓸 수 없습니다'));
      const q = indexedDB.open('ppt_remote', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('clips', { keyPath: 'id', autoIncrement: true });
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    return dbp;
  }
  async function store(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction('clips', mode), st = tx.objectStore('clips');
      const r = fn(st);
      tx.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
      tx.onerror = () => rej(tx.error);
    });
  }

  function mount(A) {
    if (document.getElementById('pptRemote')) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

    const P = document.createElement('div');
    P.id = 'pptRemote'; P.hidden = true;
    P.innerHTML = `
      <div class="pr-head">
        <span class="pr-title">PPT 리모콘</span><span class="pr-by">by 유수현</span>
        <span class="pr-sp"></span>
        <span class="pr-stat"></span>
        <button class="pr-x" title="닫기 (Ctrl+Num*)">✕</button>
      </div>
      <div class="pr-body">
        <div class="pr-left">${BTNS.map(([n, a, t, k, wide]) =>
          `<button class="pr-b${wide ? ' w3' : ''}" data-a="${a}" title="${t}\n${keyLabel(k)}">${n}</button>`).join('')}</div>
        <div class="pr-div"></div>
        <div class="pr-right">
          <div class="pr-ch"><b>클립보드</b><span>더블클릭=붙여넣기 / 영구저장</span></div>
          <div class="pr-row">
            <button class="pr-b" data-a="save" title="선택 레이어 영구 저장\nCtrl+Num+">저장</button>
            <button class="pr-b" data-a="paste" title="선택 항목 붙여넣기\nCtrl+Num-">붙여넣기</button>
            <button class="pr-b" data-a="rename" title="이름 변경">이름수정</button>
            <button class="pr-b" data-a="del" title="삭제">삭제</button>
          </div>
          <div class="pr-list" tabindex="0"></div>
        </div>
      </div>
      <div class="pr-toast"></div>`;
    document.body.appendChild(P);
    const $ = s => P.querySelector(s);

    // ── 상태 표시 (AHK 의 '연결상태' 자리) ──
    const stat = $('.pr-stat');
    function paintStat() {
      if (P.hidden) return;
      let n = 0; try { n = A.selected().length; } catch { }
      const doc = (A.docName && A.docName()) || '';
      stat.innerHTML = `<b>연결됨</b> · ${esc(A.label)}${doc ? ' · ' + esc(doc) : ''} · 선택 ${n}개`;
    }
    setInterval(paintStat, 300);

    let tT;
    function toast(m, bad) {
      const t = $('.pr-toast'); t.textContent = m; t.className = 'pr-toast on' + (bad ? ' bad' : '');
      clearTimeout(tT); tT = setTimeout(() => t.className = 'pr-toast', 1300);
    }

    // ── 열기 / 닫기 / 위치 ──
    const POS = 'pptRemote.pos';
    function place() {
      let p = null; try { p = JSON.parse(localStorage.getItem(POS)); } catch { }
      const w = P.offsetWidth || 640, h = P.offsetHeight || 210;
      const x = p ? p.x : innerWidth - w - 24, y = p ? p.y : innerHeight - h - 24;
      P.style.left = Math.max(0, Math.min(innerWidth - 60, x)) + 'px';
      P.style.top = Math.max(0, Math.min(innerHeight - 36, y)) + 'px';
    }
    function toggle(on) {
      P.hidden = on == null ? !P.hidden : !on;
      if (!P.hidden) { place(); paintStat(); refresh(); }
      if (btn) btn.classList.toggle('on', !P.hidden);
    }
    $('.pr-x').onclick = () => toggle(false);
    $('.pr-head').addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      const r = P.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
      const mv = ev => { P.style.left = (ev.clientX - ox) + 'px'; P.style.top = (ev.clientY - oy) + 'px'; };
      const up = () => {
        removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
        try { localStorage.setItem(POS, JSON.stringify({ x: P.offsetLeft, y: P.offsetTop })); } catch { }
      };
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
    });
    // 리모콘을 눌러도 캔버스 선택이 풀리지 않게 한다
    ['pointerdown', 'mousedown', 'click'].forEach(t => P.addEventListener(t, e => e.stopPropagation()));

    let btn = null;
    if (A.toolbar) {
      btn = document.createElement('button');
      btn.className = A.btnClass || 'btn'; btn.id = 'pptRemoteBtn'; btn.type = 'button';
      btn.textContent = '🎛 리모콘'; btn.title = 'PPT 리모콘 — 정렬·간격·붙여정렬·그리드 복사·도형 클립보드 (Ctrl+Num*)';
      A.toolbar.insertBefore(btn, A.before || null);
      btn.onclick = () => toggle();
    }

    // ── 정렬 계산 (PPT ShapeRange.Align / Distribute, 상대=선택 범위) ──
    const sel = () => { try { return A.selected(); } catch { return []; } };
    function need(n) {
      const L = sel();
      if (L.length < n) { toast(`${n}개 이상 선택해주세요.`, true); return null; }
      return L;
    }
    const boxes = L => L.map(l => ({ l, b: A.box(l) }));
    const done = msg => { A.commit(); toast(msg); };

    const ACT = {
      alignL() { align('x', (b, r) => r.x - b.x, '왼쪽 맞춤'); },
      alignC() { align('x', (b, r) => r.x + r.w / 2 - (b.x + b.w / 2), '가운데 맞춤'); },
      alignR() { align('x', (b, r) => r.x + r.w - (b.x + b.w), '오른쪽 맞춤'); },
      alignT() { align('y', (b, r) => r.y - b.y, '위쪽 맞춤'); },
      alignM() { align('y', (b, r) => r.y + r.h / 2 - (b.y + b.h / 2), '중간 맞춤'); },
      alignB() { align('y', (b, r) => r.y + r.h - (b.y + b.h), '아래쪽 맞춤'); },
      distH() { distribute('x', '가로 간격 동일'); },
      distV() { distribute('y', '세로 간격 동일'); },
      stackV() { stack('y', '세로 붙여정렬 완료'); },
      stackH() { stack('x', '가로 붙여정렬 완료'); },
      grid, save, paste: () => paste(), rename, del,
    };
    function bounds(B) {
      const x0 = Math.min(...B.map(o => o.b.x)), y0 = Math.min(...B.map(o => o.b.y));
      const x1 = Math.max(...B.map(o => o.b.x + o.b.w)), y1 = Math.max(...B.map(o => o.b.y + o.b.h));
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    function align(axis, delta, msg) {
      const L = need(2); if (!L) return;
      const B = boxes(L), r = bounds(B);
      for (const { l, b } of B) {
        const d = Math.round(delta(b, r));
        if (d) axis === 'x' ? A.move(l, d, 0) : A.move(l, 0, d);
      }
      done(msg);
    }
    function distribute(axis, msg) {
      const L = need(3); if (!L) return;
      const p = axis === 'x' ? 'x' : 'y', s = axis === 'x' ? 'w' : 'h';
      const B = boxes(L).sort((a, b) => a.b[p] - b.b[p]);
      const first = B[0].b, last = B[B.length - 1].b;          // 양 끝(첫·마지막 위치) 고정
      const span = last[p] + last[s] - first[p], total = B.reduce((t, o) => t + o.b[s], 0);
      const gap = (span - total) / (B.length - 1);
      let cur = first[p];
      for (const { l, b } of B) {
        const d = Math.round(cur - b[p]);
        if (d) axis === 'x' ? A.move(l, d, 0) : A.move(l, 0, d);
        cur += b[s] + gap;
      }
      done(msg);
    }
    function stack(axis, msg) {
      const L = need(2); if (!L) return;
      const p = axis === 'x' ? 'x' : 'y', s = axis === 'x' ? 'w' : 'h';
      const B = boxes(L).sort((a, b) => a.b[p] - b.b[p]);
      let cur = B[0].b[p] + B[0].b[s];
      for (const { l, b } of B.slice(1)) {
        const d = Math.round(cur - b[p]);
        if (d) axis === 'x' ? A.move(l, d, 0) : A.move(l, 0, d);
        cur += b[s];
      }
      done(msg);
    }
    const clone = o => JSON.parse(JSON.stringify(o));
    function grid() {
      const L = need(1); if (!L) return;
      const v = prompt('그리드 복사\n가로 세로 (예: 3 3):', '3 3'); if (v == null) return;
      const [cols, rows] = v.trim().split(/[\s,x×*]+/).map(n => parseInt(n, 10));
      if (!(cols >= 1 && rows >= 1) || cols * rows > 400) return toast('형식: 3 3', true);
      const r = bounds(boxes(L)), copies = [];
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        if (!row && !col) continue;
        for (const l of L) { const c = clone(l); c.x = (c.x || 0) + Math.round(col * r.w); c.y = (c.y || 0) + Math.round(row * r.h); copies.push(c); }
      }
      if (copies.length) A.insert(copies, false);
      done(`${cols}x${rows} 그리드 완료`);
    }

    // ── 클립보드 (영구 저장) ──
    let clips = [], pick = null;
    const list = $('.pr-list');
    const fmt = t => { const d = new Date(t), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; };
    async function refresh() {
      try { clips = (await store('readonly', s => s.getAll())).filter(c => c.app === A.app).sort((a, b) => a.name.localeCompare(b.name, 'ko')); }
      catch (e) { clips = []; list.innerHTML = `<div class="pr-empty">${esc(e.message)}</div>`; return; }
      if (pick != null && !clips.some(c => c.id === pick)) pick = null;
      list.innerHTML = clips.length ? clips.map(c =>
        `<div class="pr-it${c.id === pick ? ' on' : ''}" data-id="${c.id}" title="${esc(c.name)} · 레이어 ${c.layers.length}개">${esc(c.name)} (${fmt(c.ts)})</div>`).join('')
        : '<div class="pr-empty">저장된 항목이 없습니다. 레이어를 선택하고 [저장] (Ctrl+Num+)</div>';
    }
    list.addEventListener('click', e => {
      const it = e.target.closest('.pr-it'); if (!it) return;
      pick = +it.dataset.id; list.querySelectorAll('.pr-it').forEach(x => x.classList.toggle('on', x === it));
    });
    list.addEventListener('dblclick', e => { const it = e.target.closest('.pr-it'); if (it) { pick = +it.dataset.id; paste(); } });
    const picked = () => clips.find(c => c.id === pick);

    async function save() {
      const L = sel();
      if (!L.length) return toast('레이어를 선택해주세요.', true);
      let name = prompt('도형 저장\n이름:'); if (name == null) return;
      name = name.replace(/[\\/:*?"<>|]/g, '').trim(); if (!name) return;
      const dup = clips.find(c => c.name === name);
      if (dup && !confirm(`"${name}" 이름이 이미 있습니다. 덮어쓰시겠습니까?`)) return;
      const rec = { app: A.app, name, layers: clone(L), ts: Date.now() };
      if (dup) rec.id = dup.id;
      try { await store('readwrite', s => s.put(rec)); }
      catch (e) { return toast('저장 실패: ' + e.message, true); }
      await refresh(); toast(`"${name}" 저장 완료`);
    }
    function paste() {
      const c = picked(); if (!c) return toast('항목을 선택해주세요.', true);
      A.insert(clone(c.layers), true);
      done('붙여넣기 완료');
    }
    async function rename() {
      const c = picked(); if (!c) return toast('항목을 선택해주세요.', true);
      let n = prompt('이름 변경\n새 이름:', c.name); if (n == null) return;
      n = n.replace(/[\\/:*?"<>|]/g, '').trim(); if (!n || n === c.name) return;
      if (clips.some(x => x.name === n && x.id !== c.id)) return toast('같은 이름이 이미 있습니다.', true);
      await store('readwrite', s => s.put({ ...c, name: n }));
      await refresh(); toast('이름 변경 완료');
    }
    async function del() {
      const c = picked(); if (!c) return toast('항목을 선택해주세요.', true);
      if (!confirm('삭제하시겠습니까?')) return;
      await store('readwrite', s => s.delete(c.id));
      pick = null; await refresh(); toast('삭제 완료');
    }

    P.querySelectorAll('button[data-a]').forEach(b => b.onclick = () => ACT[b.dataset.a]());

    // ── 단축키 (AHK 와 동일: Ctrl+숫자패드) — 리모콘이 닫혀 있어도 동작 ──
    const HOT = Object.fromEntries(BTNS.map(b => [b[3], b[1]]));
    HOT.NumpadAdd = 'save'; HOT.NumpadSubtract = 'paste';
    addEventListener('keydown', e => {
      if (!(e.ctrlKey || e.metaKey) || !e.code.startsWith('Numpad')) return;
      const t = e.target;
      if (t && t.matches && (t.isContentEditable || t.matches('textarea,input:not([type=range]):not([type=color]):not([type=checkbox])'))) return;
      if (e.code === 'NumpadMultiply') { e.preventDefault(); e.stopPropagation(); toggle(); return; }
      const a = HOT[e.code]; if (!a) return;
      e.preventDefault(); e.stopPropagation();               // Ctrl+Num+/- 브라우저 확대·축소 대신 리모콘 동작
      if (P.hidden && ['save', 'paste'].includes(a)) toggle(true);
      ACT[a]();
    }, true);

    window.PPTRemote.toggle = toggle;
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  window.PPTRemote = { mount };
})();
