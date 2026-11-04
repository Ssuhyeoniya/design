// 빌드 번호를 넣는 곳 — 세 화면 HTML 의 <meta name="app-build"> 와 루트 version.json (bump-build·check-build 공용)
export const HTML = ['blog_image_studio_v4_5.html', 'banner_studio/index.html', 'library.html'];
export const VERSION = 'version.json';
export const META = /<meta name="app-build" content="([^"]*)">/;
