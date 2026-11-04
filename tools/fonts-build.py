#!/usr/bin/env python3
"""무료 글꼴 모음(fonts/) 빌드 — npm 에서 받은 글꼴 패키지를 웹용 파일(woff2 우선)과 fonts/fonts.css 로 정리한다.

사용:  python3 tools/fonts-build.py <패키지를 풀어 둔 폴더>
      (각 패키지는 `npm pack <이름> && tar xzf *.tgz` 로 <폴더>/<이름의 / @ 를 _ 로 바꾼 것>/package 에 풀어 둔다)
모두 상업적 사용이 가능한 무료 글꼴이다 — 라이선스는 fonts/LICENSES.md 참고.
"""
import os, re, shutil, sys

SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fonts')
SKIP_SUBSETS = re.compile(r'-(cyrillic|cyrillic-ext|greek|greek-ext|vietnamese|math|symbols)-')

# (패키지 폴더, 출력 폴더, 읽을 CSS 목록, 글꼴 이름 바꾸기(없으면 그대로))
FONTSOURCE = ['noto-sans-kr', 'nanum-gothic', 'nanum-myeongjo', 'ibm-plex-sans-kr', 'gothic-a1', 'black-han-sans', 'do-hyeon', 'jua',
              'gowun-dodum', 'gowun-batang', 'song-myung', 'nanum-pen-script', 'inter', 'roboto', 'montserrat', 'poppins']
PACKS = []
for n in FONTSOURCE:
    base = f'_fontsource_{n}/package'
    css = sorted(f for f in os.listdir(os.path.join(SRC, base)) if re.fullmatch(r'\d00\.css', f))
    PACKS.append((base, n, css, None))
PACKS += [
    ('_sun-typeface_suit/package/fonts/static/woff2', 'suit', ['SUIT.css'], None),
    ('spoqa-han-sans/package/css', 'spoqa-han-sans-neo', ['SpoqaHanSansNeo.css'], None),
    ('wanted-sans/package/fonts/webfonts/static/split', 'wanted-sans', ['WantedSans.css'], None),
    ('typeface-nanum-square-neo/package', 'nanum-square-neo', ['nanumsquareneo.css'], 'NanumSquare Neo'),
    ('_noonnu_gmarket-sans-light/package', 'gmarket-sans', ['index.css'], 'Gmarket Sans'),
    ('_noonnu_gmarket-sans-medium/package', 'gmarket-sans', ['index.css'], 'Gmarket Sans'),
    ('_noonnu_gmarket-sans-bold/package', 'gmarket-sans', ['index.css'], 'Gmarket Sans'),
]
GMARKET_W = {'light': 300, 'medium': 500, 'bold': 700}
WNAME = {'thin': 100, 'extralight': 200, 'light': 300, 'regular': 400, 'normal': 400, 'medium': 500, 'semibold': 600, 'bold': 700, 'extrabold': 800, 'heavy': 900, 'black': 900}

def best_src(src, cssdir):
    urls = re.findall(r"url\(\s*['\"]?([^'\")]+)['\"]?\s*\)\s*format\(\s*['\"]?([\w-]+)", src)
    if not urls: urls = [(u, os.path.splitext(u)[1][1:]) for u in re.findall(r"url\(\s*['\"]?([^'\")]+)['\"]?\s*\)", src)]
    for want in ('woff2', 'woff', 'opentype', 'truetype', 'otf', 'ttf'):
        for u, f in urls:
            p = os.path.normpath(os.path.join(cssdir, u.split('?')[0].split('#')[0]))
            if f == want and os.path.exists(p): return p, f
    return None, None

if os.path.isdir(OUT):
    for d in os.listdir(OUT):
        if os.path.isdir(os.path.join(OUT, d)): shutil.rmtree(os.path.join(OUT, d))
os.makedirs(OUT, exist_ok=True)
faces, summary = [], {}
for base, slug, cssfiles, rename in PACKS:
    cssdir = os.path.join(SRC, base)
    if not os.path.isdir(cssdir): print('없음', base); continue
    os.makedirs(os.path.join(OUT, slug), exist_ok=True)
    for cf in cssfiles:
        text = open(os.path.join(cssdir, cf), encoding='utf-8').read()
        for block in re.findall(r'@font-face\s*\{(.*?)\}', text, re.S):
            if re.search(r'font-style:\s*italic', block): continue
            fam = re.search(r"font-family:\s*['\"]?([^;'\"]+)", block).group(1).strip()
            fam = rename or fam
            src = ' '.join(re.findall(r'src:\s*([^;]+);', block))
            path, fmt = best_src(src, cssdir)
            if not path or SKIP_SUBSETS.search(os.path.basename(path)): continue
            wm = re.search(r'font-weight:\s*(\d+)', block)
            nsq = re.search(r'NanumSquareNeoTTF-([a-e])', path)
            if nsq: w = {'a': 300, 'b': 400, 'c': 700, 'd': 800, 'e': 900}[nsq.group(1)]   # 나눔스퀘어 네오는 파일 이름 첫 글자가 굵기
            elif wm: w = int(wm.group(1))
            else:
                key = os.path.basename(path).lower()
                w = next((v for k, v in sorted(GMARKET_W.items()) if k in key), None) or \
                    next((v for k, v in sorted(WNAME.items(), key=lambda x: -len(x[0])) if k in key.replace('-', '')), 400)
            fname = os.path.basename(path)
            shutil.copy(path, os.path.join(OUT, slug, fname))
            ur = re.search(r'unicode-range:\s*([^;]+);', block)
            fmt = {'opentype': 'opentype', 'otf': 'opentype', 'truetype': 'truetype', 'ttf': 'truetype'}.get(fmt, fmt)
            faces.append((slug, f"@font-face{{font-family:'{fam}';font-style:normal;font-weight:{w};font-display:swap;"
                         f"src:url('{fname}') format('{fmt}');" + (f"unicode-range:{ur.group(1).strip()};" if ur else '') + '}'))
            summary.setdefault(fam, {'slug': slug, 'w': set()})['w'].add(w)

# 잘난체(여기어때) — 블로그 이미지 제작에 base64 로 들어 있던 것을 파일로 꺼내 모든 화면에서 쓴다
blog = os.path.join(OUT, '..', 'blog_image_studio_v4_5.html')
m = re.search(r'font-family:"JalnanGothic";src:url\("data:font/woff2;base64,([A-Za-z0-9+/=]+)"', open(blog, encoding='utf-8').read())
if m:
    import base64
    os.makedirs(os.path.join(OUT, 'jalnan-gothic'), exist_ok=True)
    open(os.path.join(OUT, 'jalnan-gothic', 'JalnanGothic.woff2'), 'wb').write(base64.b64decode(m.group(1)))
    faces.append(('jalnan-gothic', "@font-face{font-family:'Jalnan Gothic';font-style:normal;font-weight:400;font-display:swap;src:url('JalnanGothic.woff2') format('woff2');}"))
    summary['Jalnan Gothic'] = {'slug': 'jalnan-gothic', 'w': {400}}

# 글꼴마다 font.css 를 따로 둔다 — 페이지는 실제로 쓰는 글꼴의 CSS 만 불러온다 (shared/fonts.js)
for slug in sorted({sl for sl, _ in faces}):
    with open(os.path.join(OUT, slug, 'font.css'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(css for sl, css in faces if sl == slug) + '\n')
import json
idx = [{'family': fam, 'slug': v['slug'], 'weights': sorted(v['w'])} for fam, v in sorted(summary.items())]
json.dump(idx, open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
for i in idx: print(i['family'], i['weights'])
print('@font-face', len(faces))
