/* 배너 스튜디오 — 식권대장 In-App 광고 배너 제작기
   design 저장소용 정적 버전 — 서버 없이 브라우저만으로 동작한다.
   규격 원문: data/banner_specs.json   가이드 PNG: assets/*.png   폰트: fonts/*
   저장소: 브라우저 IndexedDB ('banner_studio' — stock · projects)
           기본 제공 스톡은 stock/manifest.json 목록을 읽는다 (읽기 전용)
   캠페인 에셋 라이브러리: ../assets/campaign-library/metadata/assets.json (읽기 전용, Asset ID 로 참조)
   배너 기획안: ../data/banner-plans/index.json → campaigns/{campaignId}/{bannerId}.json
           스튜디오에서 고친 기획안은 브라우저 'banner_plans' DB 에 수정본으로 두고 JSON 으로 내려받는다.
           저장소 반영은 tools/creative-lib.mjs plan:save 로 한다 (정적 사이트라 직접 쓰지 못한다).   */
'use strict';

// ══════════════════════════════════ 유틸 ══════════════════════════════════
const $ = s => document.querySelector(s);
const el = (t, c) => { const e = document.createElement(t); if (c) e.className = c; return e; };
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let toastT;
function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'on' + (bad ? ' bad' : '');
  clearTimeout(toastT); toastT = setTimeout(() => t.className = '', 2600);
}

function hexToRgb(h) {
  h = String(h).replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
// WCAG 상대휘도 — 텍스트/배경 대비 계산용
function lum(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); });
  return .2126 * r + .7152 * g + .0722 * b;
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };

const loadImg = src => new Promise((res, rej) => {
  const i = new Image(); i.crossOrigin = 'anonymous';
  i.onload = () => res(i); i.onerror = () => rej(new Error('이미지 로드 실패: ' + src)); i.src = src;
});

// ══════════════════════════════════ 폰트 ══════════════════════════════════
const PRE_W = { Thin: 100, ExtraLight: 200, Light: 300, Regular: 400, Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800, Black: 900 };

function installFonts() {
  let css = '';
  for (const [n, w] of Object.entries(PRE_W)) {
    css += `@font-face{font-family:Pretendard;src:url("fonts/Pretendard/Pretendard-${n}.otf")format("opentype");font-weight:${w};font-display:swap}\n`;
  }
  for (let i = 1; i <= 9; i++) {
    css += `@font-face{font-family:SCDream;src:url("fonts/SCDream/SCDream${i}.otf")format("opentype");font-weight:${i * 100};font-display:swap}\n`;
  }
  $('#fontface').textContent = css;
}
// 규격의 서체명("S-core Dream 6Bold" 등)을 캔버스 font 속성으로 변환
function parseFont(name) {
  const s = String(name || '');
  let m = s.match(/S-?core\s*Dream\s*(\d)/i);
  if (m) return { family: 'SCDream', weight: +m[1] * 100 };
  m = s.match(/Pretendard[-\s]*([A-Za-z]+)?/i);
  if (m) return { family: 'Pretendard', weight: PRE_W[m[1]] || 400 };
  return { family: 'Pretendard', weight: 400 };
}
const fontCss = (f, size) => `${f.weight} ${size}px ${f.family}, "Malgun Gothic", sans-serif`;

// ══════════════════════════════════ 상태 ══════════════════════════════════
let SPECS = null;
let S = null;              // 현재 작업 상태
let zoom = 1, autoFit = true;
let sel = null;            // 선택된 레이어 id
const imgCache = new Map(); // src -> HTMLImageElement
const guideCache = new Map();
let history = [], hIdx = -1;

const TYPE_ORDER = ['splash', 'popup', 'pick_banner', 'pick_detail', 'shortcut', 'main_banner', 'event_banner',
  'bow_splash', 'bow_popup', 'bow_pick_banner', 'bow_pick_detail', 'free'];
// 자유 캔버스 — 규정·검수 없이 크기를 마음대로 정하는 타입 (banner_specs.json 의 free: true)
const isFree = sp => !!(sp && sp.free);
const FREE_MIN = 16, FREE_MAX = 8000;

function blankState(type) {
  const sp = SPECS[type];
  const [w, h] = defaultCanvas(type, sp);
  return {
    type, w, h,
    bg: { mode: 'solid', c1: '#2f3542', c2: '#5a6478', angle: 90 },
    layers: [], name: '',
  };
}
function defaultCanvas(type, sp) {
  if (sp.canvas && sp.canvas[0] && sp.canvas[1]) return [sp.canvas[0], sp.canvas[1]];
  if (sp.psd_canvas) return [sp.psd_canvas[0], sp.psd_canvas[1]];
  if (isFree(sp)) return [1080, 1080];                // 자유 캔버스 — 정사각 기본, 이후 자유 조정
  return [1000, 1000]; // 스플래시 — 1:1 기본
}

// 앵커/비율 좌표를 현재 캔버스 픽셀로 정규화
function zonesOf(sp, w, h) {
  const out = [];
  for (const z of (sp.zones || [])) out.push({ ...z, r: z.rect_px.slice() });
  for (const z of (sp.zones_anchored || [])) {
    const [x0, y0, x1, y1] = z.rect_px;
    const f = v => v < 0 ? h + v : v;
    out.push({ ...z, r: [x0, z.anchor === 'bottom' ? f(y0) : y0, x1, z.anchor === 'bottom' ? f(y1) : y1] });
  }
  for (const z of (sp.zones_ratio || [])) {
    const [a, b, c, d] = z.rect;
    out.push({ ...z, r: [a * w, b * h, c * w, d * h] });
  }
  return out;
}

// ══════════════════════════════════ 레이어 시딩 ══════════════════════════════════
// 타입을 고르면 규격 좌표대로 뼈대를 깔아준다 (= 프리셋)
async function seedLayers() {
  const sp = SPECS[S.type], zs = zonesOf(sp, S.w, S.h);
  const L = [];
  if (isFree(sp)) {
    const size = Math.max(12, Math.round(Math.min(S.w, S.h) / 12)), pad = Math.round(S.w * 0.08);
    S.layers = [{
      id: uid(), kind: 'text', role: 'free', name: '텍스트',
      x: pad, y: Math.round(S.h / 2 - size * 0.65), w: S.w - pad * 2,
      text: '텍스트를 입력하세요', size, lh: 1.3, ls: -0.02,
      color: '#ffffff', align: 'center', font: 'Pretendard Bold',
    }];
    return;
  }
  const mainZ = zs.find(z => z.kind === 'text_main');
  const subZs = zs.filter(z => z.kind === 'text_sub');
  const btnZ = zs.find(z => z.kind === 'button');
  const btnTxtZ = btnZ ? subZs.pop() : null;   // 버튼 텍스트존은 서브에서 제외
  const logoZ = zs.find(z => z.kind === 'logo' && !/브랜드BI/.test(z.name));

  // 팝업류의 상단 서브존은 실제로 '로고 또는 텍스트' 자리다
  let topZ = null;
  if (mainZ && subZs.length > 1) { topZ = subZs.shift(); }
  const subZ = subZs[subZs.length - 1] || null;

  const ROLE_NAME = { main: '메인 텍스트', sub: '서브 텍스트', logo: '브랜드 로고 / 텍스트', buttonText: '버튼 텍스트' };
  const mk = (z, role, txt, fkey) => {
    const f = (sp.fonts && sp.fonts[fkey]) || {};
    const lines = f.lines || f.lines_max || 1;
    const h = z.r[3] - z.r[1];
    const size = f.size_pt || Math.max(14, Math.round(h / lines * 0.78));
    const x = Math.round(z.r[0]);
    // 존 좌표는 PSD 예시 문구가 놓인 자리일 뿐이다. text_x_range 가 있으면
    // 그 상한까지가 실제 허용 폭이므로 상자를 거기까지 넓혀 준다.
    const w = (sp.text_x_range && ['main', 'sub'].includes(role))
      ? sp.text_x_range[1] - x : Math.round(z.r[2] - z.r[0]);
    return {
      id: uid(), kind: 'text', role, name: ROLE_NAME[role] || z.name.replace(/\s*\(.*$/, ''),
      x, y: Math.round(z.r[1]), w,
      text: txt, size, lh: 1.3, ls: -0.02, color: '#ffffff',
      align: z.align === 'center' ? 'center' : 'left',
      font: f.family || (role === 'logo' ? 'Pretendard Bold' : 'Pretendard Regular'), zone: z.name,
    };
  };
  // 규격의 고정 줄 수에 맞춰 자리표시 문구를 만든다 (1줄 고정인데 2줄을 깔면 바로 반려가 뜬다)
  const mainLines = (sp.fonts && sp.fonts.main && (sp.fonts.main.lines || sp.fonts.main.lines_max)) || 1;
  const mainTxt = Array.from({ length: Math.min(mainLines, 3) },
    (_, i) => mainLines === 1 ? '메인 카피를 입력하세요' : `메인 카피 ${['첫째', '둘째', '셋째'][i]} 줄`).join('\n');

  if (topZ) L.push(mk(topZ, 'logo', '브랜드명', 'logo_text'));
  if (logoZ) L.push(mk(logoZ, 'logo', '브랜드명', 'logo_text'));
  if (mainZ) L.push(mk(mainZ, 'main', mainTxt, 'main'));
  if (subZ) L.push(mk(subZ, 'sub', '여기에 서브 카피를 입력하세요', 'sub'));

  // 스플래시는 텍스트 존이 없다 — 상단 '브랜드 표현 영역' 안에 기본 카피를 깔아준다
  if (!mainZ) {
    const brand = zs.find(z => /브랜드 표현/.test(z.name)) || { r: [0, 0, S.w, S.h / 2] };
    const pad = Math.round(S.w * 0.08);
    const mkFree = (role, txt, fkey, top, size) => ({
      id: uid(), kind: 'text', role, name: ROLE_NAME[role],
      x: pad, y: Math.round(top), w: S.w - pad * 2, text: txt, size: Math.round(size),
      lh: 1.3, ls: -0.02, color: '#ffffff', align: 'center',
      font: (sp.fonts && sp.fonts[fkey] && sp.fonts[fkey].family) || (fkey === 'main' ? 'S-core Dream 6Bold' : 'Pretendard Regular'),
    });
    const bh = brand.r[3] - brand.r[1];
    L.push(mkFree('main', mainLines === 1 ? '메인 카피를 입력하세요' : '메인 카피 첫째 줄\n메인 카피 둘째 줄', 'main', brand.r[1] + bh * 0.34, S.w / 15));
    L.push(mkFree('sub', '여기에 서브 카피를 입력하세요', 'sub', brand.r[1] + bh * 0.72, S.w / 27));
  }

  if (btnZ) {
    L.push({
      id: uid(), kind: 'rect', role: 'button', name: '랜딩 버튼',
      x: btnZ.r[0], y: btnZ.r[1], w: btnZ.r[2] - btnZ.r[0], h: btnZ.r[3] - btnZ.r[1],
      fill: '#ffffff', radius: 12,
    });
    const bz = btnTxtZ || { r: [btnZ.r[0], btnZ.r[1] + 45, btnZ.r[2], btnZ.r[3] - 45], name: '버튼 텍스트' };
    const t = mk(bz, 'buttonText', '혜택 확인하기', 'button');
    t.align = 'center'; t.color = '#111111'; t.size = 40;
    t.x = btnZ.r[0]; t.w = btnZ.r[2] - btnZ.r[0];
    t.y = Math.round(btnZ.r[1] + (btnZ.r[3] - btnZ.r[1] - 40) / 2);
    L.push(t);
  }

  S.layers = L;

  // 이주의 브랜드BI — 공식 템플릿 렌더에서 잘라 쓴다 (사이즈·위치 고정)
  if (sp.bi_rect_px) {
    try {
      const bi = await makeBI(S.type, sp.bi_rect_px);
      const [x0, y0, x1, y1] = sp.bi_rect_px;
      S.layers.push({
        id: uid(), kind: 'image', role: 'bi', name: '이주의 브랜드BI (고정)',
        src: bi, x: x0, y: y0, w: x1 - x0, h: y1 - y0,
        opacity: 1, white: false, lockX: true, lockSize: true, homeY: y0,
      });
    } catch (e) { console.warn('BI 추출 실패', e); }
  }
}

// full.png 에서 BI 영역만 잘라내고, 템플릿 배경색을 키잉해 투명 PNG 로 만든다
async function makeBI(type, rect) {
  const img = await loadImg('assets/' + type + '_full.png');
  const [x0, y0, x1, y1] = rect, w = x1 - x0, h = y1 - y0;
  const c = el('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, x0, y0, w, h, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h), p = d.data;
  const [br, bg, bb] = [p[0], p[1], p[2]];           // 좌상단 = 템플릿 배경
  for (let i = 0; i < p.length; i += 4) {
    const dist = Math.abs(p[i] - br) + Math.abs(p[i + 1] - bg) + Math.abs(p[i + 2] - bb);
    if (dist < 40) p[i + 3] = 0;
    else if (dist < 110) p[i + 3] = Math.round(p[i + 3] * (dist - 40) / 70);
  }
  x.putImageData(d, 0, 0);
  return c.toDataURL();
}

// ══════════════════════════════════ 렌더 ══════════════════════════════════
const art = $('#art'), ovl = $('#ovl');
const actx = art.getContext('2d'), octx = ovl.getContext('2d');

function wrapText(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    if (para === '') { out.push(''); continue; }
    let line = '';
    for (const tk of (para.match(/\S+\s*/g) || [])) {
      if (line && ctx.measureText(line + tk).width > maxW) { out.push(line.replace(/\s+$/, '')); line = ''; }
      if (ctx.measureText(tk).width > maxW) {            // 한 덩어리가 한 줄보다 길면 글자 단위
        for (const ch of tk) {
          if (line && ctx.measureText(line + ch).width > maxW) { out.push(line.replace(/\s+$/, '')); line = ''; }
          line += ch;
        }
      } else line += tk;
    }
    out.push(line.replace(/\s+$/, ''));
  }
  return out.length ? out : [''];
}

function setTextFont(ctx, l) {
  ctx.font = fontCss(parseFont(l.font), l.size);
  try { ctx.letterSpacing = (l.ls * l.size).toFixed(2) + 'px'; } catch {}
}
// 텍스트 레이어의 실제 렌더 정보 (검수·핸들에서 공용)
function textMetrics(l) {
  setTextFont(actx, l);
  const lines = wrapText(actx, l.text, l.w);
  const lh = l.size * l.lh;
  const widths = lines.map(s => actx.measureText(s).width);
  const maxW = Math.max(0, ...widths);
  let left = l.x;
  if (l.align === 'center') left = l.x + (l.w - maxW) / 2;
  if (l.align === 'right') left = l.x + l.w - maxW;
  return { lines, lh, widths, maxW, h: lines.length * lh, left, right: left + maxW };
}

function drawBg(ctx, st) {
  ctx.save();
  if (st.bg.mode === 'gradient') {
    const a = (st.bg.angle - 90) * Math.PI / 180;
    const cx = st.w / 2, cy = st.h / 2, r = Math.max(st.w, st.h) / 2;
    const g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.addColorStop(0, st.bg.c1); g.addColorStop(1, st.bg.c2);
    ctx.fillStyle = g;
  } else ctx.fillStyle = st.bg.c1;
  ctx.fillRect(0, 0, st.w, st.h);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// 기획안의 크롭 설정 — 원본 대비 비율(0~1)로 저장한다. 없으면 원본 전체
function srcRect(img, l) {
  const c = l.crop;
  if (!c) return [0, 0, img.width, img.height];
  return [c.x * img.width, c.y * img.height, c.w * img.width, c.h * img.height];
}

function drawLayer(ctx, l) {
  ctx.save();
  ctx.globalAlpha = l.opacity == null ? 1 : l.opacity;
  if (l.kind === 'image') {
    const img = imgCache.get(l.src);
    if (img) {
      if (l.radius) { roundRect(ctx, l.x, l.y, l.w, l.h, l.radius); ctx.clip(); }
      ctx.save();
      if (l.flip) { ctx.translate(l.x + l.w, l.y); ctx.scale(-1, 1); ctx.translate(-l.x, -l.y); }
      if (l.white) {           // BI 화이트 버전 — 알파는 살리고 색만 흰색으로
        const t = el('canvas'); t.width = Math.max(1, Math.round(l.w)); t.height = Math.max(1, Math.round(l.h));
        const tx = t.getContext('2d');
        tx.drawImage(img, ...srcRect(img, l), 0, 0, t.width, t.height);
        tx.globalCompositeOperation = 'source-in';
        tx.fillStyle = '#fff'; tx.fillRect(0, 0, t.width, t.height);
        ctx.drawImage(t, l.x, l.y, l.w, l.h);
      } else ctx.drawImage(img, ...srcRect(img, l), l.x, l.y, l.w, l.h);
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(120,130,150,.25)'; ctx.fillRect(l.x, l.y, l.w, l.h);
    }
  } else if (l.kind === 'rect') {
    ctx.fillStyle = l.fill; roundRect(ctx, l.x, l.y, l.w, l.h, l.radius || 0); ctx.fill();
    // 도형도 글자를 담는다 — 도형 높이 안에서 세로 가운데 정렬
    if (l.text && !(editing && editing.l === l)) drawText(ctx, l, l.y + (l.h - textMetrics(l).h) / 2);
  } else if (l.kind === 'text') {
    if (!(editing && editing.l === l)) drawText(ctx, l, l.y);
  }
  ctx.restore();
}

// 텍스트 레이어와 도형 라벨이 같은 코드로 그려진다
function drawText(ctx, l, top) {
  const m = textMetrics(l);
  setTextFont(ctx, l);
  ctx.fillStyle = l.color; ctx.textBaseline = 'top';
  ctx.textAlign = l.align === 'center' ? 'center' : l.align === 'right' ? 'right' : 'left';
  const ax = l.align === 'center' ? l.x + l.w / 2 : l.align === 'right' ? l.x + l.w : l.x;
  m.lines.forEach((s, i) => ctx.fillText(s, ax, top + i * m.lh + (m.lh - l.size) / 2));
}

function renderArt() {
  art.width = S.w; art.height = S.h;
  actx.clearRect(0, 0, S.w, S.h);
  drawBg(actx, S);
  for (const l of S.layers) if (!l.hidden) drawLayer(actx, l);
}

// ── 가이드 오버레이 ──────────────────────────────────────────────────────
function fitGuide(ctx, img, sp) {
  const mode = sp.fit_mode || 'stretch';
  if (mode === 'width_top') {
    const s = S.w / img.width;
    ctx.drawImage(img, 0, 0, S.w, img.height * s);
  } else if (mode === 'anchor_top_bottom') {
    const s = S.w / img.width, topH = 1500 * s, botH = 325 * s;
    ctx.drawImage(img, 0, 0, img.width, 1500, 0, 0, S.w, topH);
    ctx.drawImage(img, 0, img.height - 325, img.width, 325, 0, S.h - botH, S.w, botH);
  } else ctx.drawImage(img, 0, 0, S.w, S.h);
}

const ZC = { text_main: '#3d7eff', text_sub: '#00b8c4', image: '#f2596a', image_max: '#ff9db0', logo: '#b57bff', button: '#35c17b', margin: '#6b7385' };

function renderOverlay() {
  ovl.width = S.w; ovl.height = S.h;
  octx.clearRect(0, 0, S.w, S.h);
  const sp = SPECS[S.type];

  const mode = $('#guideMode').value;
  // '시안' = 템플릿 가이드를 전부 끄고 내가 만든 것만 본다
  if (mode !== 'clean' && $('#tgGuide').classList.contains('on')) {
    octx.save();
    octx.globalAlpha = +$('#guideOp').value / 100;
    if (mode === 'zones' || !sp.has_psd_template) {
      const px = Math.max(1.5, S.w / 500);
      octx.lineWidth = px; octx.setLineDash([px * 4, px * 3]);
      octx.font = `600 ${Math.max(12, S.w / 62)}px Pretendard, sans-serif`;
      octx.textBaseline = 'top';
      for (const z of zonesOf(sp, S.w, S.h)) {
        if (z.kind === 'margin') continue;
        const c = ZC[z.kind] || '#888';
        octx.strokeStyle = c; octx.strokeRect(z.r[0], z.r[1], z.r[2] - z.r[0], z.r[3] - z.r[1]);
        const lb = z.name;
        octx.setLineDash([]);
        const tw = octx.measureText(lb).width, th = S.w / 48;
        octx.fillStyle = c;
        octx.fillRect(z.r[0], Math.max(0, z.r[1] - th - 2), tw + 10, th);
        octx.fillStyle = '#fff';
        octx.fillText(lb, z.r[0] + 5, Math.max(0, z.r[1] - th - 2) + th * 0.16);
        octx.setLineDash([px * 4, px * 3]);
      }
      // 텍스트 우측 끝 허용선
      for (const v of (sp.vlines_px || [])) {
        octx.strokeStyle = '#f0a92e'; octx.beginPath();
        octx.moveTo(v.x, 0); octx.lineTo(v.x, S.h); octx.stroke();
        octx.fillStyle = '#f0a92e'; octx.fillText(v.label, v.x + 4, 4);
      }
      octx.setLineDash([]);
    } else {
      const key = S.type + '_guide';
      const img = guideCache.get(key);
      if (img) fitGuide(octx, img, sp);
      else loadImg('assets/' + key + '.png').then(i => { guideCache.set(key, i); renderOverlay(); }).catch(() => {});
    }
    octx.restore();
  }

  // 선택 핸들
  const l = S.layers.find(x => x.id === sel);
  if (l) {
    const b = bboxOf(l), px = 1.6 / zoom * (S.w / art.clientWidth || 1);
    const u = Math.max(1, S.w / 400);
    octx.save();
    octx.strokeStyle = '#3d7eff'; octx.lineWidth = u * 0.9;
    octx.strokeRect(b.x, b.y, b.w, b.h);
    if (!l.lockSize) {
      octx.fillStyle = '#fff'; octx.strokeStyle = '#3d7eff'; octx.lineWidth = u * 0.7;
      for (const [hx, hy] of handlePts(b)) {
        octx.beginPath(); octx.rect(hx - u * 3, hy - u * 3, u * 6, u * 6); octx.fill(); octx.stroke();
      }
    }
    octx.restore();
  }
}
function bboxOf(l) {
  if (l.kind === 'text') { const m = textMetrics(l); return { x: l.x, y: l.y, w: l.w, h: Math.max(m.h, l.size) }; }
  return { x: l.x, y: l.y, w: l.w, h: l.h };
}
const HKEYS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
function handlePts(b) {
  return [[b.x, b.y], [b.x + b.w / 2, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h / 2],
  [b.x + b.w, b.y + b.h], [b.x + b.w / 2, b.y + b.h], [b.x, b.y + b.h], [b.x, b.y + b.h / 2]];
}

function render() { renderArt(); renderOverlay(); layoutStage(); }

function layoutStage() {
  if (!S) return;                                 // 상태보다 resize 가 먼저 닿는 순간이 있다
  const stage = $('#stage'), wrap = $('#wrap');
  if (autoFit) {
    // stage 는 위쪽에 툴바 높이만큼 패딩이 더 붙어 있다 — 실제 여백을 그대로 뺀다
    const cs = getComputedStyle(stage);
    const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    zoom = Math.min(availW / S.w, availH / S.h, 1);
  }
  zoom = clamp(zoom, .04, 4);
  wrap.style.width = S.w * zoom + 'px';
  wrap.style.height = S.h * zoom + 'px';
  $('#zoomLbl').textContent = Math.round(zoom * 100) + '%';
}

// ══════════════════════════════════ 검수 ══════════════════════════════════
const EMOJI = /\p{Extended_Pictographic}/u;
const SYMS = /[★☆♥♡♠♣◆◇■□●○▲▼◀▶※→←↑↓⇒♪♬✓✔✕✖◈☞☜]/u;
const CARET = /\^\^|\^_\^|ㅠㅠ|ㅜㅜ/;

let lastKB = null;

function runChecks() {
  const sp = SPECS[S.type], C = [];
  if (isFree(sp)) return C;                        // 자유 캔버스 — 검수 없음
  const add = (lv, t, m) => C.push({ lv, t, m });
  const zs = zonesOf(sp, S.w, S.h);
  const texts = S.layers.filter(l => l.kind === 'text');
  // 도형 라벨도 글자다 — 특수기호 검사에 함께 넣는다
  const allCopy = S.layers.filter(l => (l.kind === 'text' || l.kind === 'rect') && l.text && !l.hidden);
  const imgs = S.layers.filter(l => l.kind === 'image' && l.role !== 'bi');

  // 1. 캔버스 규격
  if (sp.canvas && sp.canvas[0] && sp.canvas[1]) {
    const okc = S.w === sp.canvas[0] && S.h === sp.canvas[1];
    add(okc ? 'ok' : 'bad', '캔버스 규격',
      `${S.w}×${S.h}px — 규격 ${sp.canvas[0]}×${sp.canvas[1]}px ${okc ? '일치' : '불일치'}`);
  } else if (sp.canvas && sp.canvas[0] === 1000) {           // 상세페이지
    const wOk = S.w === 1000, hMax = (sp.canvas_max && sp.canvas_max[1]) || 6000;
    add(wOk ? 'ok' : 'bad', '가로 규격', `${S.w}px — 1000px 고정 ${wOk ? '준수' : '위반'}`);
    const over = S.h > hMax;
    add(over ? (sp.canvas_max_note ? 'warn' : 'bad') : 'ok', '세로 길이',
      `${S.h}px / 최대 ${hMax}px${over ? ' 초과' : ''}${over && sp.canvas_max_note ? ' — Ver.2026.02는 “이하 권장”이라 담당자 확인 필요' : ''}`);
    if (S.h < 1825) add('warn', '세로 길이', `${S.h}px — 고정 구조(상단 1500 + 하단 325 = 1825px)보다 짧습니다`);
  } else if (sp.ratio_range) {                                // 스플래시
    const r = S.h / S.w, [lo, hi] = sp.ratio_range, okr = r >= lo - .001 && r <= hi + .001;
    add(okr ? 'ok' : 'bad', '종횡비', `1:${r.toFixed(2)} — 허용 1:${lo}~1:${hi} ${okr ? '충족' : '위반'}`);
    const mn = sp.min_size || [500, 500], okm = S.w >= mn[0] && S.h >= mn[1];
    add(okm ? 'ok' : 'bad', '최소 사이즈', `${S.w}×${S.h}px — 최소 ${mn[0]}×${mn[1]}px ${okm ? '충족' : '미달'}`);
  }

  // 2. 배경
  if (sp.bg_solid_only && S.bg.mode === 'gradient') {
    add('bad', '배경 구성', '단색만 허용됩니다 — 형광·그라데이션 컬러 사용 불가');
  }
  if (sp.bg_no_white) {
    const chk = c => { const [h, s, l] = rgbToHsl(...hexToRgb(c)); return { l, s }; };
    const cs = S.bg.mode === 'gradient' ? [S.bg.c1, S.bg.c2] : [S.bg.c1];
    const hit = cs.filter(c => { const { l, s } = chk(c); return l >= .90 && s <= .18; });
    const near = cs.filter(c => { const { l, s } = chk(c); return l >= .84 && l < .90 && s <= .18; });
    if (hit.length) add('bad', '배경 컬러', `${hit.join(', ')} — 앱 UI와 겹치는 흰색·연한 그레이는 사용 불가`);
    else if (near.length) add('warn', '배경 컬러', `${near.join(', ')} — 흰색에 가까워 UI와 구분이 약할 수 있습니다`);
    else add('ok', '배경 컬러', S.bg.c1 + ' — 흰색·연그레이 회피 확인');
  }

  // 3. 텍스트 줄 수
  for (const role of ['main', 'sub']) {
    const f = sp.fonts && sp.fonts[role]; if (!f) continue;
    const l = texts.find(t => t.role === role); if (!l) continue;
    const m = textMetrics(l);
    const n = m.lines.filter(s => s !== '').length;
    const label = role === 'main' ? '메인 텍스트' : '서브 텍스트';
    if (f.lines_max != null) {
      add(n > f.lines_max ? 'bad' : 'ok', label + ' 줄 수', `${n}줄 — 최대 ${f.lines_max}줄`);
    } else if (f.lines != null) {
      if (f.lines_fixed) add(n === f.lines ? 'ok' : n > f.lines ? 'bad' : 'warn', label + ' 줄 수',
        `${n}줄 — ${f.lines}줄 고정 규격${n > f.lines ? ' 초과' : n < f.lines ? ' 미달(빈 줄 발생)' : ''}`);
      else add(n > f.lines ? 'warn' : 'ok', label + ' 줄 수', `${n}줄 — 권장 ${f.lines}줄 이내`);
    }
    // 글자 수 (이주의 브랜드 팝업)
    if (f.chars_per_line) {
      const over = m.lines.filter(s => s.replace(/\s/g, '').length > 15);
      if (over.length) add('warn', label + ' 글자 수', `줄당 15자 내외 권장 — ${over.length}개 줄이 초과`);
    }
    if (f.chars) {
      const n2 = l.text.replace(/\s/g, '').length;
      add(n2 > 20 ? 'warn' : 'ok', label + ' 글자 수', `${n2}자 (공백 제외) — 20자 내외 권장`);
    }
    // 지정 서체
    const want = parseFont(f.family), got = parseFont(l.font);
    if (want.family !== got.family || want.weight !== got.weight) {
      add(sp.fonts_note ? 'warn' : 'warn', label + ' 서체', `규격 서체는 ${f.family} 입니다 (현재 ${l.font})`);
    }
  }

  // 4. 특수문자·이모지
  for (const l of allCopy) {
    if (EMOJI.test(l.text) || SYMS.test(l.text) || CARET.test(l.text)) {
      add('bad', '특수기호 사용', `“${l.name}” — 컴퓨터 자판 외 특수기호·이모티콘은 사용 불가 (^^ / ★ / ♥ / ※)`);
    }
  }

  // 5. 텍스트 우측 끝 허용 범위
  if (sp.text_x_range) {
    const [lo, hi] = sp.text_x_range;
    for (const l of texts.filter(t => ['main', 'sub'].includes(t.role))) {
      const r = Math.round(textMetrics(l).right);
      const nm = `${l.role === 'main' ? '메인' : '서브'} 텍스트 위치`;
      // 상한 초과는 오브젝트 이미지 영역을 침범하므로 반려, 하한 미달은 레이아웃 확인 사항
      if (r > hi) add('bad', nm, `우측 끝 ${r}px — 허용 ${lo}~${hi}px 초과, 오브젝트 이미지 영역을 침범합니다`);
      else if (r < lo) add('warn', nm, `우측 끝 ${r}px — 가이드 하한 ${lo}px 에 못 미칩니다 (카피가 짧아 여백이 큽니다)`);
      else add('ok', nm, `우측 끝 ${r}px — 허용 ${lo}~${hi}px 이내`);
    }
  }

  // 6. 텍스트-배경 대비
  const bgRef = S.bg.mode === 'gradient' ? S.bg.c1 : S.bg.c1;
  for (const l of texts.filter(t => ['main', 'sub'].includes(t.role))) {
    const cr = contrast(l.color, bgRef);
    if (cr < 3) add('warn', '텍스트 가독성', `“${l.name}” 대비 ${cr.toFixed(1)}:1 — 배경과 대비가 약합니다 (3:1 이상 권장)`);
  }

  // 7. 이미지 배치
  const maxZ = zs.find(z => z.kind === 'image_max');
  const txtZs = zs.filter(z => z.kind === 'text_main' || z.kind === 'text_sub');
  for (const im of imgs) {
    if (maxZ) {
      const out = im.x < maxZ.r[0] - 1 || im.y < maxZ.r[1] - 1 || im.x + im.w > maxZ.r[2] + 1 || im.y + im.h > maxZ.r[3] + 1;
      if (out) add('warn', '오브젝트 이미지 영역', `“${im.name}” — 최대 영역(${maxZ.r.map(Math.round).join(',')}) 밖으로 나갔습니다`);
    }
    for (const z of txtZs) {
      const hitz = im.x < z.r[2] && im.x + im.w > z.r[0] && im.y < z.r[3] && im.y + im.h > z.r[1];
      if (hitz) { add('warn', '이미지·텍스트 겹침', `“${im.name}” 이 ${z.name} 과 겹칩니다`); break; }
    }
    if (im.x < 0 || im.y < 0 || im.x + im.w > S.w || im.y + im.h > S.h) {
      add('warn', '캔버스 이탈', `“${im.name}” 일부가 캔버스 밖으로 잘립니다`);
    }
  }

  // 8. 필수 요소
  if (sp.logo_required) {
    const has = S.layers.some(l => l.role === 'logo' && !l.hidden && (l.kind !== 'text' || l.text.trim()));
    add(has ? 'ok' : 'bad', '브랜드 로고', has ? '상단 로고/텍스트 확인' : '(필수) 상단 브랜드 로고 또는 텍스트 표기가 없습니다');
  }
  if (sp.bi_rect_px) {
    const bi = S.layers.find(l => l.role === 'bi' && !l.hidden);
    if (!bi) add('bad', '이주의 브랜드BI', '우측 상단 BI 필수 적용 — 레이어가 없습니다');
    else {
      const [x0, y0, x1, y1] = sp.bi_rect_px;
      const sizeOk = Math.abs(bi.w - (x1 - x0)) < 1 && Math.abs(bi.h - (y1 - y0)) < 1 && Math.abs(bi.x - x0) < 1;
      add(sizeOk ? 'ok' : 'bad', '이주의 브랜드BI',
        sizeOk ? `${x1 - x0}×${y1 - y0}px 고정 규격 준수 (y=${Math.round(bi.y)})` : '사이즈·좌우 위치가 고정 규격과 다릅니다');
      if (sizeOk && Math.abs(bi.y - y0) > 1) add('warn', '이주의 브랜드BI', `상하 위치 ${Math.round(bi.y)}px (PSD 기준 ${y0}px) — 상하 조정은 허용되나 확인 필요`);
    }
  }
  if (sp.landing_button_required) {
    const b = S.layers.find(l => l.role === 'button' && !l.hidden);
    add(b ? 'ok' : 'bad', '랜딩 버튼', b ? '하단 고정 버튼 확인' : '랜딩 버튼 필수 — 하단 135px 고정 영역에 버튼이 없습니다');
    const bt = S.layers.find(l => l.role === 'buttonText');
    if (bt && sp.cta_note && !/보기|확인|자세히|알아보|받기/.test(bt.text)) {
      add('warn', 'CTA 문구', `“${bt.text}” — ‘자세히 보기 / 혜택 확인하기’ 등 정보 탐색형 문구 권장`);
    }
  }
  // 상세페이지 좌우 여백 80px
  if (sp.side_margin_px) {
    const m = sp.side_margin_px;
    const bad = S.layers.filter(l => l.kind === 'text' && (l.x < m - 1 || l.x + l.w > S.w - m + 1));
    if (bad.length) add('bad', '좌우 여백', `${m}px 고정 — ${bad.map(b => '“' + b.name + '”').join(', ')} 이 여백을 침범합니다`);
    else add('ok', '좌우 여백', m + 'px 고정 준수');
  }

  // 9. 용량
  if (lastKB != null) {
    const over = lastKB > sp.max_kb;
    const rec = sp.recommended_kb;
    add(over ? 'bad' : (rec && lastKB > rec ? 'warn' : 'ok'), '파일 용량',
      `약 ${lastKB.toLocaleString()}KB — 상한 ${sp.max_kb.toLocaleString()}KB${rec ? ` (권장 ${rec.toLocaleString()}KB)` : ''}`);
  }

  return C;
}

function paintChecks() {
  if (isFree(SPECS[S.type])) {
    $('#verdict').className = 'ok';
    $('#verdict').innerHTML = '검수 없음<span class="cnt">자유 캔버스는 규격 검수를 하지 않습니다</span>';
    $('#checks').innerHTML = '';
    return;
  }
  const C = runChecks();
  const bad = C.filter(c => c.lv === 'bad').length, warn = C.filter(c => c.lv === 'warn').length;
  const v = $('#verdict');
  v.className = bad ? 'bad' : warn ? 'warn' : 'ok';
  v.innerHTML = (bad ? '반려' : warn ? '조건부 승인' : '승인') +
    `<span class="cnt">반려 ${bad} · 확인 ${warn} · 통과 ${C.length - bad - warn}</span>`;
  const box = $('#checks'); box.innerHTML = '';
  const order = { bad: 0, warn: 1, ok: 2 };
  for (const c of C.sort((a, b) => order[a.lv] - order[b.lv])) {
    const d = el('div', 'chk ' + c.lv);
    d.innerHTML = `<span class="badge">${c.lv === 'bad' ? '반려' : c.lv === 'warn' ? '확인' : '통과'}</span>
      <span class="m"><b>${esc(c.t)}</b><span>${esc(c.m)}</span></span>`;
    box.appendChild(d);
  }
  const t = document.querySelector('.tb[data-tab=check]');
  t.textContent = bad ? `검수 ⚠${bad}` : warn ? `검수 ${warn}` : '검수 ✓';
}

// 용량은 실제 인코딩해서 잰다 (디바운스)
let kbT;
function measureKB() {
  clearTimeout(kbT);
  kbT = setTimeout(() => {
    art.toBlob(b => { if (b) { lastKB = Math.round(b.size / 1024); paintChecks(); } }, 'image/png');
  }, 400);
}

// ══════════════════════════════════ 패널 ══════════════════════════════════
// 자유 캔버스면 검수·규정 탭과 가이드 도구를 감추고, 사이즈 프리셋을 보여준다
function syncFreeUI(sp) {
  const free = isFree(sp);
  for (const k of ['check', 'rule']) {
    const tb = document.querySelector(`.tb[data-tab=${k}]`);
    tb.style.display = free ? 'none' : '';
    if (free && tb.classList.contains('on')) document.querySelector('.tb[data-tab=prop]').click();
  }
  $('#freeSizeRow').style.display = free ? '' : 'none';
  $('#freeSizeHint').style.display = free ? '' : 'none';
  for (const id of ['#tgGuide', '#guideMode', '#guideOp']) $(id).style.display = free ? 'none' : '';
}

function paintSpecInfo() {
  const sp = SPECS[S.type];
  syncFreeUI(sp);
  if (isFree(sp)) {
    $('#specInfo').innerHTML = [['노출 위치', sp.placement], ['캔버스', `${S.w}×${S.h}px (자유)`],
      ['포맷', (sp.formats || []).join(' / ')], ['규정 · 검수', '없음']]
      .map(([k, v]) => `<div class="kv"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('');
    $('#verTag').textContent = '자유 캔버스 · 규정 없음';
    $('#rules').innerHTML = ''; $('#zoneList').innerHTML = '';
    return;
  }
  const rows = [
    ['트랙', sp.track || '-'],
    ['가이드', sp.guideline_version || '-'],
    ['노출 위치', sp.placement || '-'],
    ['규격', sp.canvas && sp.canvas[1] ? `${sp.canvas[0]}×${sp.canvas[1]}px`
      : sp.canvas ? `${sp.canvas[0]}×가변` : (sp.ratio_rule || '-').split('.')[0]],
    ['포맷', (sp.formats || []).join(' / ')],
    ['용량', `${sp.max_kb >= 1024 ? (sp.max_kb / 1024) + 'MB' : sp.max_kb + 'KB'} 이하`],
  ];
  $('#specInfo').innerHTML = rows.map(([k, v]) => `<div class="kv"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('');
  $('#verTag').textContent = `${sp.track || ''} · ${sp.guideline_version || ''}`;

  $('#rules').innerHTML = (sp.rules || []).map(r => `<li>${esc(r)}</li>`).join('') +
    (sp.note ? `<li style="color:var(--warn)">${esc(sp.note)}</li>` : '') +
    (sp.image_zone_policy ? `<li style="color:var(--fg3)">${esc(sp.image_zone_policy)}</li>` : '');

  $('#zoneList').innerHTML = zonesOf(sp, S.w, S.h).map(z =>
    `<div style="padding:3px 0;border-bottom:1px solid var(--line)">
      <span style="color:${ZC[z.kind] || '#888'}">■</span> ${esc(z.name)}<br>
      <span style="color:var(--fg3)">[${z.r.map(v => Math.round(v)).join(', ')}] · ${Math.round(z.r[2] - z.r[0])}×${Math.round(z.r[3] - z.r[1])}</span>
      ${z.zone_note ? `<br><span style="color:var(--warn);font-size:10px">${esc(z.zone_note)}</span>` : ''}
    </div>`).join('') || '<span class="hint">좌표 데이터 없음</span>';
}

function paintLayers() {
  const box = $('#layers'); box.innerHTML = '';
  [...S.layers].reverse().forEach(l => {
    const d = el('div', 'layer' + (l.id === sel ? ' sel' : '') + (l.lockSize ? ' locked' : ''));
    const ic = l.kind === 'text' ? 'T' : l.kind === 'rect' ? '▭' : '▣';
    d.innerHTML = `<span class="ic">${ic}</span><span class="nm">${esc(l.name || l.kind)}</span>` +
      `<span class="lk">${l.hidden ? '숨김' : ''}${l.lockSize ? ' 고정' : ''}</span>`;
    d.onclick = () => { sel = l.id; paintLayers(); paintProps(); renderOverlay(); };
    box.appendChild(d);
  });
}

function paintProps() {
  const box = $('#props');
  const l = S.layers.find(x => x.id === sel);
  if (!l) { box.innerHTML = '<p class="hint">캔버스에서 레이어를 선택하세요.</p>'; return; }
  const num = (lb, k, st = 1) => `<div class="row"><label>${lb}</label><input type="number" step="${st}" data-k="${k}" value="${Math.round((l[k] || 0) * 100) / 100}" class="grow"></div>`;
  let h = `<div class="row"><label>이름</label><input type="text" data-k="name" value="${esc(l.name || '')}" class="grow"></div>`;

  if (l.kind === 'text') {
    const m = textMetrics(l);
    h += `<div class="row wide"><label>내용 (Enter = 줄바꿈)</label><textarea data-k="text">${esc(l.text)}</textarea></div>`;
    h += `<div class="row"><label>서체</label><select data-k="font" class="grow">` +
      ['Pretendard Thin', 'Pretendard Light', 'Pretendard Regular', 'Pretendard Medium', 'Pretendard SemiBold', 'Pretendard Bold', 'Pretendard ExtraBold', 'Pretendard Black',
        'S-core Dream 3Light', 'S-core Dream 4Regular', 'S-core Dream 5Medium', 'S-core Dream 6Bold', 'S-core Dream 7ExtraBold', 'S-core Dream 8Heavy', 'S-core Dream 9Black']
        .map(f => `<option${f === l.font ? ' selected' : ''}>${f}</option>`).join('') + '</select></div>';
    h += `<div class="row"><label>크기</label><input type="number" data-k="size" value="${l.size}" class="grow">
          <label style="flex:0 0 34px">색</label><input type="color" data-k="color" value="${l.color}"></div>`;
    h += `<div class="row"><label>정렬</label><select data-k="align" class="grow">` +
      [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']].map(([v, n]) => `<option value="${v}"${v === l.align ? ' selected' : ''}>${n}</option>`).join('') + '</select></div>';
    h += `<div class="row"><label>행간</label><input type="number" step="0.05" data-k="lh" value="${l.lh}" class="grow">
          <label style="flex:0 0 34px">자간</label><input type="number" step="0.01" data-k="ls" value="${l.ls}" class="grow"></div>`;
    h += num('X', 'x') + num('Y', 'y') + num('상자 폭', 'w');
    h += `<p class="hint">${m.lines.filter(s => s !== '').length}줄 · 실제 폭 ${Math.round(m.maxW)}px · 우측 끝 ${Math.round(m.right)}px · 높이 ${Math.round(m.h)}px</p>`;
  } else if (l.kind === 'image') {
    h += num('X', 'x') + num('Y', 'y') + num('폭', 'w') + num('높이', 'h');
    h += `<div class="row"><label>모서리</label><input type="number" data-k="radius" value="${l.radius || 0}" class="grow"></div>`;
    h += `<div class="row"><label>투명도</label><input type="range" min="0" max="1" step="0.01" data-k="opacity" value="${l.opacity == null ? 1 : l.opacity}" class="grow"></div>`;
    h += `<div class="row"><label>옵션</label><label class="hint"><input type="checkbox" data-k="flip" ${l.flip ? 'checked' : ''}> 좌우반전</label>`;
    if (l.role === 'bi') h += `<label class="hint"><input type="checkbox" data-k="white" ${l.white ? 'checked' : ''}> 화이트</label>`;
    h += `</div>`;
    if (l.role !== 'bi') h += `<div class="row"><button class="btn sm grow" data-act="fitZone">${isFree(SPECS[S.type]) ? '캔버스에 맞추기' : '권장 영역에 맞추기'}</button><button class="btn sm grow" data-act="fitRatio">원본 비율</button></div>`;
    if (l.assetId) h += `<p class="hint">라이브러리 에셋 <b class="mono">${esc(l.assetId)}</b>${l.slot ? ' · 슬롯 ' + esc(l.slot) : ''}${l.crop ? ' · 크롭 적용' : ''}</p>`;
    else if (l.role !== 'bi') h += `<p class="hint">브라우저 보관함 이미지 — 라이브러리에 등록되지 않아 기획안에는 저장되지 않습니다.</p>`;
    if (l.role === 'bi') h += `<p class="hint">BI 는 사이즈·좌우 위치 고정입니다. 상하(Y)만 조정할 수 있습니다.</p>`;
  } else if (l.kind === 'rect') {
    h += num('X', 'x') + num('Y', 'y') + num('폭', 'w') + num('높이', 'h');
    h += `<div class="row"><label>채움</label><input type="color" data-k="fill" value="${l.fill}"><input type="text" data-k="fill" value="${l.fill}" class="grow mono"></div>`;
    h += `<div class="row"><label>모서리</label><input type="number" data-k="radius" value="${l.radius || 0}" class="grow"></div>`;
    h += `<div class="row wide"><label>글자 (도형을 더블클릭해도 입력됩니다)</label><textarea data-k="text">${esc(l.text || '')}</textarea></div>`;
    h += `<div class="row"><label>서체</label><select data-k="font" class="grow">` +
      ['Pretendard Regular', 'Pretendard Medium', 'Pretendard SemiBold', 'Pretendard Bold', 'Pretendard ExtraBold',
        'S-core Dream 5Medium', 'S-core Dream 6Bold', 'S-core Dream 7ExtraBold']
        .map(f => `<option${f === l.font ? ' selected' : ''}>${f}</option>`).join('') + '</select></div>';
    h += `<div class="row"><label>크기</label><input type="number" data-k="size" value="${l.size || 40}" class="grow">
          <label style="flex:0 0 34px">색</label><input type="color" data-k="color" value="${l.color || '#111111'}"></div>`;
    h += `<div class="row"><label>정렬</label><select data-k="align" class="grow">` +
      [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']].map(([v, n]) => `<option value="${v}"${v === l.align ? ' selected' : ''}>${n}</option>`).join('') + '</select></div>';
  }
  if (l.kind === 'text' || l.kind === 'rect') {
    h += `<div class="row"><button class="btn sm grow" data-act="edit">캔버스에서 글자 입력</button></div>`;
  }
  h += `<div class="row" style="margin-top:9px">
      <button class="btn sm grow" data-act="up">위로</button>
      <button class="btn sm grow" data-act="down">아래로</button>
      <button class="btn sm grow" data-act="dup">복제</button>
      <button class="btn sm grow danger" data-act="del">삭제</button></div>`;
  box.innerHTML = h;

  box.querySelectorAll('[data-k]').forEach(inp => {
    const k = inp.dataset.k;
    const ev = (inp.type === 'range' || inp.type === 'color') ? 'input' : 'change';
    inp.addEventListener(ev, () => {
      if (l.role === 'bi' && ['x', 'w', 'h'].includes(k)) { toast('BI 는 사이즈·좌우 위치가 고정입니다', true); paintProps(); return; }
      let v = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' || inp.type === 'range' ? +inp.value : inp.value;
      l[k] = v; push(); render(); paintChecks(); measureKB();
      if (['text', 'size', 'w', 'font', 'lh', 'ls', 'align'].includes(k)) paintProps();
      if (k === 'name') paintLayers();
    });
    if (inp.tagName === 'TEXTAREA') inp.addEventListener('input', () => { l.text = inp.value; render(); paintChecks(); });
  });
  box.querySelectorAll('[data-act]').forEach(b => b.onclick = () => layerAct(b.dataset.act, l));
}

function layerAct(a, l) {
  const i = S.layers.indexOf(l);
  if (a === 'edit') { startEdit(l); return; }
  if (a === 'del') { S.layers.splice(i, 1); sel = null; }
  if (a === 'dup') { const c = { ...l, id: uid(), x: l.x + 20, y: l.y + 20, name: l.name + ' 사본' }; S.layers.splice(i + 1, 0, c); sel = c.id; }
  if (a === 'up' && i < S.layers.length - 1) S.layers.splice(i + 1, 0, S.layers.splice(i, 1)[0]);
  if (a === 'down' && i > 0) S.layers.splice(i - 1, 0, S.layers.splice(i, 1)[0]);
  if (a === 'fitZone') fitToZone(l);
  if (a === 'fitRatio') {
    const im = imgCache.get(l.src);
    if (im) l.h = Math.round(l.w * im.height / im.width);
  }
  push(); render(); paintLayers(); paintProps(); paintChecks(); measureKB();
}

// 이미지 레이어를 규격의 권장 이미지 영역 안에 원본 비율로 맞춘다
function fitToZone(l) {
  const z = isFree(SPECS[S.type]) ? { r: [0, 0, S.w, S.h] }
    : zonesOf(SPECS[S.type], S.w, S.h).find(x => x.kind === 'image');
  if (!z) return;
  const zw = z.r[2] - z.r[0], zh = z.r[3] - z.r[1];
  const im = imgCache.get(l.src), ar = im ? im.width / im.height : l.w / l.h;
  let w = zw, h = w / ar; if (h > zh) { h = zh; w = h * ar; }
  Object.assign(l, { x: Math.round(z.r[0] + (zw - w) / 2), y: Math.round(z.r[1] + (zh - h) / 2), w: Math.round(w), h: Math.round(h) });
}

// ══════════════════════════════════ 캔버스 조작 ══════════════════════════════════
const hit = $('#hit');
let drag = null;

function toCanvas(e) {
  const r = art.getBoundingClientRect();
  return { x: (e.clientX - r.left) / (r.width / S.w), y: (e.clientY - r.top) / (r.height / S.h) };
}
function pickAt(p) {
  for (let i = S.layers.length - 1; i >= 0; i--) {
    const l = S.layers[i]; if (l.hidden) continue;
    const b = bboxOf(l);
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return l;
  }
  return null;
}
function handleAt(p) {
  const l = S.layers.find(x => x.id === sel);
  if (!l || l.lockSize) return null;
  const b = bboxOf(l), tol = Math.max(6, S.w / 90);
  const pts = handlePts(b);
  for (let i = 0; i < pts.length; i++) {
    if (Math.abs(p.x - pts[i][0]) < tol && Math.abs(p.y - pts[i][1]) < tol) return HKEYS[i];
  }
  return null;
}

/* 캔버스 입력은 상태(S)가 만들어진 뒤에만 의미가 있다.
 * 첫 로드 중(규격 JSON 응답 전)에 마우스가 캔버스를 지나가면 toCanvas·handleAt 이
 * S.w / S.layers 를 읽다 터진다 — 움직인 횟수만큼 콘솔에 쌓인다. 여기서 한 번에 막는다. */
const onHit = (type, fn) => hit.addEventListener(type, e => { if (S) fn(e); });

onHit('pointermove', e => {
  if (drag) return;
  const p = toCanvas(e), hk = handleAt(p);
  hit.style.cursor = hk ? ({ n: 'ns', s: 'ns', e: 'ew', w: 'ew', nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw' }[hk] + '-resize')
    : pickAt(p) ? 'move' : 'default';
});

onHit('pointerdown', e => {
  const p = toCanvas(e);
  const hk = handleAt(p);
  if (hk) {
    const l = S.layers.find(x => x.id === sel);
    drag = { mode: 'resize', hk, l, s: { ...l }, p0: p, m0: l.kind === 'text' ? textMetrics(l) : null };
  } else {
    const l = pickAt(p);
    const wasSel = !!l && sel === l.id;                 // 이미 선택돼 있었나
    sel = l ? l.id : null;
    paintLayers(); paintProps();
    if (l) drag = { mode: 'move', l, s: { ...l }, p0: p, reselect: wasSel };
  }
  renderOverlay();
  try { hit.setPointerCapture(e.pointerId); } catch { /* 포인터가 이미 사라진 경우 무시 */ }
});

onHit('pointermove', e => {
  if (!drag) return;
  const p = toCanvas(e), dx = p.x - drag.p0.x, dy = p.y - drag.p0.y, l = drag.l, s = drag.s;
  if (drag.mode === 'move') {
    if (!l.lockX) l.x = Math.round(s.x + dx);
    l.y = Math.round(s.y + dy);
  } else {
    const k = drag.hk;
    if (l.kind === 'text') {
      if (k === 'e') l.w = Math.max(20, Math.round(s.w + dx));
      else if (k === 'w') { l.w = Math.max(20, Math.round(s.w - dx)); l.x = Math.round(s.x + (s.w - l.w)); }
      else { // 코너/상하 → 글자 크기
        const f = Math.max(.15, 1 + (k.includes('n') ? -dy : dy) / Math.max(40, drag.m0.h));
        l.size = Math.max(8, Math.round(s.size * f));
      }
    } else {
      let { x, y, w, h } = s;
      if (k.includes('e')) w = s.w + dx;
      if (k.includes('w')) { w = s.w - dx; x = s.x + dx; }
      if (k.includes('s')) h = s.h + dy;
      if (k.includes('n')) { h = s.h - dy; y = s.y + dy; }
      if (e.shiftKey && k.length === 2) {                 // 비율 유지
        const ar = s.w / s.h;
        if (Math.abs(w / ar) > Math.abs(h)) h = w / ar; else w = h * ar;
        if (k.includes('w')) x = s.x + s.w - w;
        if (k.includes('n')) y = s.y + s.h - h;
      }
      Object.assign(l, { x: Math.round(x), y: Math.round(y), w: Math.round(Math.max(8, w)), h: Math.round(Math.max(8, h)) });
    }
  }
  render(); paintChecks();
});

const endDrag = () => { if (drag) { drag = null; push(); paintProps(); measureKB(); } };
onHit('pointercancel', endDrag);

// ══════════════════════════════════ 캔버스 위에서 바로 글자 넣기 ══════════════════════════════════
// editing = { l, wrap, box, orig }
let editing = null;

// 시딩된 랜딩 버튼만 예외 — 도형(button) + 별도 텍스트(buttonText) 짝으로 짜여 있어서
// 도형에 글자를 또 넣으면 두 겹으로 그려진다. 그 경우에만 짝 텍스트로 넘긴다.
function editTargetFor(l) {
  if (l.kind === 'rect' && l.role === 'button' && !l.text) {
    const pair = S.layers.find(t => t.kind === 'text' && t.role === 'buttonText' && !t.hidden);
    if (pair) return pair;
  }
  return (l.kind === 'text' || l.kind === 'rect') ? l : null;
}

function startEdit(layer) {
  const l = editTargetFor(layer);
  if (!l) return;
  if (editing) commitEdit();
  drag = null;
  sel = l.id;

  const k = $('#wrap').clientWidth / S.w;                    // 캔버스 → 화면 배율
  const box = l.kind === 'rect' ? { x: l.x, y: l.y, w: l.w, h: l.h }
    : { x: l.x, y: l.y, w: l.w, h: Math.max(textMetrics(l).h, l.size) };

  const wrap = el('div', 'inlineEditWrap');
  wrap.style.cssText = `left:${box.x * k}px;top:${box.y * k}px;width:${box.w * k}px;height:${box.h * k}px;` +
    `align-items:${l.kind === 'rect' ? 'center' : 'flex-start'}`;

  const ed = el('div', 'inlineEdit');
  ed.contentEditable = 'plaintext-only';
  if (ed.contentEditable !== 'plaintext-only') ed.contentEditable = 'true'; // 미지원 브라우저 대비
  const f = parseFont(l.font);
  ed.style.cssText = `font:${f.weight} ${l.size * k}px ${f.family},"Malgun Gothic",sans-serif;` +
    `line-height:${l.lh};letter-spacing:${l.ls * l.size * k}px;color:${l.color};text-align:${l.align};` +
    `caret-color:${l.color}`;
  ed.textContent = l.text || '';

  wrap.appendChild(ed);
  $('#wrap').appendChild(wrap);
  editing = { l, wrap, orig: l.text || '' };

  render(); paintLayers(); paintProps();                     // 원본 글자는 숨기고 그린다
  ed.focus();
  if (ed.textContent) {                        // 기존 문구는 전체 선택 — 바로 덮어쓸 수 있게
    const r = document.createRange(); r.selectNodeContents(ed);
    const s2 = getSelection(); s2.removeAllRanges(); s2.addRange(r);
  }

  ed.addEventListener('input', () => {
    l.text = ed.innerText.replace(/\n$/, '');
    if (l.kind !== 'rect') {                                 // 줄이 늘면 편집칸도 같이 늘린다
      wrap.style.height = Math.max(textMetrics(l).h, l.size) * k + 'px';
    }
    render(); paintChecks();
  });
  ed.addEventListener('keydown', e => {
    e.stopPropagation();                                     // 전역 단축키(삭제·방향키) 차단
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitEdit(); }
    else if (e.key === 'Tab') { e.preventDefault(); commitEdit(); }
  });
  ed.addEventListener('blur', () => { if (editing && editing.l === l) commitEdit(); });
}

function closeEdit() {
  if (!editing) return;
  const { wrap } = editing;
  editing = null;                  // remove() 가 blur 를 다시 부르므로 먼저 비운다
  wrap.remove();
  render(); paintLayers(); paintProps(); paintChecks(); measureKB();
}
function commitEdit() {
  if (!editing) return;
  const { l, wrap } = editing;
  const ed = wrap.querySelector('.inlineEdit');
  if (ed) l.text = ed.innerText.replace(/\n$/, '');
  closeEdit(); push();
}
function cancelEdit() {
  if (!editing) return;
  editing.l.text = editing.orig;
  closeEdit();
}

// 편집 중 캔버스 밖을 누르면 확정
document.addEventListener('pointerdown', e => {
  if (editing && !e.target.closest('.inlineEditWrap')) commitEdit();
}, true);

// 더블클릭 = 바로 편집
onHit('dblclick', e => {
  const l = pickAt(toCanvas(e));
  if (l && !l.lockSize) startEdit(l);
});

// 이미 선택된 레이어를 (끌지 않고) 한 번 더 누르면 편집 — 도형 클릭으로 글자 넣기
onHit('pointerup', e => {
  const d = drag;
  endDrag();
  if (!d || d.mode !== 'move') return;
  const moved = Math.abs(d.l.x - d.s.x) > 1 || Math.abs(d.l.y - d.s.y) > 1;
  if (!moved && d.reselect && !d.l.lockSize) startEdit(d.l);
});

document.addEventListener('keydown', e => {
  const ae = document.activeElement, tag = ae && ae.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (editing || (ae && ae.isContentEditable)) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(e.shiftKey); return; }
  const l = S.layers.find(x => x.id === sel);
  if (!l) return;
  // F2 / Enter 로도 편집을 연다
  if ((e.key === 'F2' || e.key === 'Enter') && !l.lockSize) { e.preventDefault(); startEdit(l); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); layerAct('del', l); }
  else if (e.key === 'Escape') { sel = null; paintLayers(); paintProps(); renderOverlay(); }
  else if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft' && !l.lockX) l.x -= d;
    if (e.key === 'ArrowRight' && !l.lockX) l.x += d;
    if (e.key === 'ArrowUp') l.y -= d;
    if (e.key === 'ArrowDown') l.y += d;
    render(); paintProps(); paintChecks();
  }
});

// ══════════════════════════════════ 되돌리기 ══════════════════════════════════
function push() {
  const snap = JSON.stringify({ w: S.w, h: S.h, bg: S.bg, layers: S.layers });
  if (history[hIdx] === snap) return;
  history = history.slice(0, hIdx + 1); history.push(snap); hIdx = history.length - 1;
  if (history.length > 60) { history.shift(); hIdx--; }
}
function undo(redo) {
  closeEdit();
  const i = redo ? hIdx + 1 : hIdx - 1;
  if (i < 0 || i >= history.length) return;
  hIdx = i;
  const d = JSON.parse(history[i]);
  Object.assign(S, d);
  preloadImgs().then(() => { render(); paintLayers(); paintProps(); paintChecks(); });
}

async function preloadImgs() {
  await Promise.all(S.layers.filter(l => l.kind === 'image' && !imgCache.has(l.src))
    .map(l => loadImg(l.src).then(i => imgCache.set(l.src, i)).catch(() => {})));
}

// ══════════════════════════════════ 스톡 보관함 ══════════════════════════════════
// ══════════════════════════════════ 저장소 (IndexedDB) ══════════════════════════════════
// 서버 대신 브라우저 IndexedDB 에 저장한다. 블로그 이미지 제작의 좌측 '스톡 이미지 보관함'도 이 'stock' 스토어를 함께 쓴다.
//   stock    : { id, category, name, src(dataURL), kb, ts }
//   projects : { name, data, ts }
function bsDB() {
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('이 브라우저에서는 IndexedDB 를 쓸 수 없습니다'));
    const q = indexedDB.open('banner_studio', 1);
    q.onupgradeneeded = () => {
      const db = q.result;
      if (!db.objectStoreNames.contains('stock')) db.createObjectStore('stock', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'name' });
    };
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
    q.onblocked = () => rej(new Error('다른 탭에서 배너 스튜디오 DB 를 사용 중입니다. 다른 탭을 닫고 새로고침하세요.'));
  });
}
async function dbDo(store, mode, fn) {
  const db = await bsDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, mode);
    const r = fn(tx.objectStore(store));
    tx.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('저장 중단 (용량 부족일 수 있습니다)'));
  });
}
const dbAll = store => dbDo(store, 'readonly', os => os.getAll());
const dbGet = (store, key) => dbDo(store, 'readonly', os => os.get(key));
const dbPut = (store, v) => dbDo(store, 'readwrite', os => os.put(v));
const dbDel = (store, key) => dbDo(store, 'readwrite', os => os.delete(key));
const fileToDataURL = f => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(f);
});

let stock = [];
let builtinStock = null;   // stock/manifest.json — 저장소에 동봉된 기본 스톡 (삭제 불가)
// 캠페인 에셋 라이브러리 — 기획안이 Asset ID 로 참조하는 이미지 (읽기 전용)
const ROOT = '../';
const LIB_REG = ROOT + 'assets/campaign-library/metadata/assets.json';
let library = { assets: [] };
let libraryStock = [];
async function loadLibrary() {
  library = await fetch(LIB_REG, { cache: 'no-cache' }).then(r => r.ok ? r.json() : { assets: [] }).catch(() => ({ assets: [] }));
  // 라이브러리 이미지는 원본 파일을 그대로 가리킨다 — 보관함이나 배너별로 복제하지 않는다
  libraryStock = (library.assets || []).filter(a => a.reusable !== false).map(a => ({
    rel: a.path, name: a.fileName, category: '라이브러리 · ' + a.category,
    kb: Math.round((a.bytes || 0) / 1024), builtin: true, mtime: 0,
    url: BannerPlans.assetUrl(a, ROOT), assetId: a.assetId, description: a.description,
  }));
}
async function loadStock() {
  if (!builtinStock) {
    const m = await fetch('stock/manifest.json').then(r => r.json()).catch(() => ({ items: [] }));
    builtinStock = (m.items || []).map(i => ({
      ...i, builtin: true, mtime: 0,
      url: 'stock/' + i.rel.split('/').map(encodeURIComponent).join('/'),
    }));
  }
  let mine = [];
  try {
    mine = (await dbAll('stock')).map(i => ({
      id: i.id, rel: i.category + '/' + i.name, name: i.name, category: i.category,
      url: i.src, kb: i.kb, mtime: i.ts,
    }));
  } catch (e) { toast('보관함을 열지 못했습니다 — ' + e.message, true); }
  mine.sort((a, b) => b.mtime - a.mtime);
  // 라이브러리에 등록된 기본 스톡은 라이브러리 항목(Asset ID 있음)으로만 보여준다
  const inLib = new Set(libraryStock.map(i => i.url));
  stock = [...libraryStock, ...mine, ...builtinStock.filter(i => !inLib.has(i.url))];
  const categories = [...new Set(stock.map(i => i.category))].sort();
  $('#stockDir').textContent = '라이브러리 ' + libraryStock.length + '장 · 기본 ' + builtinStock.length + '장 + 내 이미지 ' + mine.length + '장';
  $('#stockCnt').textContent = stock.length + '장';
  const cur = $('#catSel').value;
  $('#catSel').innerHTML = '<option value="">전체 카테고리</option>' +
    categories.map(c => `<option${c === cur ? ' selected' : ''}>${esc(c)}</option>`).join('');
  paintStock();
}
function paintStock() {
  const cat = $('#catSel').value;
  const items = stock.filter(i => !cat || i.category === cat);
  const g = $('#stockGrid'); g.innerHTML = '';
  $('#stockEmpty').style.display = stock.length ? 'none' : 'block';
  for (const it of items) {
    const d = el('div', 'stock');
    d.title = `${it.category} / ${it.name} · ${it.kb}KB${it.assetId ? ' · ' + it.assetId + (it.description ? '\n' + it.description : '') : it.builtin ? ' · 기본 제공' : ''}\n클릭하면 캔버스에 추가`;
    d.innerHTML = `<img src="${esc(it.url)}" loading="lazy">` +
      (it.builtin ? '' : '<span class="del" title="보관함에서 삭제">×</span>');
    d.querySelector('img').onclick = () => addStockImage(it);
    if (!it.builtin) d.querySelector('.del').onclick = async ev => {
      ev.stopPropagation();
      if (!confirm(`보관함에서 삭제합니다.\n\n${it.rel}\n\n이 브라우저 보관함에서 영구 삭제됩니다. 계속할까요?`)) return;
      try { await dbDel('stock', it.id); toast('삭제했습니다'); }
      catch (e) { toast('삭제 실패 — ' + e.message, true); }
      loadStock();
    };
    g.appendChild(d);
  }
}
async function addStockImage(it) {
  const img = await loadImg(it.url).catch(() => null);
  if (!img) return toast('이미지를 불러오지 못했습니다', true);
  imgCache.set(it.url, img);
  const z = zonesOf(SPECS[S.type], S.w, S.h).find(x => x.kind === 'image');
  const box = z ? { x: z.r[0], y: z.r[1], w: z.r[2] - z.r[0], h: z.r[3] - z.r[1] }
    : isFree(SPECS[S.type]) ? { x: S.w * .15, y: S.h * .15, w: S.w * .7, h: S.h * .7 }
    : { x: S.w * .15, y: S.h * .5, w: S.w * .7, h: S.h * .4 };
  const ar = img.width / img.height;
  let w = box.w, h = w / ar; if (h > box.h) { h = box.h; w = h * ar; }
  const l = {
    id: uid(), kind: 'image', role: 'object', name: it.name,
    x: Math.round(box.x + (box.w - w) / 2), y: Math.round(box.y + (box.h - h) / 2),
    w: Math.round(w), h: Math.round(h), src: it.url, opacity: 1, radius: 0,
  };
  if (it.assetId) l.assetId = it.assetId;   // 라이브러리 이미지 — 기획안에는 이 ID 만 저장된다
  // 오브젝트는 텍스트 아래에 깔리지 않도록 텍스트 앞에 넣는다
  const firstText = S.layers.findIndex(x => x.kind === 'text');
  if (firstText >= 0) S.layers.splice(firstText, 0, l); else S.layers.push(l);
  sel = l.id;
  push(); render(); paintLayers(); paintProps(); paintChecks(); measureKB();
}

async function uploadFiles(files, cat) {
  let n = 0;
  for (const f of files) {
    if (!/^image\//.test(f.type) && !/\.(png|jpe?g|gif|webp|svg)$/i.test(f.name)) continue;
    if (f.size > 30 * 1024 * 1024) { toast(`${f.name} — 30MB 를 넘어 건너뜁니다`, true); continue; }
    try {
      await dbPut('stock', {
        category: cat || $('#catSel').value || '기본', name: f.name,
        src: await fileToDataURL(f), kb: Math.round(f.size / 1024), ts: Date.now(),
      });
      n++;
    } catch (e) { toast(`${f.name} 등록 실패 — ${e.message}`, true); }
  }
  if (n) { toast(`${n}장을 보관함에 저장했습니다`); loadStock(); }
}

// ══════════════════════════════════ 외부 붙여넣기 ══════════════════════════════════
// 파일 탐색기·Finder 에서 복사한 이미지 파일, 캡처, 웹에서 '이미지 복사' 한 것을 Ctrl+V 로 바로 캔버스에 넣는다
const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;
function clipImageFiles(dt) {
  const out = [], seen = new Set();
  const take = f => {
    if (!f || !(/^image\//.test(f.type) || IMG_EXT.test(f.name || ''))) return;
    const k = f.name + '|' + f.size + '|' + f.type;
    if (!seen.has(k)) { seen.add(k); out.push(f); }
  };
  for (const f of (dt.files || [])) take(f);                       // 파일 탐색기에서 복사한 파일 (여러 장)
  for (const it of (dt.items || [])) if (it.kind === 'file') take(it.getAsFile());  // 캡처·웹 이미지
  return out;
}
// HTML·텍스트로만 넘어온 이미지 주소 (웹 파일함의 '복사' 등)
function clipImageUrls(dt) {
  const html = dt.getData('text/html') || '', plain = (dt.getData('text/plain') || '').trim();
  const urls = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]);
  if (!urls.length && /^(https?:\/\/\S+\.(png|jpe?g|gif|webp|svg|avif)(\?\S*)?|data:image\/[^\s]+)$/i.test(plain)) urls.push(plain);
  return [...new Set(urls)].filter(u => /^(https?:|data:image\/)/i.test(u));
}
async function urlToFile(u, i) {
  const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status);
  const b = await r.blob(); if (!/^image\//.test(b.type)) throw new Error('이미지가 아닙니다');
  return new File([b], (u.split(/[?#]/)[0].split('/').pop() || `붙여넣은 이미지 ${i + 1}`).slice(0, 80), { type: b.type });
}
async function pasteImages(files) {
  let n = 0;
  for (const [i, f] of files.entries()) {
    if (f.size > 30 * 1024 * 1024) { toast(`${f.name} — 30MB 를 넘어 건너뜁니다`, true); continue; }
    const name = (f.name && f.name !== 'image.png') ? f.name.replace(/\.[^.]+$/, '') : `붙여넣은 이미지 ${i + 1}`;
    await addStockImage({ url: await fileToDataURL(f), name });
    const l = S.layers.find(x => x.id === sel);
    if (l && i) { l.x += 30 * i; l.y += 30 * i; }                    // 여러 장이면 겹치지 않게 살짝 비켜 놓는다
    n++;
  }
  if (n) { push(); render(); paintProps(); toast(`이미지 ${n}장을 붙여넣었습니다`); }
  return n;
}
document.addEventListener('paste', async e => {
  const tg = e.target;
  // 글자 입력칸에서는 원래대로 글자가 붙여넣어지게 둔다 (드롭다운·버튼에 포커스가 있어도 캔버스로 붙는다)
  const typing = tg && tg.matches && (tg.isContentEditable || tg.matches('textarea,input:not([type=range]):not([type=color]):not([type=checkbox]):not([type=file]):not([type=button])'));
  if (!S || editing || typing) return;
  const dt = e.clipboardData; if (!dt) return;
  const files = clipImageFiles(dt);
  if (files.length) { e.preventDefault(); return pasteImages(files); }
  const urls = clipImageUrls(dt);
  if (urls.length) {
    e.preventDefault();
    const got = [];
    for (const [i, u] of urls.entries()) { try { got.push(await urlToFile(u, i)); } catch { } }
    if (got.length) return pasteImages(got);
    return toast('이미지 주소는 복사됐지만 외부 사이트가 접근을 막아 가져오지 못했습니다 — 이미지를 저장한 뒤 파일을 복사해 붙여넣어 주세요', true);
  }
  // 글자만 있으면 텍스트 레이어로 넣는다
  const txt = (dt.getData('text/plain') || '').trim();
  if (txt) {
    e.preventDefault();
    const size = Math.max(12, Math.round(Math.min(S.w, S.h) / 16));
    const l = {
      id: uid(), kind: 'text', role: 'free', name: txt.split('\n')[0].slice(0, 20) || '텍스트',
      x: Math.round(S.w * .1), y: Math.round(S.h * .1), w: Math.round(S.w * .8),
      text: txt, size, lh: 1.3, ls: -0.02, color: '#ffffff', align: 'left', font: 'Pretendard Bold',
    };
    S.layers.push(l); sel = l.id;
    push(); render(); paintLayers(); paintProps(); paintChecks(); measureKB();
    toast('텍스트를 붙여넣었습니다');
  }
});

// ══════════════════════════════════ 저장 / 열기 / 내보내기 ══════════════════════════════════
async function saveProject() {
  commitEdit();
  const name = ($('#projName').value || '').trim();
  if (!name) return toast('프로젝트명을 입력하세요', true);
  const data = JSON.parse(JSON.stringify({ ...S, name, savedAt: new Date().toISOString() }));
  try { await dbPut('projects', { name, data, ts: Date.now() }); toast(`저장했습니다 — ${name} (브라우저 보관함)`); }
  catch (e) { toast('저장 실패 — ' + e.message, true); }
}
async function openProject() {
  commitEdit();
  let items = [];
  try { items = (await dbAll('projects')).sort((a, b) => b.ts - a.ts); }
  catch (e) { return toast('보관함을 열지 못했습니다 — ' + e.message, true); }
  if (!items.length) return toast('저장된 작업이 없습니다', true);
  const list = items.map((i, n) => `${n + 1}. ${i.name}  (${new Date(i.ts).toLocaleString('ko-KR')})`).join('\n');
  const pick = prompt('열 작업의 번호를 입력하세요\n(삭제하려면 번호 앞에 - 를 붙이세요. 예: -2)\n\n' + list, '1');
  if (!pick) return;
  if (/^-\d+$/.test(pick.trim())) {
    const d = items[-pick.trim() - 1]; if (!d) return;
    if (!confirm(`저장본 “${d.name}” 을(를) 영구 삭제할까요?`)) return;
    await dbDel('projects', d.name); return toast('삭제했습니다 — ' + d.name);
  }
  const it = items[+pick - 1]; if (!it) return;
  S = it.data; sel = null;
  curPlan = null; $('#planSel').value = ''; paintPlanMeta();   // 프로젝트 저장본은 기획안과 별개다
  $('#typeSel').value = S.type; $('#projName').value = S.name || it.name;
  await preloadImgs();
  syncCanvasInputs(); paintSpecInfo(); render(); paintLayers(); paintProps(); paintChecks(); measureKB();
  history = []; hIdx = -1; push();
  toast('불러왔습니다 — ' + it.name);
}

async function doExport() {
  commitEdit();                     // 편집 중이면 확정 — 안 하면 그 레이어 글자가 빠진 채 나간다
  const sp = SPECS[S.type];
  const fmt = confirm('PNG 로 내보냅니다.\n\n[확인] PNG   /   [취소] JPG (용량 절감)') ? 'png' : 'jpg';
  sel = null; renderArt();
  const mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
  let q = 0.92, blob = await new Promise(r => art.toBlob(r, mime, q));
  // JPG 는 상한에 맞을 때까지 품질을 낮춘다
  while (fmt === 'jpg' && sp.max_kb && blob.size / 1024 > sp.max_kb && q > 0.4) {
    q -= 0.08; blob = await new Promise(r => art.toBlob(r, mime, q));
  }
  const kb = Math.round(blob.size / 1024);
  lastKB = kb; paintChecks(); renderOverlay();

  const date = new Date().toISOString().slice(0, 10);
  const base = `${date} ${sp.label.replace(/[\\/:*?"<>|]/g, '')}${S.name ? ' - ' + S.name : ''}`;
  const fname = `${base}.${fmt}`;

  if (sp.max_kb && kb > sp.max_kb) {
    if (!confirm(`용량이 상한을 넘습니다.\n\n현재 ${kb.toLocaleString()}KB / 상한 ${sp.max_kb.toLocaleString()}KB\n\n그래도 내보낼까요?`)) return;
  }
  // 정적 버전 — 브라우저 다운로드로 내보낸다
  toast(`다운로드했습니다 — ${fname} (${kb.toLocaleString()}KB)`);
  const a = el('a'); a.href = URL.createObjectURL(blob); a.download = fname;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

// ══════════════════════════════════ 배너 기획안 ══════════════════════════════════
// 저장소의 기획안(읽기 전용) + 이 브라우저에서 고친 수정본('banner_plans' DB). 수정본이 있으면 수정본이 우선이다.
const PLAN_INDEX = ROOT + 'data/banner-plans/index.json';
let planIndex = { plans: [] };
let curPlan = null;          // 지금 캔버스에 열린 기획안 (수정 비교 기준)

function plansDB() {
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('이 브라우저에서는 IndexedDB 를 쓸 수 없습니다'));
    const q = indexedDB.open('banner_plans', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('drafts', { keyPath: 'bannerId' });
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function draftsDo(mode, fn) {
  const db = await plansDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('drafts', mode), r = fn(tx.objectStore('drafts'));
    tx.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
    tx.onerror = () => rej(tx.error);
  });
}
const draftsAll = () => draftsDo('readonly', os => os.getAll()).catch(() => []);
const draftPut = v => draftsDo('readwrite', os => os.put(v));

async function loadPlanList() {
  planIndex = await fetch(PLAN_INDEX, { cache: 'no-cache' }).then(r => r.ok ? r.json() : { plans: [] }).catch(() => ({ plans: [] }));
  const drafts = await draftsAll();
  const rows = new Map(planIndex.plans.map(p => [p.bannerId, { ...p, draft: null }]));
  for (const d of drafts) {
    const r = rows.get(d.bannerId) || { bannerId: d.bannerId, bannerName: d.plan.bannerName, templateId: d.plan.templateId, campaignId: d.plan.campaignId };
    rows.set(d.bannerId, { ...r, draft: d });
  }
  const s = $('#planSel'), cur = s.value;
  s.innerHTML = '<option value="">— 기획안 선택 —</option>' + [...rows.values()].map(r => {
    const lb = SPECS[r.templateId] ? SPECS[r.templateId].label.replace(/^\[이주의 브랜드\]\s*/, '') : r.templateId;
    return `<option value="${esc(r.bannerId)}">${r.draft ? '[수정본] ' : ''}${esc(r.bannerName)} · ${esc(lb)}</option>`;
  }).join('');
  s.value = rows.has(cur) ? cur : '';
  s._rows = rows;
  $('#planInfo').textContent = `저장소 ${planIndex.plans.length}건 · 수정본 ${drafts.length}건`;
}

/* 선택한 배너 → 기획안 조회 → Asset ID 로 이미지 경로 확인 → 컴포넌트에 카피·이미지·배치 적용 → 미리보기 */
async function openPlan(bannerId) {
  const row = $('#planSel')._rows && $('#planSel')._rows.get(bannerId);
  if (!row) return;
  let plan = row.draft ? row.draft.plan : await fetch(ROOT + row.path, { cache: 'no-cache' }).then(r => r.json()).catch(() => null);
  if (!plan) return toast('기획안을 불러오지 못했습니다 — ' + (row.path || bannerId), true);
  if (!SPECS[plan.templateId]) return toast(`알 수 없는 배너 타입 ${plan.templateId} — banner_specs.json 에 없는 템플릿입니다`, true);

  closeEdit();
  S = blankState(plan.templateId);
  await seedLayers();
  const { state, missing } = BannerPlans.applyPlan(S, plan, library, ROOT);
  S = state; sel = null;
  await preloadImgs();
  for (const l of S.layers) if (l.needsFit) { fitToZone(l); delete l.needsFit; }
  // 비교 기준 = 연 직후의 화면 상태. 자동 배치·기본 캔버스 값이 사용자 수정으로 잡히지 않게 한다
  curPlan = { ...BannerPlans.stateToPlan(S, plan).plan, version: plan.version, history: plan.history };
  $('#typeSel').value = S.type; $('#projName').value = plan.bannerName;
  syncCanvasInputs(); paintSpecInfo(); render(); paintLayers(); paintProps(); paintChecks(); measureKB();
  history = []; hIdx = -1; push();
  paintPlanMeta();
  if (missing.length) toast('라이브러리에 없는 Asset ID — ' + missing.join(', '), true);
  else toast(`기획안을 열었습니다 — ${plan.bannerName} v${plan.version}${row.draft ? ' (수정본)' : ''}`);
}

function paintPlanMeta() {
  const p = curPlan;
  $('#planMeta').innerHTML = !p ? '' : [
    ['Banner ID', p.bannerId], ['캠페인', p.campaignId], ['버전', 'v' + p.version],
    ['이미지', BannerPlans.imageSlots(p).map(s => `${s.slot}: ${s.assetId}`).join(', ') || '-'],
    ['기간', p.period ? `${p.period.start || ''} ~ ${p.period.end || ''}` : '-'],
  ].map(([k, v]) => `<div class="kv"><b>${esc(k)}</b><span class="mono">${esc(v)}</span></div>`).join('');
}

/* 바뀐 기획안만 저장한다 — 이미지는 Asset ID·배치만, 파일·dataURL 은 넣지 않는다 */
async function savePlan() {
  commitEdit();
  let base = curPlan;
  if (!base) {
    const bannerId = (prompt('새 기획안의 Banner ID (영문 소문자·숫자·하이픈)', '') || '').trim();
    if (!/^[a-z0-9-]+$/.test(bannerId)) return bannerId && toast('Banner ID 형식이 올바르지 않습니다', true);
    const campaignId = (prompt('캠페인 ID', '') || '').trim();
    if (!/^[a-z0-9-]+$/.test(campaignId)) return campaignId && toast('캠페인 ID 형식이 올바르지 않습니다', true);
    base = { bannerId, campaignId, bannerName: ($('#projName').value || bannerId).trim(), purpose: '', target: '',
      content: {}, assets: {}, designConcept: '', period: { start: null, end: null }, version: 0, history: [] };
  }
  const { plan, unlinked } = BannerPlans.stateToPlan(S, base);
  plan.bannerName = ($('#projName').value || plan.bannerName).trim();
  const next = BannerPlans.nextVersion(curPlan, plan, { by: 'banner-studio' });
  if (!next) return toast('바뀐 내용이 없어 저장하지 않았습니다');
  const errs = BannerPlans.validatePlan(next, library);
  if (errs.length) return toast('기획안 검증 실패 — ' + errs[0], true);
  try { await draftPut({ bannerId: next.bannerId, plan: next, ts: Date.now() }); }
  catch (e) { return toast('수정본 저장 실패 — ' + e.message, true); }
  curPlan = next;
  const a = el('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(next, null, 2)], { type: 'application/json' }));
  a.download = `${next.bannerId}.json`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  await loadPlanList(); $('#planSel').value = next.bannerId; paintPlanMeta();
  const ch = next.history[next.history.length - 1].changed.join(', ');
  toast(`v${next.version} 저장 (변경: ${ch})${unlinked.length ? ` — 라이브러리 밖 이미지 ${unlinked.length}개는 제외됨` : ''}`, !!unlinked.length);
}

// ══════════════════════════════════ 테마 ══════════════════════════════════
// UI 색만 바꾼다. 캔버스 안 배너 색(배경·텍스트)은 작업물 값이라 건드리지 않는다.
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const b = $('#btnTheme');
  b.textContent = t === 'light' ? '☀' : '🌙';
  b.title = t === 'light' ? '라이트 모드 — 눌러서 다크로' : '다크 모드 — 눌러서 라이트로';
  try { localStorage.setItem('bs-theme', t); } catch { /* 시크릿 창 등 */ }
}
function initTheme() {
  let t = null;
  try { t = localStorage.getItem('bs-theme'); } catch {}
  if (t !== 'light' && t !== 'dark') {
    t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  applyTheme(t);
}

// '시안' 을 고르면 가이드 토글·투명도는 의미가 없으므로 비활성화한다
function syncGuideControls() {
  const clean = $('#guideMode').value === 'clean';
  $('#tgGuide').disabled = clean;
  $('#guideOp').disabled = clean;
  $('#tgGuide').style.opacity = clean ? .4 : 1;
  $('#guideOp').style.opacity = clean ? .4 : 1;
}

// ══════════════════════════════════ 초기화 ══════════════════════════════════
function syncCanvasInputs() {
  $('#cw').value = S.w; $('#ch').value = S.h;
  $('#bgMode').value = S.bg.mode;
  $('#bg1').value = S.bg.c1; $('#bg1h').value = S.bg.c1; $('#bg2').value = S.bg.c2;
  $('#bgAngle').value = S.bg.angle; $('#bgAngleV').textContent = S.bg.angle + '°';
  const g = S.bg.mode === 'gradient';
  $('#bg2').style.display = g ? '' : 'none';
  $('#gradRow').style.display = g ? '' : 'none';
  const sp = SPECS[S.type];
  const fixed = !isFree(sp) && !!(sp.canvas && sp.canvas[0] && sp.canvas[1]);
  for (const id of ['#cw', '#ch']) { $(id).min = isFree(sp) ? FREE_MIN : 100; $(id).max = FREE_MAX; }
  $('#cw').disabled = fixed || (sp.canvas && sp.canvas[0] === 1000 && !sp.canvas[1]);
  $('#ch').disabled = fixed;
  $('#bgMode').disabled = !!sp.bg_solid_only;
}

async function switchType(t) {
  closeEdit();               // 레이어가 교체되므로 편집칸을 닫는다
  const keep = S && S.type === t && isFree(SPECS[t]) ? S : null;
  S = blankState(t);
  if (keep) Object.assign(S, { w: keep.w, h: keep.h, bg: { ...keep.bg } });
  sel = null;
  await seedLayers();
  await preloadImgs();
  syncCanvasInputs(); paintSpecInfo(); render(); paintLayers(); paintProps(); paintChecks(); measureKB();
  history = []; hIdx = -1; push();
}

async function boot() {
  initTheme();
  $('#btnTheme').onclick = () =>
    applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  installFonts();
  // 규격은 자주 바뀐다 — 브라우저·CDN 캐시를 거치지 않고 매번 새로 받는다
  SPECS = await fetch('data/banner_specs.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json())
    .catch(() => ({ error: 'data/banner_specs.json 을 불러오지 못했습니다' }));
  if (SPECS.error) { document.body.innerHTML = '<p style="padding:40px">' + esc(SPECS.error) + '</p>'; return; }
  // 규격 파일이 예전 것이어도 자유 캔버스는 항상 쓸 수 있게 한다
  if (!SPECS.free) SPECS.free = {
    label: '자유 캔버스', track: '자유 제작', placement: '규격 없음 — 용도 자유', free: true,
    canvas: null, formats: ['PNG', 'JPG'], max_kb: null, has_psd_template: false, zones: [], rules: [],
  };

  const sel2 = $('#typeSel');
  let lastTrack = null;
  for (const k of TYPE_ORDER) {
    const sp = SPECS[k]; if (!sp) continue;
    if (sp.track !== lastTrack) {
      const og = el('optgroup'); og.label = sp.track; og.id = 'og-' + (isFree(sp) ? 'free' : sp.track === '이주의 브랜드' ? 'bow' : 'gen');
      sel2.appendChild(og); lastTrack = sp.track;
    }
    const o = el('option'); o.value = k; o.textContent = sp.label.replace(/^\[이주의 브랜드\]\s*/, '');
    sel2.lastChild.appendChild(o);
  }
  sel2.value = 'popup';
  sel2.onchange = () => switchType(sel2.value);

  try { await document.fonts.load('700 40px Pretendard'); await document.fonts.load('600 40px SCDream'); } catch {}

  // 배경 컬러 프리셋 — 흰색·연그레이를 피한 안전 톤
  $('#bgSwatches').innerHTML = ['#2f3542', '#1e2a44', '#123b32', '#3b2145', '#4a2020', '#0f2b4a',
    '#264653', '#2a3d1f', '#5c3a21', '#39304a', '#7a3b2e', '#1b1b1b']
    .map(c => `<span class="sw" style="background:${c}" data-c="${c}"></span>`).join('');
  $('#bgSwatches').onclick = e => {
    const c = e.target.dataset.c; if (!c) return;
    S.bg.c1 = c; syncCanvasInputs(); push(); render(); paintChecks(); measureKB();
  };

  // 캔버스/배경 입력
  const onCanvas = () => {
    const lo = isFree(SPECS[S.type]) ? FREE_MIN : 100;
    S.w = Math.round(clamp(+$('#cw').value || S.w, lo, 8000));
    S.h = Math.round(clamp(+$('#ch').value || S.h, lo, 8000));
    $('#cw').value = S.w; $('#ch').value = S.h; $('#sizePreset').value = '';
    push(); render(); paintSpecInfo(); paintChecks(); measureKB();
  };
  $('#cw').onchange = onCanvas; $('#ch').onchange = onCanvas;
  // 자유 캔버스 — 사이즈 프리셋 · 가로세로 바꾸기
  $('#sizePreset').onchange = () => {
    const v = $('#sizePreset').value; if (!v) return;
    const [w, h] = v.split('x').map(Number);
    $('#cw').value = w; $('#ch').value = h; onCanvas(); $('#sizePreset').value = v;
  };
  $('#btnSwapWH').onclick = () => { $('#cw').value = S.h; $('#ch').value = S.w; onCanvas(); };
  $('#bgMode').onchange = () => { S.bg.mode = $('#bgMode').value; syncCanvasInputs(); push(); render(); paintChecks(); };
  $('#bg1').oninput = () => { S.bg.c1 = $('#bg1').value; $('#bg1h').value = S.bg.c1; render(); paintChecks(); measureKB(); };
  $('#bg1h').onchange = () => { if (/^#[0-9a-f]{6}$/i.test($('#bg1h').value)) { S.bg.c1 = $('#bg1h').value; syncCanvasInputs(); render(); paintChecks(); } };
  $('#bg2').oninput = () => { S.bg.c2 = $('#bg2').value; render(); paintChecks(); };
  $('#bgAngle').oninput = () => { S.bg.angle = +$('#bgAngle').value; $('#bgAngleV').textContent = S.bg.angle + '°'; render(); };

  // 가이드 컨트롤
  $('#tgGuide').onclick = () => { $('#tgGuide').classList.toggle('on'); renderOverlay(); };
  $('#guideMode').onchange = () => { syncGuideControls(); renderOverlay(); };
  syncGuideControls();
  $('#guideOp').oninput = renderOverlay;
  $('#zoomIn').onclick = () => { autoFit = false; zoom *= 1.25; layoutStage(); };
  $('#zoomOut').onclick = () => { autoFit = false; zoom /= 1.25; layoutStage(); };
  $('#zoomFit').onclick = () => { autoFit = true; layoutStage(); };
  addEventListener('resize', () => layoutStage());

  // 레이어 추가
  $('#btnAddText').onclick = () => {
    const l = {
      id: uid(), kind: 'text', role: 'free', name: '텍스트',
      x: Math.round(S.w * .1), y: Math.round(S.h * .1), w: Math.round(S.w * .8),
      text: '텍스트', size: Math.round(S.w / 20), lh: 1.3, ls: -0.02,
      color: '#ffffff', align: 'left', font: 'Pretendard Bold',
    };
    S.layers.push(l); sel = l.id; push(); render(); paintLayers();
    startEdit(l);                                   // 만들자마자 글자를 받는다
  };
  $('#btnAddRect').onclick = () => {
    const l = {
      id: uid(), kind: 'rect', role: 'shape', name: '도형',
      x: Math.round(S.w * .2), y: Math.round(S.h * .3), w: Math.round(S.w * .6), h: Math.round(S.h * .15),
      fill: '#ffffff', radius: 12,
      text: '', size: Math.round(S.w / 26), lh: 1.3, ls: -0.02,
      color: '#111111', align: 'center', font: 'Pretendard SemiBold',
    };
    S.layers.push(l); sel = l.id; push(); render(); paintLayers();
    startEdit(l);                                   // 만들자마자 글자를 받는다
  };

  // 스톡 등록
  $('#drop').onclick = () => $('#filePick').click();
  // 목록을 복사해 넘긴다 — value 를 비우면 원래 FileList 도 비워진다
  $('#filePick').onchange = e => { uploadFiles([...e.target.files]); e.target.value = ''; };
  const dz = $('#drop');
  ['dragenter', 'dragover'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => uploadFiles([...e.dataTransfer.files]));
  $('#catSel').onchange = paintStock;
  $('#btnNewCat').onclick = () => {
    const c = prompt('새 카테고리 이름을 입력하세요.\n다음에 등록하는 이미지가 이 카테고리로 저장됩니다.');
    if (!c) return;
    const o = el('option'); o.textContent = c; o.value = c;
    $('#catSel').appendChild(o); $('#catSel').value = c;
    toast(`카테고리 “${c}” — 이미지를 등록하면 목록에 남습니다`);
  };

  // 상단 버튼
  $('#btnSave').onclick = saveProject;
  $('#btnOpen').onclick = openProject;
  $('#btnExport').onclick = doExport;
  $('#btnReset').onclick = () => { if (confirm('현재 작업을 버리고 규격 기본 상태로 되돌립니다.')) switchType(S.type); };

  // 탭 / 섹션 접기
  document.querySelectorAll('.tb').forEach(t => t.onclick = () => {
    document.querySelectorAll('.tb').forEach(x => x.classList.toggle('on', x === t));
    document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('on', p.id === 'tab-' + t.dataset.tab));
  });
  document.querySelectorAll('.sect > h3').forEach(h3 => h3.onclick = () => h3.parentElement.classList.toggle('closed'));

  // 배너 기획안
  $('#planSel').onchange = () => {
    if ($('#planSel').value) openPlan($('#planSel').value);
    else { curPlan = null; paintPlanMeta(); }
  };
  $('#btnPlanSave').onclick = savePlan;

  await loadLibrary();
  await loadStock();
  await switchType('popup');
  await loadPlanList();

  // ?plan=<bannerId>&view=clean — 기획안을 바로 열어 미리보기 (헤드리스 캡처·공유 링크용)
  const qs = new URLSearchParams(location.search);
  if (qs.get('view') === 'clean') { $('#guideMode').value = 'clean'; syncGuideControls(); }
  if (qs.get('plan')) {
    if ($('#planSel')._rows.has(qs.get('plan'))) { $('#planSel').value = qs.get('plan'); await openPlan(qs.get('plan')); }
    else toast('기획안을 찾지 못했습니다 — ' + qs.get('plan'), true);
  }
  document.body.dataset.ready = '1';
}

boot().catch(e => { console.error(e); document.body.insertAdjacentHTML('afterbegin', '<pre style="color:#f2596a;padding:20px">' + esc(e.stack || e) + '</pre>'); });
