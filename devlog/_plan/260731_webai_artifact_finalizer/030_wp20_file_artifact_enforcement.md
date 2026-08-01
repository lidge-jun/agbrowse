# 030 — WP20 B25 strict enforcement 구현

- unit: `devlog/_plan/260731_webai_artifact_finalizer/`
- work-phase: WP20 (구현)
- 선행: `020_wp19_file_artifact_contract.md`

## 계약대로 만든 것

`020`이 고정한 결정을 옮겼다. **첫 구현은 여섯 군데가 계약과 달랐고**, 감사에서
전부 지적받아 고쳤다. 그 목록은 아래 "감사가 잡은 것"에 있다.

### 1. detector union (`chatgpt-files.mjs`)

`probeAssistantDownloadableFiles`를 새로 만들었다.

```js
{ ok: true, candidates } | { ok: false, reason: 'cdp-failed' | 'malformed' }
```

기존 `readAssistantDownloadableFiles`는 그대로 두고 이 함수를 감싸도록 바꿨다.
opportunistic 경로는 여전히 `[]`를 받고 싶어 하기 때문이다. **읽기 실패와 "파일
없음"을 구분해야 하는 쪽은 strict뿐이다.**

### 2. transaction owner (`session-artifacts.mjs`)

`stageFileArtifact` / `commitStagedArtifacts` / `discardStagedArtifacts` /
`artifactStillOnDisk`를 추가했다.

staging이 필요한 이유는 하나다. 기존 `saveFileArtifact`는 결정적 basename에
쓰기 때문에 **같은 이름의 기존 artifact를 덮어쓴다.** 실패 후 "방금 쓴 파일"을
지우면 이전 실행의 파일까지 사라진다. rollback이 데이터 손실을 만드는 구조였다.

그래서 임시 이름으로 먼저 쓰고, 전부 성공했을 때만 충돌 없는 최종 이름으로
옮긴다. 세션 artifact 배열도 파일마다가 아니라 한 번에 갱신한다.

### 3. strict 저장 경로

`saveAssistantDownloadableFiles`에 `strict` 플래그를 받고, 켜지면 별도 함수로
간다. 반환 형태는 `{ ok, detectedCount, savedCount, files, errors, warnings }`다.

재사용은 **디스크를 확인한 뒤에만** 한다. `candidateKey`가 맞고, 파일이 실제로
있고, 바이트 hash가 descriptor와 일치하고, `validation.ok`여야 한다. 세션 기록만
믿으면 파일이 지워졌어도 strict가 성공한다 — 이 유닛이 계속 고쳐온 fail-open과
같은 모양이다.

### 4. CLI (`cli.mjs`)

`--require-file-artifacts` + `fileArtifactPolicy`. 지원 행렬 밖 조합은
`enforceFileArtifactSupport`가 `capability.unsupported`로 거부한다.

**`ensureHeadedBrowserForWebAi`보다 앞에서** 부른다. 프롬프트를 보낸 뒤에
지원하지 않는다고 알리면 이미 부작용이 났다.

### 5. 세션 상속 (`session.mjs`)

`summarizeEnvelope`이 `require-all`을 저장하고 `resolveFileArtifactPolicy`가
단조로 병합한다. `poll`/`watch`/`resume`는 플래그를 반복하지 않으므로 입력만
보면 세션 계약이 조용히 완화된다.

### 6. completion 4곳 (`chatgpt.mjs`)

`captureFileArtifacts` 하나를 만들어 네 곳에서 부른다. 정상 경로에만 배선하면
나머지 셋이 우회한다.

원래 파일 수집은 **정상 완료 경로에만** 있었다. image shortcut·recovery·copy는
아예 수집을 하지 않았다. 그래서 이번에 셋 다 붙였다 — strict가 아니어도
opportunistic 수집이 이제 네 경로 전부에서 돈다.

### 7. timeout 봉투

`buildHardTimeoutResult`에 `errorCode: 'provider.poll-timeout'`을 넣었다. 이
봉투만 코드가 없어서 호출자가 문자열로 분기해야 했다.

## 테스트와 mutation

**GREEN은 근거가 아니다.** 각 가드를 되돌린 mutation으로 RED를 확인했다.

| 테스트 | mutation | RED 출력 |
| --- | --- | --- |
| F1 detector union | 판정 무시하고 `[]` 취급 | `expected 'no-candidates' to be 'detection-malformed'` |
| F4 rollback 보존 | staging 대신 즉시 저장 | `expected 'REPLACEMENT' to be 'ORIGINAL'` |
| F6 디스크 검증 | 세션 기록만 믿음 | `expected 1 to be greater than 1` |
| F8 staging 충돌 | staging 이름에서 slot 제거 | `expected false to be true` |
| F11 세션 쓰기 실패 | 세션 write를 try 밖으로 | `store lock unavailable` |
| Z3 세션 상속 | 입력만 읽음 | `expected true to be false` |
| S1·S4 preflight | 거부 호출 제거 | `but got 'fetch failed'` / `'browser should not be touched'` |

F4가 가장 중요하다. `REPLACEMENT`가 남는다는 것은 **이전 실행의 파일이
덮어써지고 지워졌다는 뜻**이다. 감사가 지적으로만 짚었던 데이터 손실이 실제로
재현됐다.

짝 테스트도 넣었다. F2의 후반부와 Z2는 플래그가 없을 때 같은 상황이 여전히
`complete`인지 본다. **과잉 차단은 fail-open만큼 나쁘다.**

### 하네스에서 한 번 틀렸다

Z2를 처음에 `skipFinalize: true`로 썼는데 그 플래그가 수집 자체를 건너뛴다.
검사 대상을 우회하는 하네스였다 — WP16에서 fencing 판정을 틀리게 만든 것과 같은
실수다. 플래그를 빼고서야 의미가 생겼다.

## 게이트 baseline 조정

WP13의 `no-new-blocking-io` ratchet이 이 변경을 잡았다. 설계대로 작동한 것이다.

staging·commit·rollback·hash 검증은 전부 동기 FS다. baseline을
`session-artifacts.mjs` 11 → 22, 총계 286 → 297로 올렸다.

**"기능에 내재적"이라고 쓰면 과장이다.** 이 부채는 기능이 아니라 **동기 구현**에
내재한다. `fs/promises`로 옮기면 줄어든다. 중복 cleanup 루프를 헬퍼로 합친 것도
count를 줄이려던 것이 아니라 중복 제거였다 — 감싸서 숫자만 낮추는 것은 게이트
우회일 뿐이다.

숫자를 올리는 것 자체는 게이트의 설계다. 사고로 늘어나는 것을 막되, 검토된
커밋에서는 명시적으로 올린다.

## 감사가 잡은 것

독립 감사에서 High 6건이 나왔고 전부 고쳤다. 첫 구현이 계약과 달랐던 지점들이다.

| # | 결함 | 고친 방식 |
| --- | --- | --- |
| 1 | 성공 봉투에 계약된 `artifacts`가 없었다 | `captureFileArtifacts`가 저장된 descriptor를 돌려주고 completion 4곳이 실어 보낸다 |
| 2 | watcher가 typed 실패를 벗겨내고 항상 `ok: true` | `errorCode`/`stage`/`retryHint`/`evidence` 전달, fail-closed tick에서 watch 종료 |
| 3 | 세션 index 쓰기가 rollback `try` 밖 | 안으로 옮겼다. store lock이 throw하면 publish된 파일도 되돌린다 |
| 4 | 같은 이름 후보 둘이 staging 경로를 공유 | staging 이름에 `slot` 추가 |
| 5 | rollback 실패를 삼킴 | 전 경로 시도 후 수집해 보고하고, `rollback-failed`를 첫 error로 올린다 |
| 6 | 세션 vendor가 preflight를 우회 | `--vendor`를 실제로 입력했을 때만 입력을 신뢰한다 |

4번이 가장 실질적이다. 감사가 직접 재현했고, **평범한 2파일 strict 요청이
`save-failed`로 끝났다.** 두 번째 staging 쓰기가 첫 번째를 덮어써서 commit이
없는 파일을 rename하려 했다.

6번의 원인은 파서 기본값이었다. `--vendor`가 `chatgpt`로 기본 지정되므로
`input.vendor`는 Gemini 세션에서도 truthy다. 저장된 vendor를 보려면 플래그가
실제로 입력됐는지를 먼저 봐야 했다.

### 2라운드에서 더 나온 것

첫 교정도 충분하지 않았다. 세 건이 더 나왔다.

| # | 결함 | 고친 방식 |
| --- | --- | --- |
| 7 | watcher **recovery** 경로가 같은 결함을 그대로 | reattach 후 sessionDeps에도 CDP 재주입, typed 필드 전달 |
| 8 | preflight와 runtime이 **다른 세션 ID**를 고름 | positional을 우선하고, 둘이 다르면 거부 |
| 9 | 동시 실행이 같은 final 이름을 집음 | `rename` → `link`+`unlink`. 목적지가 있으면 실패한다 |

8번이 특히 조용했다. `sessions resume <gemini-id> --session <chatgpt-id>`를 주면
preflight는 ChatGPT를 보고 통과시키는데 실제 resume은 positional을 쓴다
(`cli-sessions.mjs`). **검사한 세션과 실행한 세션이 달랐다.**

9번은 `existsSync` 후 `rename`이 원자적이지 않기 때문이다. 두 프로세스가 같은
이름이 비어 있는 것을 보고 둘 다 rename하면 나중 것이 앞의 바이트를 덮는다.
descriptor의 hash와 디스크 내용이 어긋난다. `link`는 목적지가 있으면
`EEXIST`로 실패하므로 그 창이 없다.

### F12의 범위

동기 함수 둘은 한 프로세스 안에서 인터리브되지 않는다. 그래서 F12는 경쟁 자체를
재현하지 않고, **경쟁을 안전하게 만드는 primitive**를 검사한다 — 이미 있는
파일을 덮지 않는다는 것. 처음에는 두 commit을 나란히 불러 "경쟁을 검사한다"고
적었는데, mutation에서 통과해 버려서 그 주장이 거짓임이 드러났다.

### 테스트 하나는 주장을 낮췄다

`Z4`를 "recovery completion을 검사한다"로 적었는데, mutation으로 확인하니
**recovery 배선을 지워도 통과했다.** 그 하네스는 정상 경로로 끝난다. 이름과
주석을 실제 범위로 고쳤다 — recovery와 copy는 같은 헬퍼에서 호출되므로 구조상
보장되지만, 이 테스트가 그것을 실행하지는 않는다.

같은 종류의 실수를 이 세션에서 세 번째 했다. WP16의 fencing 오판,
`skipFinalize`로 검사 대상을 우회한 Z2, 그리고 이것이다.

## 닫은 것과 닫지 못한 것

**c8(B25)**: 명시 요구가 fail-closed가 됐다. opportunistic은 그대로
best-effort다.

**c7은 닫지 않았다.** `020`이 적은 대로다 — strict 수집의 async continuation은
`stillActive`로 막지만, `writeFileSync`와 `withStoreLock`의 blocking retry는
이벤트 루프를 막으므로 어떤 재검사로도 상한을 만들 수 없다. WP2(G1)의 몫이다.

B23도 여전히 열려 있다. 동기 IO 처방 뒤에 재방문한다.
