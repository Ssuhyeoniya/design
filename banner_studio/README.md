# 배너 스튜디오

식권대장 In-App 광고 배너 제작 + 실시간 규격 검수 도구. design 저장소의 정적 페이지로 동작한다
(서버·`npm install` 불필요). 상단 네비로 **블로그 이미지 제작 · 배너 스튜디오 · 이미지 소스**를 오간다.

| 항목 | 위치 |
|---|---|
| 화면 | `index.html` · `app.js` · `style.css` |
| 규격 | `data/banner_specs.json` — 규격을 고치려면 이 파일을 고친다 |
| PSD 가이드 PNG | `assets/*.png` |
| 폰트 | `fonts/Pretendard/` · `fonts/SCDream/` |
| 기본 스톡 (읽기 전용) | `stock/<카테고리>/` + `stock/manifest.json` |
| 내 스톡 · 작업 저장본 | 브라우저 IndexedDB `banner_studio` (`stock` · `projects`) |
| 완성 배너 | 내보내기 → 브라우저 다운로드 |

기본 스톡을 추가하면 `stock/manifest.json` 목록도 함께 갱신해야 화면에 나타난다.
내 스톡·저장본은 브라우저별로 저장되므로 다른 PC·브라우저와 공유되지 않는다.

## 자유 캔버스

배너 타입 드롭다운 맨 아래 **자유 제작 › 자유 캔버스**. 규정·검수 탭과 가이드가 꺼지고,
캔버스 크기를 16~8000px 사이에서 직접 입력하거나 사이즈 프리셋(SNS·썸네일·디스플레이 광고 등)과
⇄(가로·세로 바꾸기)로 정한다. 용량 상한도 적용하지 않는다. 규격 정의는 `banner_specs.json` 의 `free` 키.
