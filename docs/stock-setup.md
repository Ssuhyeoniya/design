# 공용 스톡 이미지 설정 (어느 컴퓨터에서나 같은 보관함)

블로그 이미지 제작 · 배너 스튜디오 · 이미지 소스의 **스톡 이미지 보관함**에 올린 이미지와 숨김 목록을
이 저장소(`Ssuhyeoniya/design`)의 **`stock-data` 브랜치** `assets/user-stock/` 폴더에 저장하는 기능입니다.
설정 전에는 지금처럼 **이 브라우저에만** 저장되고, 화면에 `공용 저장 꺼짐`이 표시됩니다.

- 저장 위치: `stock-data` 브랜치의 `assets/user-stock/<id>.<확장자>`(이미지), `index.json`(목록), `hidden.json`(숨긴 기본 이미지)
- `stock-data` 브랜치는 처음 올릴 때 `main`의 지금 상태에서 자동으로 만들어집니다. 이미지 커밋은 이 브랜치에만 쌓이므로
  `main` 배포·프로덕션 흐름을 건드리지 않고, 프로덕션 재배포도 일어나지 않습니다.
- 올리기·지우기·숨기기·복원을 할 때마다 `stock-data`에 커밋이 하나씩 생깁니다(예: `chore(stock): 업로드 쿠폰.png`).
- 서버 코드: `api/stock.js` (Vercel 서버리스 함수). 토큰은 서버에만 있고 브라우저로는 보내지 않습니다.

## 1. GitHub 토큰 만들기 (한 번)

1. GitHub 오른쪽 위 프로필 → **Settings** → 왼쪽 맨 아래 **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
2. 아래처럼 정합니다.
   - Token name: `design-stock` (아무 이름)
   - Expiration: 1년 등 원하는 기간 (만료되면 아래 [토큰이 만료됐을 때](#토큰이-만료됐을-때)대로 갱신)
   - Resource owner: `Ssuhyeoniya`
   - Repository access: **Only select repositories** → `Ssuhyeoniya/design` 하나만
   - Permissions → Repository permissions → **Contents: Read and write** (나머지는 건드리지 않음. Metadata: Read-only 는 자동)
3. **Generate token** → 화면에 한 번만 보이는 값(`github_pat_…`)을 복사합니다.
   - 이 값을 메신저·메일·문서·저장소에 붙여 넣지 마세요. 바로 2단계의 Vercel 입력칸에만 넣습니다.

## 2. `main` 브랜치 보호 (꼭 하세요)

fine-grained 토큰은 **브랜치 단위로 권한을 줄일 수 없습니다.** 토큰이 새면 `main`에도 쓸 수 있으므로 `main`을 보호합니다.

1. GitHub → `Ssuhyeoniya/design` → **Settings** → **Branches**(또는 **Rules → Rulesets**) → **Add branch protection rule**(또는 New ruleset)
2. Branch name pattern: `main`
3. 체크: **Require a pull request before merging**(PR 필수), **Do not allow bypassing the above settings**
   - Ruleset 을 쓴다면 대상(Target branches)은 **`main` 만** 넣고, **Restrict deletions**, **Block force pushes** 를 켭니다.
   - **Restrict creations 는 켜지 마세요.** 켜면 서버가 `stock-data` 브랜치를 처음 만들 수 없습니다.
   - **Require status checks to pass** 에 CI(`check`)를 연결하면 PR 병합 전에 빌드 번호·단위 테스트 검사가 강제됩니다.
4. 저장합니다. 이제 토큰으로는 `main`에 직접 커밋할 수 없고, 공용 스톡은 `stock-data`에만 씁니다.
5. **바뀌는 점**: 이후 `main` 반영(개발 결과 배포)은 직접 push 가 아니라 **작업 브랜치 → PR → 병합** 으로만 됩니다.
   개발 담당(사람·에이전트)에게 이 방식으로 반영하라고 알려 주세요.

## 3. Vercel 환경변수 등록

1. Vercel → design 프로젝트 → **Settings** → **Environment Variables**
2. 다음 두 개를 추가합니다. Environment 는 **Production 만** 체크합니다(Preview·Development 는 체크하지 않음 —
   미리보기 배포 주소에서 토큰이 쓰이지 않게).

| Name | Value | 설명 |
|---|---|---|
| `GITHUB_TOKEN` | 1단계에서 복사한 `github_pat_…` | 저장소에 커밋하는 데만 씁니다 |
| `STOCK_PASSWORD` | 팀이 함께 쓸 비밀번호 (길고 추측하기 어려운 문장) | 업로드·삭제·숨김 때 화면이 한 번 묻습니다 |

3. 선택 항목 (보통은 넣지 않습니다)

| Name | 기본값 | 언제 바꾸나 |
|---|---|---|
| `GITHUB_BRANCH` | `stock-data` | 저장 브랜치 이름을 바꾸고 싶을 때 (`main` 으로 두지 마세요). 바꾸면 4단계 Ignored Build Step 명령의 브랜치 이름도 같이 바꾸고, **기존 브랜치의 이미지·목록은 옮겨지지 않습니다**(새 브랜치에서 빈 목록으로 시작) |
| `GITHUB_REPO` | `Ssuhyeoniya/design` | 저장소 이름이 바뀌었을 때 |
| `STOCK_DIR` | `assets/user-stock` | 저장 폴더를 바꾸고 싶을 때 |

4. 환경변수는 **새로 배포해야** 적용됩니다. **Deployments** → 맨 위 Production 배포의 `⋯` → **Redeploy**.

## 4. `stock-data` 브랜치를 Vercel 이 배포하지 않게

`stock-data` 에 커밋이 생길 때마다 Vercel 이 Preview 배포를 만들지 않도록 합니다.

- Vercel → design 프로젝트 → **Settings** → **Git** → **Ignored Build Step** 에서 **Custom** 을 고르고 아래를 넣습니다.

  ```
  [ "$VERCEL_GIT_COMMIT_REF" = "stock-data" ] && exit 0 || exit 1
  ```
  (`exit 0` = 이 배포를 건너뜀, `exit 1` = 평소처럼 배포)
- 예전 안내의 "이미지 커밋만 있는 배포 건너뛰기" 설정(`git diff … assets/user-stock`)은 이미지가 `main` 이 아닌 `stock-data` 에만
  쌓이므로 **필요 없습니다**(넣어도 해롭지는 않음).

## 5. 확인

1. Vercel 주소로 **이미지 소스 → 📦 스톡 이미지** 탭을 엽니다. 오른쪽에 `● 공용 저장 켜짐`이 보이면 성공입니다.
   - `○ 공용 저장 꺼짐` → 툴팁에 이유가 나옵니다. `서버(/api) 없음`이면 배포가 안 된 것이고, `서버에 GITHUB_TOKEN 이 없어…`면 3단계를 다시 확인하세요.
   - `● 공용 저장 읽기 전용` → `STOCK_PASSWORD`가 비어 있습니다.
2. 이전에 이 브라우저에 올려 둔 이미지가 있으면 **⇪ 이 브라우저의 이미지를 공용으로 올리기** 버튼이 보입니다. 누르면 한 번에 옮깁니다.
   - 자동으로 옮기지 않습니다. 같은 내용은 건너뛰고, 이 브라우저의 원래 데이터는 지우지 않습니다.
   - 이 브라우저에서 숨겼던 기본 이미지 목록도 공용 숨김으로 함께 옮깁니다.
3. 처음 올리거나 지울 때 비밀번호를 묻습니다. 한 번 맞게 넣으면 그 브라우저에 기억합니다(틀리면 다시 묻습니다).

## 토큰이 만료됐을 때

- **증상**: 올리기·지우기·숨기기를 하면 `서버 설정(토큰) 문제 — 관리자에게 알려 주세요` 가 뜹니다. 비밀번호를 다시 묻지 않습니다
  (비밀번호 문제가 아니라서). 보관함은 `공용 저장에 연결 못 함 — 다시 시도` 로 보일 수 있습니다.
- **갱신**: 1단계대로 새 토큰을 만들고(또는 GitHub 토큰 목록에서 기존 토큰 **Regenerate**), Vercel 의 `GITHUB_TOKEN` 값을 바꾼 뒤
  **Redeploy** 합니다. 다 되면 화면의 **다시 시도** 를 누릅니다.

## 알아 둘 점

- **크기 한도 3MB**(png · jpg · webp · gif). Vercel 함수가 받을 수 있는 요청 크기(4.5MB) 때문입니다. svg 는 안에 스크립트가 들어갈 수 있어 받지 않습니다.
- 이미지 주소: 저장소가 **공개**이면 `raw.githubusercontent.com/…/stock-data/…`, **비공개**이면 `/api/stock?file=…` 를 거칩니다(자동 판단).
  - **비공개 저장소여도 Vercel 주소를 아는 사람은 공용 이미지를 볼 수 있습니다**(목록 보기·이미지 보기에는 비밀번호가 없음).
    올리기·지우기·숨기기만 비밀번호로 막습니다. 외부에 보이면 안 되는 이미지는 올리지 마세요.
- **목록 캐시**: 목록은 Vercel CDN 과 서버 함수 메모리에 약 15초 캐시됩니다(그동안 여러 화면·여러 사람이 열어도 GitHub 조회는 한 번).
  - 올리기·지우기·숨기기를 하면 서버 메모리 캐시는 바로 비워지고, **그 작업을 한 브라우저**는 60초 동안 비밀번호를 붙여 캐시를 건너뛰고 최신 목록을 받습니다.
  - **다른 컴퓨터**는 CDN 캐시 때문에 최대 약 15초(갱신 중에는 최대 1분 남짓) 예전 목록을 볼 수 있고, 창으로 돌아올 때(포커스) 다시 읽습니다.
  - 비밀번호 없이 `?t=`·`no-cache` 로 캐시를 건너뛰려는 요청은 무시됩니다.
- **삭제한 이미지가 잠시 보일 수 있음**: 이미지 파일은 주소가 바뀌지 않아 CDN·브라우저에 **최대 1일** 캐시됩니다.
  보관함 목록에서는 바로 빠지지만, 주소를 이미 알고 있는 곳에서는 하루까지 보일 수 있습니다. 민감한 이미지는 올리지 마세요.
- 한 번이라도 공용 저장이 켜졌던 브라우저는, 서버에 잠시 연결이 안 돼도 이 브라우저에만 몰래 저장하지 않고
  `공용 저장에 연결 못 함 — 다시 시도` 로 멈춥니다.
- 비밀번호를 10분에 20번 틀리면 **5분** 동안 막힙니다(429). 같은 곳(IP)에서 동시에 여러 번 확인하는 것도 막습니다.
  - **같은 회사 공인 IP 를 쓰는 팀원이 함께 잠길 수 있습니다.** 5분 뒤 풀립니다.
  - 횟수는 서버 함수 인스턴스마다 따로 세므로 완전한 차단은 아닙니다(인스턴스가 여럿이면 각각 셈).
  - IP 는 Vercel 에서 돌 때만 Vercel 이 넣어 주는 값(`x-real-ip`)으로 판단합니다. **Vercel 밖(직접 띄운 서버 등)에서는 IP 제한이 약합니다** —
    프록시 뒤라면 모두 같은 IP 로 보여 함께 잠기거나 제한이 사실상 한 덩어리가 됩니다.
  - 같은 곳에서 오타 직후 1초 안에 다시 시도하면 서버가 '확인 중'으로 잠시 거절하는데, 화면이 1초 뒤 한 번 자동으로 다시 보냅니다.
- 지운 이미지도 `stock-data` 브랜치 **커밋 기록에는 남습니다**(되살리려면 기록에서 찾을 수 있음). 민감한 이미지는 올리지 마세요.
- 이미 작업에 넣은 공용 이미지는 작업 파일 안에 복사돼 들어가므로, 나중에 보관함에서 지워도 작업이 깨지지 않습니다.
- 토큰이 새어 나갔다고 생각되면 GitHub → 토큰 목록에서 **Revoke** 하고 1·3단계를 다시 하세요.
