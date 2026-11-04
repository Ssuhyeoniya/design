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
  // 전체 목록 — opts.includeHidden 이면 숨긴 것도 hidden:true 로 함께
  async function loadAll(root, opts) {
    opts = opts || {};
    const st = await loadStatic(root), hid = hiddenSet();
    let my = [];
    try { my = (await mine()).map(i => ({ key: 'mine:' + i.id, source: 'mine', id: i.id, name: i.name, category: i.category || '기본', url: i.src, kb: i.kb, ts: i.ts || 0 })).sort((a, b) => b.ts - a.ts); }
    catch (e) { if (opts.throwOnDb) throw e; }
    const all = [...st.lib, ...my, ...st.base].map(i => Object.assign(i, { hidden: i.source !== 'mine' && hid.has(i.key) }));
    return opts.includeHidden ? all : all.filter(i => !i.hidden);
  }
  window.StockKit = { HKEY, hiddenSet, setHidden, loadStatic, loadAll, mine, delMine, onChange: fn => { subs.add(fn); return () => subs.delete(fn); }, notify };
})();
