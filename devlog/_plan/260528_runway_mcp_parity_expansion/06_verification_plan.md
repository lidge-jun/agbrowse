# 검증 계획

## 구현 전 선행 검증 (MUST)

### 1. 라이브 셀렉터 캡처

Phase 2 구현 전에 반드시 Computer Use로 실제 Runway UI 셀렉터를 재캡처해야 함.

필요한 셀렉터:
- [ ] Explore/Credits 모드 토글 실제 selector
- [ ] Duration 선택 컨트롤 실제 selector
- [ ] Aspect ratio 선택 컨트롤 실제 selector
- [ ] Resolution 선택 컨트롤 실제 selector
- [ ] Audio 토글 실제 selector
- [ ] 모델 드롭다운 내부 항목 selector 패턴
- [ ] Recents 에셋 카드 selector
- [ ] 에셋 다운로드 버튼 selector
- [ ] 생성 완료 후 결과 영상/이미지 src URL 패턴

방법: `agbrowse runway open --surface custom-tools` → Computer Use로 각 컨트롤 inspect

### 2. Explore 모드 확인

- [ ] Explore 모드 토글이 실제로 존재하는지
- [ ] Unlimited 플랜에서 Explore 선택 시 크레딧 미소모 확인
- [ ] Explore 모드에서 지원되는 모델 목록 확인

---

## Phase별 검증

### Phase 1 검증

```bash
# status 확장 확인
agbrowse runway status --json | jq '.plan, .model, .generation'

# recents 확인
agbrowse runway recents --json | jq '.assets | length'
```

통과 조건:
- [ ] status에 plan.type, model.selected, generation.mode 필드 포함
- [ ] recents가 에셋 목록을 반환 (비어있어도 ok — 구조만 확인)

### Phase 2 검증

```bash
# setup (Level 1 — Generate 안 누름)
agbrowse runway setup \
  --model seedance-2 \
  --prompt "test prompt" \
  --mode video \
  --duration 5 \
  --explore \
  --json

# 이 시점에서 사람이 Runway UI를 확인:
# - 모델이 seedance-2로 선택되었는가?
# - 프롬프트가 입력되었는가?
# - Explore 모드가 선택되었는가?
# - Duration이 5초인가?
```

통과 조건:
- [ ] setup 후 UI에 올바른 파라미터가 세팅됨
- [ ] Generate 버튼이 클릭되지 않음
- [ ] readyToGenerate: true 반환

```bash
# generate (Level 2 — 실제 생성)
agbrowse runway generate \
  --model seedance-2 \
  --prompt "A simple test: white sphere on black background" \
  --mode video \
  --duration 5 \
  --explore \
  --output ./test-output.mp4 \
  --json
```

통과 조건:
- [ ] 생성이 시작됨
- [ ] poll이 완료까지 대기
- [ ] 결과 파일이 --output 경로에 저장됨
- [ ] explore: true일 때 크레딧 미소모

### Phase 3 검증

```bash
agbrowse runway upload --file ./test-image.png --json
```

통과 조건:
- [ ] 파일이 Runway UI에 업로드됨
- [ ] 업로드된 이미지가 seed frame으로 표시됨

### Phase 4 검증

```bash
# multishot
agbrowse runway multishot \
  --shots "wide shot" "close up" "pull back" \
  --duration 15 \
  --explore \
  --output ./multishot.mp4 \
  --json
```

통과 조건:
- [ ] 3개 장면이 설정됨
- [ ] 생성 완료 + 다운로드

---

## MCP Parity 체크리스트

구현 완료 후 MCP 11개 도구 전부와 1:1 대조:

| MCP Tool | agbrowse 명령 | Parity | Exceed |
|----------|--------------|--------|--------|
| whoami | status (강화) | ✅ | ✅ 모델 동적 감지 |
| list_workspaces | status (강화) | ✅ | ✅ 브라우저 내 전환 |
| list_recent | recents | ✅ | - |
| generate_image | generate --mode image | ✅ | ✅ Explore 모드 |
| generate_video | generate --mode video | ✅ | ✅ Explore 모드 + 전체 모델 |
| generate_multishot_video | multishot | ✅ | ✅ Explore 모드 |
| generate_product_marketing_video | product-ad | ✅ | - |
| init_upload | upload | ✅ | ✅ 1단계 (vs MCP 3단계) |
| complete_upload | upload (내포) | ✅ | ✅ 자동 |
| get_task | poll | ✅ | ✅ DOM 기반 풍부한 progress |
| feedback | N/A | N/A | N/A |

## 유닛 테스트 전략

모든 신규 함수에 대해:
- DOM mock (page.evaluate 반환값 주입)
- page.goto / page.click / page.setInputFiles 호출 검증
- Safety level 위반 시 에러 throw 검증
- 타임아웃 동작 검증

```bash
npx vitest run test/unit/runway-*.test.mjs
```

## 셀렉터 깨짐 방어

Runway UI가 변경될 때를 대비:
1. `agbrowse runway status --json`이 selectorsMissing을 보고
2. 셀렉터 계약 파일(runway-selectors.mjs)만 업데이트하면 다른 코드 변경 불필요
3. Computer Use 라이브 캡처로 주기적 검증 가능

## 회귀 방어

기존 5개 명령 (selectors, status, open, preflight, poll)의 테스트가 확장 후에도 통과해야 함:
```bash
npx vitest run test/unit/runway-cli.test.mjs
```
