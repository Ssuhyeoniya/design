---
name: github-vercel-dev
description: >
  GitHub 저장소로 관리하고 Vercel(또는 GitHub Pages·GAS)로 배포하는 마케팅 웹 도구의
  개발 표준. 브랜치·커밋·PR 흐름, 배포 전 검증, Vercel 프리뷰/프로덕션 구분,
  환경변수·보안 규칙을 다룬다. mkt_sh · news · storemap · employer · surveyform ·
  design 등 "개발" 그룹 저장소에서 기능 추가·버그 수정·배포를 할 때 사용한다.
---

# GitHub · Vercel 개발 표준 (개발 그룹)

## 대상 저장소

| 저장소 | 형태 | 배포 |
|---|---|---|
| `mkt_sh` | 정적 HTML 와이어프레임 + GAS 프록시 | Vercel (`mkt-sh.vercel.app`) |
| `news` | 웹앱 (클리핑·메모·일정·메일) | Vercel |
| `storemap` | 지도 대시보드 | Vercel / main 직접 배포 |
| `employer` | Next.js 16 + Neon Postgres | Vercel |
| `surveyform` | 폼 빌더 + 관리자 | Vercel + GAS |
| `design` | 단일 HTML 이미지 스튜디오 | 정적 |

작업 전 항상 그 저장소의 `CLAUDE.md` 를 먼저 읽는다. 저장소 규칙이 이 문서보다 우선한다.

## 1. 브랜치 · 커밋

1. 지정된 작업 브랜치(`claude/...`)에서만 작업한다. 없으면 만든다.
2. 커밋 메시지는 `feat(영역): 무엇을` / `fix(영역): 무엇을` 형식, 한국어 본문 허용.
3. 푸시는 `git push -u origin <branch>`. 네트워크 오류일 때만 2·4·8·16초 간격으로 재시도.
4. **PR 은 사용자가 요청할 때만** 만든다. main 직접 푸시도 요청이 있을 때만.

## 2. 배포 전 검증 (푸시 전에 반드시)

- Next.js / TS 프로젝트: `npx tsc --noEmit` → `npm run build`. 둘 다 통과해야 푸시.
- 정적 HTML: 브라우저(Playwright, `/opt/pw-browsers/chromium`)로 열어 콘솔 에러 0 확인.
- 린트가 있으면 `npm run lint`.
- 외부 키(DB·API)가 없어도 빌드·실행이 성공해야 한다 — 의존성은 없으면 조용히 꺼지게.

## 3. Vercel

- 브랜치 푸시 → **Preview** 배포, main 머지 → **Production** 배포 (보통 1–2분).
- 정적 자산을 고쳤으면 캐시 무효화를 위해 `?v=YYYYMMDD-n` 쿼리를 올린다.
- `vercel.json` 리라이트·헤더를 바꿀 땐 기존 라우트가 깨지지 않는지 확인.
- 배포 결과를 보고할 때는 어느 환경(Preview/Production)인지 명시한다.

## 4. GAS 프록시 (mkt_sh · surveyform)

- `gas/*.gs` 를 바꾸면 **Apps Script 재배포가 필요**하다고 사용자에게 알린다 (자동 배포 안 됨).
- 프런트만 바꾼 경우 "GAS 재배포 불필요"를 명시한다.
- 라우트는 `?action=<module>.<verb>` 규약을 유지한다.

## 5. 보안

- `.env*`, API 키, 시트 ID, 토큰은 출력·커밋하지 않는다.
- 접근 잠금(`ACCESS_KEY` 등)이 비어 있으면 배포 전에 사용자에게 경고한다.
- 개인정보(고객사 연락처 등)가 담긴 샘플 데이터를 커밋하지 않는다.

## 6. 보고 형식

작업이 끝나면 3줄 이내로: ① 무엇을 바꿨는지 ② 어떻게 검증했는지 ③ 배포 상태/다음 액션.
