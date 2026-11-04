# 공용 스톡 이미지 설정 (어느 컴퓨터에서나 같은 보관함)

블로그 이미지 제작 · 배너 스튜디오 · 이미지 소스의 **스톡 이미지 보관함**에 올린 이미지와 숨김 목록을
이 저장소(`Ssuhyeoniya/design`)의 `assets/user-stock/` 폴더에 저장하는 기능입니다.
설정 전에는 지금처럼 **이 브라우저에만** 저장되고, 화면에 `공용 저장 꺼짐`이 표시됩니다.

- 저장 위치: `assets/user-stock/<id>.<확장자>`(이미지), `assets/user-stock/index.json`(목록), `assets/user-stock/hidden.json`(숨긴 기본 이미지)
- 올리기·지우기·숨기기·복원을 할 때마다 저장소에 커밋이 하나씩 생깁니다(예: `chore(stock): 업로드 쿠폰.png`).
- 서버 코드: `api/stock.js` (Vercel 서버리스 함수). 토큰은 서버에만 있고 브라우저로는 보내지 않습니다.

## 1. GitHub 토큰 만들기 (한 번)

1. GitHub 오른쪽 위 프로필 → **Settings** → 왼쪽 맨 아래 **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
2. 아래처럼 정합니다.
   - Token name: `design-stock` (아무 이름)
   - Expiration: 1년 등 원하는 기간 (만료되면 이 문서의 1~2단계를 다시 하면 됩니다)
   - Resource owner: `Ssuhyeoniya`
   - Repository access: **Only select repositories** → `Ssuhyeoniya/design` 하나만
   - Permissions → Repository permissions → **Contents: Read and write** (나머지는 건드리지 않음. Metadata: Read-only 는 자동)
3. **Generate token** → 화면에 한 번만 보이는 값(`github_pat_…`)을 복사합니다.
   - 이 값을 메신저·메일·문서·저장소에 붙여 넣지 마세요. 바로 2단계의 Vercel 입력칸에만 넣습니다.

## 2. Vercel 환경변수 등록

1. Vercel → design 프로젝트 → **Settings** → **Environment Variables**
2. 다음 두 개를 추가합니다. Environment 는 **Production**(필요하면 Preview 도) 을 체크합니다.

| Name | Value | 설명 |
|---|---|---|
| `GITHUB_TOKEN` | 1단계에서 복사한 `github_pat_…` | 저장소에 커밋하는 데만 씁니다 |
| `STOCK_PASSWORD` | 팀이 함께 쓸 비밀번호 (예: 길고 추측하기 어려운 문장) | 업로드·삭제·숨김 때 화면이 한 번 묻습니다 |

3. 선택 항목 (보통은 넣지 않습니다)

| Name | 기본값 | 언제 바꾸나 |
|---|---|---|
| `GITHUB_REPO` | `Ssuhyeoniya/design` | 저장소 이름이 바뀌었을 때 |
| `GITHUB_BRANCH` | `main` | 다른 브랜치에 저장하고 싶을 때 |
| `STOCK_DIR` | `assets/user-stock` | 저장 폴더를 바꾸고 싶을 때 |

4. 환경변수는 **새로 배포해야** 적용됩니다. **Deployments** → 맨 위 배포의 `⋯` → **Redeploy**.

## 3. 확인

1. Vercel 주소로 **이미지 소스 → 📦 스톡 이미지** 탭을 엽니다. 오른쪽에 `● 공용 저장 켜짐`이 보이면 성공입니다.
   - `○ 공용 저장 꺼짐` → 툴팁에 이유가 나옵니다. `서버(/api) 없음`이면 배포가 안 된 것이고, `서버에 GITHUB_TOKEN 이 없어…`면 2단계를 다시 확인하세요.
   - `● 공용 저장 읽기 전용` → `STOCK_PASSWORD`가 비어 있습니다.
2. 이전에 이 브라우저에 올려 둔 이미지가 있으면 **⇪ 이 브라우저의 이미지를 공용으로 올리기** 버튼이 보입니다. 누르면 한 번에 옮깁니다.
   - 자동으로 옮기지 않습니다. 같은 내용은 건너뛰고, 이 브라우저의 원래 데이터는 지우지 않습니다.
   - 이 브라우저에서 숨겼던 기본 이미지 목록도 공용 숨김으로 함께 옮깁니다.
3. 처음 올리거나 지울 때 비밀번호를 묻습니다. 한 번 맞게 넣으면 그 브라우저에 기억합니다(틀리면 다시 묻습니다).

## 알아 둘 점

- **크기 한도 3MB**(png · jpg · webp · gif). Vercel 함수가 받을 수 있는 요청 크기(4.5MB) 때문입니다. svg 는 안에 스크립트가 들어갈 수 있어 받지 않습니다.
- 저장소가 **공개**이면 이미지는 `raw.githubusercontent.com` 주소로, **비공개**이면 `/api/stock?file=…` 를 거쳐 보입니다(서버가 자동으로 판단).
- 목록은 배포를 기다리지 않고 바로 반영됩니다(서버가 GitHub 에서 최신 목록을 읽음). 단, 저장소에 이미지가 커밋될 때마다
  Vercel 이 새 배포를 시작할 수 있습니다. 이미지가 자주 바뀌어 배포가 많이 쌓이면 Vercel → Settings → Git →
  **Ignored Build Step** 에 `git diff --quiet HEAD^ HEAD -- . ':(exclude)assets/user-stock'` 를 넣어 이미지 커밋만 있는 배포를 건너뛸 수 있습니다.
- 지운 이미지도 저장소 **커밋 기록에는 남습니다**(되살리려면 기록에서 찾을 수 있음). 민감한 이미지는 올리지 마세요.
- 이미 작업에 넣은 공용 이미지는 작업 파일 안에 복사돼 들어가므로, 나중에 보관함에서 지워도 작업이 깨지지 않습니다.
- 토큰이 새어 나갔다고 생각되면 GitHub → 토큰 목록에서 **Revoke** 하고 1~2단계를 다시 하세요.
