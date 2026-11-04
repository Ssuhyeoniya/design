/* 스톡 이미지 보관함 공용 로더 — 블로그 이미지 제작 · 배너 스튜디오 · 이미지 소스(library.html)가 같이 쓴다.
 *
 * 출처 3곳 (블로그 스튜디오 loadStockStatic·loadStock 과 같은 규칙)
 *   ① lib  : assets/campaign-library/metadata/assets.json (reusable !== false)  — 저장소 정적 파일, 읽기 전용
 *   ② base : banner_studio/stock/manifest.json (①에 같은 파일이 있으면 ①로만)     — 저장소 정적 파일, 읽기 전용
 *   ③ mine : IndexedDB 'banner_studio' · store 'stock' { id, category, name, src(dataURL), kb, ts } — 실제 삭제 가능
 *
 * 숨기기: ①·② 는 브라우저에서 파일을 지울 수 없으므로 '숨김 목록'으로 세 화면 보관함에서 뺀다(파일은 저장소에 그대로).
 *   숨김 목록은 localStorage 'stockHidden:v1' (저장소 기준 경로 배열). IndexedDB 'banner_studio' 에 새 스토어를 만들려면
 *   DB 버전을 올려야 하는데, 다른 탭이 버전 1로 열려 있으면 업그레이드가 막히고(onblocked) 배너 스튜디오가 VersionError 로
 *   못 열릴 수 있어 쓰지 않는다. 같은 출처라 세 화면이 같은 목록을 본다.
 * 변경 알림: BroadcastChannel('stock-kit') + storage 이벤트 → 열린 다른 화면 보관함이 다시 읽는다.
 */
(function () {
  const HKEY = 'stockHidden:v1';
  const enc = p => String(p).split('/').map(encodeURIComponent).join('/');
  const bc = (() => { try { return new BroadcastChannel('stock-kit'); } catch (e) { return null; } })();
  const subs = new Set();
  const fire = why => subs.forEach(fn => { try { fn(why); } catch (e) { } });
  if (bc) bc.onmessage = ev => fire(ev.data || 'changed');
  addEventListener('storage', ev => { if (ev.key === HKEY) fire('hidden'); });
  function notify(why) { try { bc && bc.postMessage(why); } catch (e) { } fire(why); }

  function hiddenSet() { try { return new Set(JSON.parse(localStorage.getItem(HKEY) || '[]')); } catch (e) { return new Set(); } }
  function setHidden(keys, on) {
    const h = hiddenSet(); (keys || []).forEach(k => on ? h.add(k) : h.delete(k));
    try { localStorage.setItem(HKEY, JSON.stringify([...h])); } catch (e) { throw new Error('숨김 목록을 저장하지 못했어 (브라우저 저장소 사용 불가)'); }
    notify('hidden'); return h;
  }

  function db() {
    return new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('이 브라우저에서는 IndexedDB 를 쓸 수 없어'));
      const q = indexedDB.open('banner_studio', 1);
      q.onupgradeneeded = () => {           // 배너 스튜디오·블로그와 같은 스키마(버전 1)
        const d = q.result;
        if (!d.objectStoreNames.contains('stock')) d.createObjectStore('stock', { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'name' });
      };
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
      q.onblocked = () => rej(new Error('다른 탭에서 배너 스튜디오 DB 를 사용 중이야. 다른 탭을 닫고 새로고침해줘.'));
    });
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction('stock', mode); const r = fn(t.objectStore('stock'));
      t.oncomplete = () => { d.close(); res(r && 'result' in r ? r.result : undefined); };
      t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('저장소 작업이 중단됐어'));
    });
  }
  async function mine() { return (await tx('readonly', os => os.getAll())) || []; }
  async function delMine(ids) { await tx('readwrite', os => { ids.forEach(id => os.delete(id)); }); notify('mine'); }

  // root = 저장소 루트까지의 상대 경로 ('' · '../')
  async function loadStatic(root) {
    root = root || '';
    const getJ = u => fetch(u, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
    const [lib, man] = await Promise.all([getJ(root + 'assets/campaign-library/metadata/assets.json'), getJ(root + 'banner_studio/stock/manifest.json')]);
    const libItems = ((lib && lib.assets) || []).filter(a => a.reusable !== false).map(a => ({
      key: a.path, source: 'lib', name: a.fileName, category: '라이브러리 · ' + a.category, url: root + enc(a.path),
      kb: Math.round((a.bytes || 0) / 1024), assetId: a.assetId, description: a.description }));
    const inLib = new Set(libItems.map(i => i.key));
    const base = ((man && man.items) || []).map(i => ({ key: 'banner_studio/stock/' + i.rel, source: 'base', name: i.name, category: i.category,
      kb: i.kb, url: root + 'banner_studio/stock/' + enc(i.rel) })).filter(i => !inLib.has(i.key));
    return { lib: libItems, base };
  }
  // ── 공용 저장(design 저장소, /api/stock) ─────────────────────────────────────────────
  // 서버(/api)가 없거나(로컬 http.server·파일 열기) 토큰이 설정 안 됐으면 로컬 모드 — 지금처럼 이 브라우저(IndexedDB·localStorage)만
  const PWKEY = 'stockPw:v1';
  let remoteCache = null, remoteAt = 0;
  async function remote(root, fresh) {
    root = root || '';
    if (!fresh && remoteCache && Date.now() - remoteAt < 1500) return remoteCache;
    let st;
    // 로컬에서 연 화면(파일·localhost)은 서버(/api)가 없으니 묻지 않는다(콘솔 404 방지). vercel dev 등으로 시험할 때는
    // localStorage 'stockApi' = 'on' 으로 켠다
    let force = ''; try { force = localStorage.getItem('stockApi') || ''; } catch (e) { }
    const localHost = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(location.hostname);
    if ((localHost && force !== 'on') || force === 'off') { st = { on: false, reason: '로컬에서 연 화면(서버 없음)', root }; remoteCache = st; remoteAt = Date.now(); return st; }
    try {
      const r = await fetch(root + 'api/stock', { cache: 'no-store', headers: { 'Accept': 'application/json' } });
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || !/json/.test(ct)) st = { on: false, reason: r.status === 404 ? '서버(/api) 없음' : '서버 응답 ' + r.status };
      else { const j = await r.json();
        st = j.enabled ? { on: true, writable: !!j.writable, public: !!j.public, items: j.items || [], hidden: j.hidden || [] }
          : { on: false, reason: j.message || '서버 설정 필요' }; }
    } catch (e) { st = { on: false, reason: '서버에 연결 못 함' }; }
    st.root = root;
    remoteCache = st; remoteAt = Date.now();
    return st;
  }
  const absUrl = (root, u) => /^\/api\//.test(u) ? root + u.slice(1) : u;   // 프록시 주소를 화면 위치 기준으로
  function sharedItems(st) {
    return (st.items || []).map(i => ({ key: 'shared:' + i.id, source: 'shared', sharedId: i.id, name: i.name, category: i.category || '기본',
      url: absUrl(st.root || '', i.url), kb: i.kb, ts: i.ts || 0 }));
  }
  function password(ask) {
    let pw = ''; try { pw = localStorage.getItem(PWKEY) || ''; } catch (e) { }
    if (!pw || ask) { pw = (prompt('공용 스톡 비밀번호를 입력해줘\n(처음 한 번만 — 이 브라우저에 기억해. 비밀번호는 관리자가 Vercel 에 정한 값)') || '').trim(); if (pw) try { localStorage.setItem(PWKEY, pw); } catch (e) { } }
    return pw;
  }
  async function post(root, body) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const pw = password(attempt > 0); if (!pw) throw new Error('비밀번호를 입력하지 않아 취소했어');
      const r = await fetch((root || '') + 'api/stock', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-stock-password': pw }, body: JSON.stringify(body) });
      let j = {}; try { j = await r.json(); } catch (e) { }
      if (r.status === 401) { try { localStorage.removeItem(PWKEY); } catch (e) { } if (attempt === 0) continue; }
      if (!r.ok) throw new Error(j.error || ('서버 오류 ' + r.status));
      remoteCache = null; return j;
    }
  }
  async function upload(root, o) { const j = await post(root, Object.assign({ action: 'upload' }, o)); notify('shared'); return j; }
  async function delShared(root, ids) { const j = await post(root, { action: 'delete', ids }); notify('shared'); return j; }
  // 숨김 — 공용 모드면 저장소 hidden.json, 아니면 이 브라우저 localStorage
  async function setHiddenAny(root, keys, on) {
    const st = await remote(root);
    if (st.on) { const j = await post(root, { action: 'hide', keys, on }); notify('hidden'); return new Set(j.hidden || []); }
    return setHidden(keys, on);
  }
  async function hiddenNow(root) { const st = await remote(root); return st.on ? new Set(st.hidden || []) : hiddenSet(); }
  // 전체 목록 — 공용 모드면 ① 라이브러리 ② 기본 + 공용 이미지(저장소), opts.includeLocal 이면 이 브라우저 이미지도(옮기기용)
  //           로컬 모드면 ① ② + 이 브라우저 이미지. opts.includeHidden 이면 숨긴 것도 hidden:true 로 함께
  async function loadAll(root, opts) {
    opts = opts || {};
    const [st, rm] = await Promise.all([loadStatic(root), remote(root, true)]);
    const hid = rm.on ? new Set(rm.hidden || []) : hiddenSet();
    let my = [];
    if (!rm.on || opts.includeLocal) {
      try { my = (await mine()).map(i => ({ key: 'mine:' + i.id, source: 'mine', id: i.id, name: i.name, category: i.category || '기본', url: i.src, kb: i.kb, ts: i.ts || 0 })).sort((a, b) => b.ts - a.ts); }
      catch (e) { if (opts.throwOnDb) throw e; }
    }
    const shared = rm.on ? sharedItems(rm).sort((a, b) => b.ts - a.ts) : [];
    const all = [...st.lib, ...shared, ...my, ...st.base].map(i => Object.assign(i, { hidden: (i.source === 'lib' || i.source === 'base') && hid.has(i.key) }));
    return opts.includeHidden ? all : all.filter(i => !i.hidden);
  }
  // 이 브라우저 이미지 → 공용으로 (자동으로 하지 않는다. 로컬 데이터는 지우지 않는다) — 같은 내용은 서버가 중복으로 건너뜀
  async function migrateLocal(root, onStep) {
    const st = await remote(root, true); if (!st.on) throw new Error('공용 저장이 꺼져 있어');
    const list = await mine(); let up = 0, dup = 0, fail = [];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      try { const j = await post(root, { action: 'upload', name: it.name, category: it.category || '기본', dataUrl: it.src }); if (j.duplicate) dup++; else up++; }
      catch (e) { fail.push(it.name + ' — ' + e.message); if (/비밀번호/.test(e.message)) break; }
      onStep && onStep(i + 1, list.length);
    }
    const hk = [...hiddenSet()]; if (hk.length) { try { await post(root, { action: 'hide', keys: hk, on: true }); } catch (e) { fail.push('숨김 목록 — ' + e.message); } }
    notify('shared');
    return { total: list.length, up, dup, fail, hidden: hk.length };
  }
  const MAX_UPLOAD = 3 * 1024 * 1024;   // 서버와 같은 한도(Vercel 요청 본문 4.5MB, base64 로 1.37배)
  window.StockKit = { HKEY, hiddenSet, setHidden, setHiddenAny, hiddenNow, loadStatic, loadAll, mine, delMine, remote, sharedItems, upload, delShared, migrateLocal, password, MAX_UPLOAD,
    onChange: fn => { subs.add(fn); return () => subs.delete(fn); }, notify };
})();
