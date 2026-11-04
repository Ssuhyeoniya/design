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
  const run = () => document.querySelectorAll('.app-hdr, .app-tools').forEach(setup);   // .app-tools = 블로그의 헤더 아래 도구 줄
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  window.AppHeader = { refit: () => document.querySelectorAll('.app-hdr, .app-tools').forEach(h => h._appHdrFit && h._appHdrFit()) };
})();
