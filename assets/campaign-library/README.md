# 캠페인 이미지 에셋 라이브러리 · 배너 기획안

이미지 에셋과 배너 기획안은 **따로 저장**한다. 기획안은 이미지를 담지 않고 Asset ID 만 참조한다.

```
assets/campaign-library/
  food/ lifestyle/ office/ seasonal/ promotion/ backgrounds/ shared/   이미지 파일 ({assetId}.png)
  metadata/assets.json                                          에셋 레지스트리 (메타데이터·체크섬·사용 이력)
data/banner-plans/
  index.json                                                    기획안 목록 (스튜디오가 읽는다)
  campaigns/{campaignId}/{bannerId}.json                        현재 기획안
  versions/{bannerId}/v{n}.json                                 버전별 스냅샷
  templates/index.json                                          templateId 목록 (= banner_studio/data/banner_specs.json 타입 키)
banner_studio/plans.js                                          연결 로직 (스튜디오·CLI 공용)
tools/creative-lib.mjs                                          등록·검색·저장·검증 CLI
```

## 연결 방식

```json
{
  "bannerId": "sample-coupon-popup",
  "campaignId": "sample-coupon-promo",
  "templateId": "popup",
  "optionValues": { "type": "popup", "w": 1000, "h": 1000, "bg": { "mode": "solid", "c1": "#1e2a44" } },
  "content": { "brandText": "식권대장", "mainCopy": "…", "subCopy": "…", "cta": "혜택 확인하기" },
  "assets": { "mainImageAssetId": "asset-promotion-002" },
  "layout": { "images": { "main": { "x": 0, "y": 0, "w": 0, "h": 0, "crop": null } } }
}
```

- `templateId`·`optionValues.type` 은 배너 스튜디오의 배너 타입 키를 그대로 쓴다.
- `content` 의 키는 스튜디오 레이어 role 과 짝이다: `brandText`→logo, `mainCopy`→main, `subCopy`→sub, `cta`→buttonText.
- 이미지 슬롯은 `{slot}ImageAssetId` (예: `mainImageAssetId`), 배치·크롭은 `layout.images.{slot}` 에 둔다. `crop` 은 원본 대비 0~1 비율 `{x,y,w,h}` 이다.
- 에셋 `path` 는 저장소 루트 기준이다. 기존 파일은 복사하지 않고 그 경로로 등록할 수 있다 (`asset:link`).

## 명령 (저장소 루트에서)

```bash
node tools/creative-lib.mjs asset:search --q "돈까스 할인" --category food           # 1) 재사용할 이미지부터 찾는다
node tools/creative-lib.mjs asset:add --file out.png --category food \
  --desc "…" --keywords "돈까스,할인" --tool higgsfield --model "…" --prompt "…" --license "…"   # 2) 없을 때만 신규 등록
node tools/creative-lib.mjs asset:add --file edit.png --category food --parent asset-food-001 --relation retouch   # 수정본은 새 ID
node tools/creative-lib.mjs plan:save --file plan.json --by agent-04 --summary "카피 수정"   # 바뀐 경우에만 v+1
node tools/creative-lib.mjs plan:show --banner sample-coupon-popup                       # Asset ID → 실제 경로
node tools/creative-lib.mjs validate                                                     # 커밋 전 필수
node --test tools/creative-lib.test.mjs
```

## 규칙

- 같은 파일(체크섬 동일)은 다시 저장하지 않는다. `asset:add` 가 기존 Asset ID 를 돌려준다.
- 등록된 이미지 파일은 덮어쓰지 않는다. 수정본은 `--parent` 로 새 Asset ID 를 받는다. 원본이 바뀌면 `validate` 가 체크섬 불일치로 잡아낸다.
- 카피·레이아웃만 고칠 때는 Asset ID 를 그대로 두고 기획안만 저장한다.
- 사용 이력(`usage`)은 `plan:save` 할 때마다 현재 기획안 기준으로 다시 계산된다. 손으로 고치지 않는다.

## 배너 스튜디오

- 좌측 **배너 기획안** 에서 고르면 기획안의 카피·이미지·배치가 캔버스에 적용된다.
- **기획안 저장**은 바뀐 경우에만 새 버전을 만든다. 수정본은 이 브라우저(IndexedDB `banner_plans`)에 남고 `{bannerId}.json` 으로 내려받아진다.
- 정적 사이트라 저장소에 직접 쓰지 못한다. 내려받은 JSON 을 `plan:save` 로 반영해 커밋한다.
- 스톡 보관함의 `라이브러리 · …` 카테고리가 이 라이브러리다. 여기서 넣은 이미지만 기획안에 Asset ID 로 저장된다.
