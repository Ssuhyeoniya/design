/* 공통 상단 헤더 — 폭이 모자랄 때 버튼이 잘리지 않게 (shared/app-header.css 와 함께)
 * 1단계: 버튼 라벨을 앞의 아이콘만 남기고 줄인다(툴팁에 전체 라벨). 아이콘이 없는 버튼은 라벨 그대로.
 * 2단계: 그래도 넘치면 오른쪽 끝 '⋯' 더보기 메뉴로 버튼을 옮긴다(주 버튼은 마지막에). 메뉴 안에서는 전체 라벨.
 * 헤더 높이·메뉴(브랜드·페이지 이동) 좌표는 건드리지 않는다. 버튼 노드를 그대로 옮기므로 기존 클릭 핸들러가 그대로 동작한다. */
(function () {
  const ICON = /^\s*((?:\p{Extended_Pictographic}|[←-⯿＋])(?:️)?)\s+(\S.*)$/u;
  function setup(h) {
    if (h._appHdr) return; h._appHdr = true;
    const more = document.createElement('button');
    more.type = 'button'; more.className = 'app-more btn'; more.textContent = '⋯'; more.title = '더보기'; more.setAttribute('aria-haspopup', 'menu');
    more.style.display = 'none';
    const menu = document.createElement('div'); menu.className = 'app-more-menu'; menu.setAttribute('role', 'menu'); menu._owner = h;
    document.body.appendChild(menu);
    const moved = [];                                   // [{el, ph(자리 표시 주석)}]
    const closeMenu = () => { menu.classList.remove('open'); };
    more.onclick = e => { e.stopPropagation(); if (menu.classList.toggle('open')) { const r = more.getBoundingClientRect(); menu.style.top = (r.bottom + 4) + 'px'; menu.style.right = Math.max(6, innerWidth - r.right) + 'px'; } };
    document.addEventListener('mousedown', e => { if (!menu.contains(e.target) && e.target !== more) closeMenu(); });
    menu.addEventListener('click', e => { if (e.target.closest('button,a')) setTimeout(closeMenu, 0); });
    const isBtn = n => n.matches && n.matches('button, a.btn, a[role=button]');
    const cands = () => [...h.querySelectorAll('button, a.btn')].filter(n => n !== more && !n.closest('.app-nav') && !n.closest('#tabs') && n.offsetParent !== null);
    const over = () => h.scrollWidth > h.clientWidth + 1 || [...h.children].some(c => c.offsetParent && c.getBoundingClientRect().right > h.getBoundingClientRect().right + 0.5);
    function label(n) {                                 // 아이콘 라벨 준비(한 번)
      if (n.dataset.icon !== undefined) return;
      const m = ICON.exec(n.textContent || '');
      n.dataset.icon = m ? m[1] : '';
      if (m && !n.title) n.title = m[2].trim();
    }
    let busy = false;
    let fit = function () {
      if (busy) return; busy = true;
      try {
        moved.splice(0).forEach(({ el, ph }) => { if (ph.parentNode) ph.parentNode.replaceChild(el, ph); });
        menu.innerHTML = ''; closeMenu(); more.style.display = 'none';
        h.classList.remove('compact');
        if (!more.parentNode) h.appendChild(more);
        if (!over()) return;
        cands().forEach(label);
        h.classList.add('compact');
        if (!over()) return;
        more.style.display = '';
        const list = cands().reverse();                 // 오른쪽부터
        const order = [...list.filter(n => !/\b(pri|primary)\b/.test(n.className)), ...list.filter(n => /\b(pri|primary)\b/.test(n.className))];
        const toMenu = [];
        for (const n of order) {
          if (!over()) break;
          const ph = document.createComment('app-more'); n.parentNode.replaceChild(ph, n); moved.push({ el: n, ph }); toMenu.unshift(n);
        }
        // 메뉴 안 순서 = 원래 왼쪽→오른쪽
        moved.slice().sort((a, b) => (a.ph.compareDocumentPosition(b.ph) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1).forEach(({ el }) => menu.appendChild(el));
      } finally { busy = false; }
    };
    let t = 0; const later = () => { clearTimeout(t); t = setTimeout(fit, 30); };
    if (window.ResizeObserver) new ResizeObserver(later).observe(h);
    addEventListener('resize', later);
    // 버튼이 늦게 붙거나(리모콘·붙여넣기) 탭 전환으로 보이는 버튼이 바뀌면 다시 맞춘다
    const mo = new MutationObserver(() => later());
    mo.observe(h, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    const fit0 = fit; fit = function () { fit0(); mo.takeRecords(); };   // 맞추는 동안 생긴 변화(클래스·노드 이동)는 무시
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(later);
    fit();
    h._appHdrFit = fit;
  }
  /* 상단 페이지 메뉴는 항상 같은 탭으로 — Ctrl·Shift·Cmd 를 누른 채 클릭하거나 가운데(휠) 클릭해도 새 탭·새 창을 열지 않는다 */
  function sameTabNav() {
    const go = (e, a) => { e.preventDefault(); e.stopPropagation(); location.href = a.href; };
    document.addEventListener('click', e => { const a = e.target.closest && e.target.closest('.app-nav a[href]'); if (!a) return; if (e.button === 0 && (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)) go(e, a); }, true);
    document.addEventListener('auxclick', e => { const a = e.target.closest && e.target.closest('.app-nav a[href]'); if (a && e.button === 1) go(e, a); }, true);
    document.addEventListener('mousedown', e => { if (e.button === 1 && e.target.closest && e.target.closest('.app-nav a[href], .app-nav button')) e.preventDefault(); }, true);   // 휠 클릭 자동 스크롤 방지
    document.addEventListener('auxclick', e => { const b = e.target.closest && e.target.closest('.app-nav button'); if (b && e.button === 1) { e.preventDefault(); b.click(); } }, true);
  }
  /* 새 버전 알림 — 브라우저·CDN 이 예전 HTML 을 보여 주면(예: 메뉴가 새 탭으로 열리던 예전 화면) 새로고침을 권한다.
   * 화면마다 <meta name="app-build"> 를 넣고, 같은 값을 루트 version.json(캐시 안 함)에 둔다. 다르면 배너. */
  function versionCheck() {
    const mine = (document.querySelector('meta[name="app-build"]') || {}).content; if (!mine) return;
    const me = _scriptAtLoad || [...document.scripts].find(x => /shared\/app-header\.js/.test(x.src));
    const url = new URL('../version.json', me && me.src ? me.src : location.href);
    fetch(url.href + '?_=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(v => {
      if (!v || !v.build || v.build === mine) return;
      const b = document.createElement('div'); b.id = 'appVerBanner'; b.setAttribute('role', 'status');
      b.style.cssText = 'position:fixed;left:50%;top:56px;transform:translateX(-50%);z-index:9999;background:#111827;color:#fff;padding:10px 14px;border-radius:10px;font:600 13px/1.4 Pretendard,-apple-system,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25)';
      b.innerHTML = '새 버전이 있어요 — <a href="#" style="color:#93c5fd;font-weight:800">새로고침</a> <span style="opacity:.6;font-weight:400">(지금 ' + mine + ' · 최신 ' + String(v.build).replace(/[<>&"]/g, '') + ')</span>';
      b.querySelector('a').onclick = e => { e.preventDefault(); location.replace(location.pathname + '?v=' + Date.now() + location.hash); };
      document.body.appendChild(b);
    }).catch(() => { });
  }
  const _scriptAtLoad = document.currentScript;
  sameTabNav();
  const run = () => document.querySelectorAll('.app-hdr, .app-tools').forEach(setup);   // .app-tools = 블로그의 헤더 아래 도구 줄
  const boot = () => { run(); versionCheck.call(null); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.AppHeader = { refit: () => document.querySelectorAll('.app-hdr, .app-tools').forEach(h => h._appHdrFit && h._appHdrFit()) };
})();
