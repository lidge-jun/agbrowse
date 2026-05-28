# agbrowse runway 현재 구현 정리

## 파일 구조

```
skills/browser/runway.mjs          — CLI 엔트리 + 셀렉터 계약 + 페이지 검사 (500줄)
skills/browser/runway-monitor.mjs  — poll/completion 감시 (320줄)
test/unit/runway-cli.test.mjs      — 유닛 테스트 (280줄)
```

## 현재 명령 (5개)

| 명령 | 기능 | 뮤테이션 | 비고 |
|------|------|---------|------|
| `selectors` | 셀렉터 계약 출력 | 없음 | `--surface apps\|custom-tools\|all` `--json` |
| `status` | 현재 Runway 탭 검사 | 없음 | `--surface auto\|apps\|custom-tools` `--json` |
| `open` | 지정 서피스로 네비게이션 + 검사 | 네비게이션만 | `--surface apps\|custom-tools` `--timeout ms` |
| `preflight` | open + status | 네비게이션만 | open의 별칭 |
| `poll` | 큐/완료 신호 감시 | 없음 | `--timeout` `--interval` `--queue-limit` `--after-count` `--expected-item` |

## 현재 서피스 (6개)

| 서피스 | deepAutomation | URL 존재 | 상태 |
|--------|---------------|----------|------|
| apps | ✅ | ✅ `?mode=apps` | 검사 + 네비게이션 가능 |
| custom-tools | ✅ | ✅ `?mode=tools` | 검사 + 네비게이션 가능 |
| agent | ❌ | ❌ | 서피스 감지만 |
| recents | ❌ | ❌ | 서피스 감지만 |
| workflow | ❌ | ❌ | 서피스 감지만 |
| characters | ❌ | ❌ | 서피스 감지만 |

## 현재 셀렉터 계약

### 공통
- `left-sidebar`: `[data-testid="mira-app-sidebar"]`
- `unlimited-plan-indicator`: `[data-testid="credit-info-button"]`

### Apps 서피스
- `apps-search`: `input[placeholder="Describe your creation or search apps"]`
- `models-tab`: `role=tab[name="Models"]`
- `model-card`: `role=button[name=/^Seedance 2\.0 - Video$/]`

### Custom/tools 서피스
- `prompt-editor`: `div[aria-label="Prompt"]`
- `file-input`: `input[type="file"]`
- `base-model-select`: `[data-testid="select-base-model"]`
- `related-apps`: `#related-apps-trigger`
- `generation-cost`: `role=button[name=/^View generation cost$/]`
- `generate`: `role=button[name=/^Generate$/]` **[blocked]**

## Safety 계약 (현재)

```
mutationAllowed: false
blockedActions: ['Generate', 'Run all', 'payment', 'destructive', 'submit-like controls']
```

모든 명령이 read-only. Generate 버튼 클릭 절대 금지.

## Poll 감시 신호

- Progress: `\b(?:100|[1-9]?\d)\s*%(?!\w)` 패턴
- Active: `generating|queued|processing|in queue|loading animation`
- Queue gate: `you're on a roll|please wait for your last generation|switch to credits mode`
- Output: `.mp4|.png|.jpg` 또는 `use frame|reuse settings|see full prompt`

## 현재 구현에서 **안 하는 것** (전부 확장 대상)

1. ❌ 모델 선택 — base-model-select 셀렉터는 있지만 클릭하지 않음
2. ❌ 프롬프트 입력 — prompt-editor 셀렉터는 있지만 텍스트 삽입하지 않음
3. ❌ 파라미터 설정 — duration, ratio, resolution 조작 안 함
4. ❌ 파일 업로드 — file-input 셀렉터는 있지만 파일 주입하지 않음
5. ❌ 생성 실행 — Generate 버튼 클릭 금지
6. ❌ 결과 다운로드 — 생성된 에셋 URL 추출/다운로드 안 함
7. ❌ Explore/Credits 모드 전환 — 모드 토글 조작 안 함
8. ❌ Recents 에셋 목록 — DOM 파싱 안 함
9. ❌ 워크스페이스 정보 — plan 타입, 잔여 크레딧 상세 추출 안 함
10. ❌ Video-to-video — 기존 영상 편집 워크플로우 없음
