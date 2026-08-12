# 020 — WP19 파일 아티팩트 요구 계약 (B25)

- unit: `devlog/_plan/260731_webai_artifact_finalizer/`
- work-phase: WP19 (docs-only — 공개 계약 확정, 구현은 후속)
- 선행: `010_wp11_failopen_sentinels.md`가 B24·B36을 닫았다. B25는 남았다
- 참조: `devlog/_fin/260508_oracle_parity/11_generated_images_public_contract.md`

## 지금 무엇이 문제인가

`c8`이 B25를 "fail-visible까지만 됐고 명시적 artifact 요청 계약이 필요하다"로
기록해 뒀다. 그 계약을 여기서 만든다.

현재 두 경로가 비대칭이다.

| 경로 | 실패했을 때 |
| --- | --- |
| `--output-image` | typed error로 실패한다 (`chatgpt.mjs`의 `provider.image-output`) |
| 일반 첨부파일 수집 | warning만 남기고 `status: 'complete'`로 나간다 |

두 번째가 fail-open이다. CDP를 못 얻으면 `file-artifact-cdp-unavailable`,
예외가 나면 `file-artifact-capture-failed:...`를 warning에 넣고 답변은 성공으로
간다. 첨부가 조용히 사라진 응답과 애초에 첨부가 없던 응답이 같은 모양이다.

탐지 단계도 같은 형태다. `readAssistantDownloadableFiles`가 파싱에 실패하면
`[]`를 돌려준다(`chatgpt-files.mjs:327-331`). **"파일이 없다"와 "읽을 수
없었다"가 같은 값이다.** WP10~WP15에서 여섯 번 고쳤던 바로 그 모양이 여기 또
있다.

## 왜 그냥 fail-closed로 못 바꾸는가

이 경로에는 **호출자가 요구를 표현할 방법이 없다.**

독립 감사로 전수 확인했다. 요구 신호가 될 만한 것이 하나도 없다.

- CLI에는 `--output-image`뿐이고 일반 응답 파일 옵션이 없다
- `--output`은 런타임 계약이 아니라 프롬프트에 렌더링되는 텍스트다
  (`question.mjs`)
- `attachmentPolicy`/`filePath`/`filePaths`는 **입력 업로드** 계약이다
- 세션 `envelopeSummary`에도 없다
- MCP schema에도 없고 `additionalProperties: false`라 우회 전달도 막혀 있다
- `session.artifacts`는 결과 기록이지 사전 요구가 아니다

수집이 도는 조건은 `session && !input.skipFinalize`가 전부다. 설계상
opportunistic이다.

그래서 정확한 진술은 이렇다.

> 요구 신호 없이 CDP 부재를 무조건 실패로 바꿀 수는 있다. 하지만 **첨부가
> 없는 평범한 텍스트 응답까지 깨뜨리지 않으면서** 의미 있게 fail-closed로
> 만들 수는 없다.

프롬프트에 "CSV로 만들어줘"라고 적혀 있어도 그건 자유 텍스트다. 저장 계약을
자연어에서 추론하면 안 된다.

## 계약

이미지 계약이 이미 답을 정해 놓았다. **명시 출력은 실패시키고 암묵 저장은
warning으로 남긴다**(`11_generated_images_public_contract.md`). 파일도 같은
비대칭을 따른다. 새 원칙을 만들지 않는다.

| 요구 | 동작 |
| --- | --- |
| 명시적으로 요구했다 | 검증·저장을 증명하지 못하면 **fail-closed** |
| 요구하지 않았다 | warning을 남기는 **best-effort** |

### 표면

- CLI: `--require-file-artifacts`
- 내부: `fileArtifactPolicy: 'best-effort' | 'require-all'`
- 기본: `best-effort` — 기존 동작이 그대로 기본값이다
- 저장 위치: 기존 세션 artifact 디렉터리 (새 경로를 만들지 않는다)

### `require-all`의 실패 조건

네 가지가 typed failure다. **단, 예산 안에서 판정을 마쳤을 때다** — hard
deadline이 먼저 이기면 코드가 달라진다(아래 "에러 코드는 둘로 갈린다").

1. CDP 부재 또는 획득 실패
2. 탐지 결과를 검증할 수 없음 (파싱 실패 등)
3. 후보 0개
4. 탐지한 후보 중 하나라도 fetch/save 실패
5. 위가 아니면 — 전부 저장된 경우만 `complete`

3번을 실패로 두는 이유가 있다. 요구했는데 후보가 0개면 그건 "파일 없는 정상
응답"이 아니라 **요구가 충족되지 않은 것**이다. best-effort에서는 정상이다.

## 플래그만 추가하면 안 되는 이유

지금 반환값으로는 위 조건을 판정할 수 없다. 두 helper의 반환 계약을 먼저
고쳐야 한다. **정확한 형태를 여기서 고정한다** — 대안을 나열해 두면 구현
단계에서 다시 설계 판단이 된다.

`readAssistantDownloadableFiles`는 malformed에 `[]`를 준다
(`chatgpt-files.mjs:327-331`). 후보 0개와 구분되지 않으니 실패 조건 1·3을
판정할 수 없다. 판별 가능한 union으로 바꾼다.

```js
{ ok: true, candidates }
| { ok: false, reason: 'cdp-failed' | 'malformed' }
```

`saveAssistantDownloadableFiles`는 부분 실패에도 항상 `ok: true`다
(`chatgpt-files.mjs:396-403`, `:446`). 아래 형태로 바꾼다.

```js
{ ok, detectedCount, savedCount, files, errors, warnings }
```

### 저장 위치를 어떻게 공개하는가

descriptor의 `path`는 artifact 디렉터리 기준 상대 basename이다
(`session-artifacts.mjs:229`). 공개 계약은 **`sessionId` + 상대 경로**로
정한다. 절대 경로를 새로 노출하지 않는다 — artifact 디렉터리 위치는 이미
세션에 종속된 내부 규약이고, 절대 경로를 계약에 넣으면 그 규약이 고정된다.

### 부분 저장의 디스크 의미 — staging 후 commit

"부분 저장은 실패"는 **명령의 status만** 정한다. 디스크에 남은 파일까지
정하지는 않는다. 결정한다.

> 실패하면 **이번 transaction이 만든 것만** 되돌린다.

"그냥 지운다"로 적으면 안 된다. 현재 저장은 deterministic basename에
`writeFileSync`를 하므로 **같은 이름의 기존 artifact를 덮어쓴다**
(`session-artifacts.mjs:229`). 실패했다고 그 파일을 지우면 이번 실행 이전에
있던 artifact까지 잃는다. 세션 기록도 마찬가지다 — 같은 path의 descriptor를
교체하므로(`session-artifacts.mjs:324`) 방금 추가한 것을 빼는 것만으로는
이전 descriptor가 돌아오지 않는다. **rollback이 데이터 손실을 만든다.**

그래서 알고리즘을 고정한다.

1. 모든 다운로드를 **staging 경로**에 먼저 모은다. 기존 파일을 건드리지 않는다
2. 전부 성공했을 때만 final path로 commit한다. final 이름은 기존 artifact와
   **충돌하지 않게** 생성한다
3. 세션 artifact 배열은 파일마다가 아니라 **한 번의 batch update**로 쓴다
4. 실패하면 **이 transaction이 만든 파일만** 제거한다. 기존 파일과 기존
   descriptor는 손대지 않는다
5. rollback 자체가 실패하면 삼키지 않고 `evidence.reason: 'rollback-failed'`로
   드러낸다

현재 구현은 파일마다 즉시 저장하고 곧바로 세션에 기록한 뒤 다음으로 넘어간다
(`chatgpt-files.mjs:411`). 그 순서를 위 형태로 바꾸는 것이 구현의 핵심이다.

필요한 테스트:

- 같은 이름의 기존 artifact가 있는 상태에서 두 번째 파일 write 실패 →
  **기존 파일의 바이트와 기존 descriptor가 그대로인지**
- 세션 index 갱신 실패
- rollback 실패의 표면화

### "저장 증명"의 범위

`appendArtifactRecord`의 반환을 지금은 검사하지 않는다
(`chatgpt-files.mjs:443`). strict에서 저장 증명은 **파일 write와 세션 index
기록 둘 다**를 뜻한다. 파일만 있고 index에 없으면 `sessions show`로 찾을 수
없으므로 요구를 충족한 것이 아니다.

## 배선해야 할 경로

정상 completion 한 곳만 막으면 우회된다. `status: 'complete'`로 나가는 경로가
넷이다.

| 경로 | 비고 |
| --- | --- |
| 정상 complete | 현재 수집이 붙어 있는 유일한 곳 |
| image shortcut | 첫 이미지에서 즉시 반환 |
| recovery complete | 데드라인 이후 복구 |
| copy complete | copy-markdown fallback |

`queryWebAi`가 poll에 넘기는 필드가 제한적이라 요구 신호를 거기에도 추가해야
한다. 요구는 세션 `envelopeSummary`에도 보존해야 send 이후의
poll/watch/resume이 이어받는다.

### 정책 병합은 단조다

저장된 `require-all`은 플래그 없는 후속 poll에서 **내려가지 않는다.**

```
유효 정책 = (input === 'require-all' || stored === 'require-all')
          ? 'require-all' : 'best-effort'
```

플래그를 빠뜨린 poll 한 번으로 세션 계약이 조용히 완화되면 계약이 아니다.

### watcher의 CDP 주입

구현 함정이 하나 있다. CLI poll과 `sessions resume`은 resolved page에 맞춰
`getCdpSession`을 새로 주입하지만(`cli.mjs:1263`), watcher는 `getPage`와
`getTargetId`만 교체한다(`watcher.mjs:229-232`).

watch가 엄격 세션 정책을 상속한다면 watcher도 resolved page에 CDP를 묶어야
한다. 아니면 **다른 탭의 후보를 읽을 수 있다.** 이건 정적 호출 구조에서 나온
추론이고 런타임으로 재현하지는 않았다 — 구현 phase에서 행동 테스트로 확인한다.

## 지원 행렬 — 지원하지 않는 조합은 거부한다

`--require-file-artifacts`는 공통 parser에 들어가므로 guard가 없으면 아무
명령에나 붙는다. 조용히 무시되면 그게 또 하나의 fail-open이다.

| 조합 | 동작 |
| --- | --- |
| ChatGPT `send`/`query`/`poll`/`watch`/`sessions resume` | **지원** |
| non-ChatGPT provider (Gemini/Grok) | `capability.unsupported`로 거부 |
| follow-up (`skipFinalize: true`) | `capability.unsupported`로 거부 |
| deep research | `capability.unsupported`로 거부 |
| code mode | `capability.unsupported`로 거부 |
| 세션 없는 직접 poll | 거부 — 이 플래그는 `--session`을 필수로 한다 |

거부는 **브라우저를 건드리기 전에** 한다. 탭을 열고 프롬프트를 보낸 뒤에
지원하지 않는다고 알리면 이미 부작용이 났다.

non-ChatGPT provider가 자기 `complete`를 반환하는 경로(`cli.mjs:1513`),
follow-up이 `skipFinalize: true`로 우회하는 경로(`cli.mjs:1544`), deep
research 분기(`cli.mjs:1541`) 셋 다 ChatGPT 파일 수집을 실행하지 않는다.
세션 없는 poll은 애초에 저장할 artifact 디렉터리가 없다 — 현재 수집 조건이
`session && !skipFinalize`인 이유다(`chatgpt.mjs:1181`).

## MCP의 정확한 위치

"CLI-only"는 **요구를 생성하는 표면**에 대한 말이다. 집행까지 면제되지 않는다.

> MCP는 요구를 생성할 수 없다. 하지만 CLI가 만든 `require-all` 세션을
> `web_ai_wait_response`로 기다릴 때는 저장된 정책을 **집행한다.**

MCP wait는 저장된 세션을 그대로 poller에 넘긴다(`mcp-server.mjs:329`). 거기서
정책을 best-effort로 낮추면 세션 계약 위반이다.

## hard deadline과의 우선순위

두 계약이 충돌한다. 다운로드 한 건의 timeout이 30초인데
(`chatgpt-files.mjs:338`) recovery reserve는 최대 2초다(`chatgpt.mjs:75`).
hard deadline race가 먼저 이기면 반환값은 `provider.file-artifact`가 아니라
일반 poll timeout이다.

결정한다.

> **hard deadline이 우선이다.** artifact 검증 중 예산이 끝나면
> `provider.poll-timeout`도 유효한 fail-closed 결과다.

`--timeout`은 호출자에게 한 약속이고, 그 약속을 artifact 검증이 깨면 #88을
되돌리는 셈이다. 두 결과 모두 "요구가 충족되지 않았다"를 뜻하므로 계약상
손실이 없다.

### 그런데 이 결정이 c7을 다시 연다

여기에 함정이 있다. 반환만 빠르게 하고 끝내면 **이번 계약이 새로운 late side
effect를 만든다.**

`commitAsyncIfActive`는 async 작업 **시작 전에만** 검사한다(WP17에서 명시적으로
그렇게 적었다). strict 수집이 데드라인 직전에 시작되고 fetch가 pending이면:

1. wrapper가 `provider.poll-timeout`을 반환한다
2. fetch는 계속 진행한다
3. 나중에 resolve되면 **파일을 쓰고 세션 index를 갱신한다**

WP16~WP18이 닫은 fencing이 그대로 다시 열린다. 그러므로 다음이 이 계약의
일부다.

- helper에 `stillActive` 또는 데드라인 `AbortSignal`을 전달한다
- **각 await 뒤, 그리고 disk/index write 직전에 재검사한다**
- hard timeout 시 진행 중인 fetch를 abort한다
- timeout 이후 resolve된 CDP/fetch 결과가 파일이나 세션 record를 만들지
  못하게 한다
- staging된 transaction-owned 파일은 정리한다

짝 테스트: fetch pending → hard timeout 반환 → fetch 해제 → 더 기다림 →
**파일과 세션 artifact가 여전히 없음.** post-await 게이트를 지웠을 때 RED여야
한다.

#### 이 보장의 정확한 범위

WP20이 막는 것을 과장하면 안 된다. 정확히 이만큼이다.

> **hard timeout 반환 이후 async continuation이 새 write를 시작하지 못한다.**

이미 시작된 **동기** 구간까지 막지는 못한다. final commit primitive가 동기이기
때문이다 — 파일은 `writeFileSync`, 세션 index는
`updateSession → patchSession → withStoreLock`이고, 그 락은 최대 200회의
blocking retry를 돈다(`session-store.mjs:136`).

`stillActive` 검사를 통과한 직후 `writeFileSync`나 `withStoreLock` 안에서
데드라인을 넘길 수 있다. 그동안 event loop가 막혀 **hard-deadline 타이머 자체가
실행되지 않는다.** 재검사로는 이걸 못 막는다.

이 유닛의 `000_plan.md`가 처음부터 적어둔 결론이 그것이다 — 동기 구간에는 race가
작동하지 않고 WP2(동기 IO 처방)가 필요하다. WP20이 hard deadline 전체를
보장한다고 쓰면 그 결론과 모순된다.

그래서 나눈다.

| 범위 | 담당 |
| --- | --- |
| async loser의 post-timeout write 차단 | **WP20** |
| 동기 write·store lock의 wall-time 상한 | WP2 (G1). 그때까지 c7 open |

WP20의 선행이 WP19뿐이라는 것은 유지된다. 대신 WP20은 c8을 닫고, c7의 동기
구간은 열어 둔 채로 남긴다.

`file-artifact-unverified` warning도 timeout **이전에** 공유 ledger에 넣어야
한다. loser가 timeout 이후에 warning을 추가하면 이미 만들어진 봉투에는
닿지 않는다.

### 에러 코드는 둘로 갈린다

"다섯 조건 전부 `provider.file-artifact`"는 위 결정과 모순이었다. 정정한다.

| 상황 | 코드 |
| --- | --- |
| strict 검증이 판정을 마쳤다 | `provider.file-artifact` |
| hard deadline이 먼저 이겼다 | `provider.poll-timeout` + `file-artifact-unverified` |

두 번째 줄은 지금 소스와 다르다. `buildHardTimeoutResult`는 `errorCode`를 아예
담지 않는다(`chatgpt.mjs`) — `status: 'timeout'`, `retryHint`, `error` 문자열만
있다. `provider.poll-timeout`은 throw 경로와 세션 `lastError`에는 있지만 이
공개 봉투에는 없다.

그래서 **WP20의 변경 대상에 `buildHardTimeoutResult`를 넣는다.**
`errorCode: 'provider.poll-timeout'`을 추가해 typed 계약을 일치시킨다. 문서를
"코드 없는 timeout"으로 낮추는 쪽은 택하지 않는다 — 이 봉투만 코드가 없으면
호출자가 분기할 방법이 달라진다.

테스트는 hard timeout 결과의 `errorCode`·`retryHint`·warning을 전부 직접
assert한다.

### commit이 끝난 뒤 timeout이 이기면

순서상 가능한 경로가 하나 더 있다.

1. 파일 final commit 성공
2. 세션 artifact batch update 성공
3. `complete` 반환 **직전에** hard deadline 승리
4. 호출자는 `provider.poll-timeout`을 받는데 파일과 descriptor는 남아 있다

이때 rollback하지 **않는다.** 결정한다.

> **성공한 batch는 유지한다.** 다음 poll이 그것을 재사용한다.

timeout 직후에 rollback을 돌리면 그 rollback 자체가 또 하나의 late side
effect다. 방금 막으려던 것을 다른 이름으로 하는 셈이다. 앞의 "rollback" 결정은
**helper 내부의 부분 실패**에만 적용된다 — 그 둘은 다른 상황이다.

대신 재사용을 계약으로 만든다. 그러지 않으면 재poll이 같은 후보를
collision-free 이름으로 **또 저장한다.**

#### key의 구성

```
candidateKey   = hash(sessionId, baselineAssistantCount, normalizedSourceUrl)
transactionKey = hash(sessionId, baselineAssistantCount, sortedCandidateKeys)
```

`kind: 'file'` descriptor에 두 key를 저장한다. descriptor는 이미 `sourceUrl`,
`path`, `sha256`, `sizeBytes`, `validation`을 갖고 있으므로
(`session-artifacts.mjs:20-30`) 필드 두 개만 추가하면 된다.

#### 재사용은 디스크를 확인한 뒤에만

세션 record만 보고 `savedCount`에 넣으면 **파일이 지워졌어도 strict 계약이
성공한다.** 그건 이 유닛이 계속 고쳐온 fail-open과 같은 모양이다.

재사용하려면 다섯 가지가 전부 성립해야 한다.

1. `candidateKey`가 일치한다
2. descriptor의 `path`가 해당 세션 artifact 디렉터리 안에 있다
3. 파일이 실제로 존재한다
4. 실제 바이트 hash가 `descriptor.sha256`과 일치한다
5. `validation.ok`가 true다

하나라도 어긋나면 재사용하지 않는다. 다시 수집하거나 strict failure로 간다.

- 같은 응답 turn을 재poll하면 검증을 통과한 기존 artifact를 `savedCount`에
  포함한다
- `artifacts` 결과에는 신규와 재사용 descriptor를 **한 번만** 노출한다

테스트:

- batch·index 성공 → complete 직전 timeout → 재poll → **artifact 개수와 파일
  바이트가 늘지 않고 기존 descriptor를 재사용**
- descriptor는 있는데 **파일이 없다**
- 파일은 있는데 **hash가 다르다**
- 다른 baseline/turn의 같은 sandbox path → **재사용하지 않는다**
- 재사용 검증 guard를 지운 mutation → RED

### retryHint는 원인별로 다르다

고정된 `poll-or-resume`은 원인들에 맞지 않는다. **machine-readable 문자열로**
고정한다 — 설명 문구는 hint가 아니다.

| 원인 | retryHint | evidence.reason |
| --- | --- | --- |
| CDP 부재/획득 실패 | `start-headed` | `cdp-unavailable` |
| 탐지 결과 검증 불가 | `poll-or-resume` | `detection-malformed` |
| 후보 0개 | `retry-without-require` | `no-candidates` |
| fetch 실패 | `poll-or-resume` | `fetch-failed` |
| save 실패 | `check-artifact-storage` | `save-failed` |
| rollback 실패 | `check-artifact-storage` | `rollback-failed` |

### 결과 필드

공개 envelope은 **`artifacts: ArtifactDescriptor[]`** 하나로 노출한다. 세션이
이미 쓰는 용어이므로 새 이름을 만들지 않는다.

`errors`의 원소도 형태를 고정한다.

```js
{ reason, candidate?, message? }
```

`ok`는 `detectedCount > 0 && savedCount === detectedCount && errors.length === 0`
으로 판정한다.

## 이 사이클에서 확정한 선택

감사가 열어 둔 질문들에 답을 박아 둔다. 구현이 이 답에서 벗어나면 그건 계약
변경이지 구현 재량이 아니다.

| 질문 | 결정 |
| --- | --- |
| `require-all`인가 "하나 이상"인가 | **require-all**. 부분 저장은 실패다 |
| 저장 위치 | 기존 세션 artifact 디렉터리. 새 output directory 없음 |
| send 이후 지속 | `envelopeSummary`에 보존, poll/watch/resume이 상속 |
| recovery/copy | **지원한다.** 네 completion 경로 전부 배선 |
| follow-up | 이번 범위 **밖**. `skipFinalize`가 수집을 건너뛴다 |
| deep-research | 이번 범위 **밖** |
| MCP | 요구 생성은 **CLI-only**. 저장된 정책 집행은 MCP wait도 한다 |
| 에러 코드 | `provider.file-artifact`, stage `file-artifact`. retryHint는 **원인별** |
| 범위 밖 조합 | 조용히 무시하지 않고 `capability.unsupported`로 **거부** |
| 정책 병합 | 단조 — 저장된 `require-all`은 내려가지 않는다 |
| 부분 저장 디스크 | rollback. 세션 artifact 기록도 되돌린다 |
| deadline 충돌 | hard deadline 우선. timeout도 유효한 fail-closed |
| deadline 이후 write | **금지.** helper에 `stillActive` 전달, await 뒤·write 직전 재검사 |
| 보장 범위 | async continuation의 신규 write만. 동기 구간은 WP2까지 open |
| commit 후 timeout | rollback하지 않는다. 다음 poll이 재사용 |
| 결과 필드 | `artifacts: ArtifactDescriptor[]` |
| rollback 범위 | transaction이 만든 것만. staging 후 commit |
| timeout 봉투 | `buildHardTimeoutResult`에 `errorCode` 추가 (WP20 범위) |
| 재사용 판정 | candidateKey + 디스크 존재 + hash 일치 + validation.ok |

도움말 문구도 공집합 해석이 모호하지 않게 적는다 — "파일이 하나 이상
탐지되어야 하고, 탐지된 파일은 전부 저장되어야 한다."

## c8 문구 교정

`c8`이 "artifact 수집 실패는 실패"로 읽히게 적혀 있다. 그건 과잉이다. 정직한
표현은 대칭 계약이다.

> 명시적으로 파일 artifact를 요구한 경우, 검증·저장을 증명하지 못하면
> fail-closed. 요구하지 않은 opportunistic 수집은 warning을 남기는
> best-effort.

## 왜 여기서 멈추는가

이 문서는 구현하지 않는다. 확정할 공개 계약이 여덟 가지였고 그걸 먼저 고정하지
않으면 정상 경로 하나만 엄격해지고 나머지 셋이 우회하는 코드가 나온다. 감사가
지적한 재작업 위험이 그것이다.

구현은 다음 work-phase 하나로 묶는다.

### 변경 대상

| 영역 | 내용 |
| --- | --- |
| CLI | flag, help 문구, preflight 거부 |
| 전달 | input → `queryWebAi` → poll |
| 세션 | `envelopeSummary` 저장 + 단조 병합 |
| helper | detector/save의 판별 가능한 반환 |
| transaction | staging·commit·cleanup owner, candidate/transaction key |
| timeout 봉투 | `buildHardTimeoutResult`에 `errorCode` |
| 완료 경로 | ChatGPT completion 4곳 |
| 상속 | watcher, resume, MCP wait |
| 문서 | error taxonomy, README, skill |

### 테스트 행렬

각 항목은 해당 조건을 지웠을 때 RED가 되는 mutation과 짝을 이룬다. mutation
없이 GREEN인 테스트는 근거가 아니다 — 이 유닛에서 반복해 확인한 것이다.

- strict 실패 5종 각각
- best-effort 짝 — 첨부 없는 평범한 응답이 여전히 `complete`인지.
  **과잉 차단은 fail-open만큼 나쁘다**
- 지원하지 않는 조합의 거부 (provider/follow-up/deep-research/code mode)
- 세션 없는 poll의 거부
- deadline 우선순위 — artifact 검증 중 예산 소진
- **deadline 이후 late write 금지** — fetch pending 상태로 timeout 반환 후
  fetch를 풀어도 파일·세션 record가 생기지 않는지
- **commit 후 timeout의 재사용** — batch·index 성공 직후 timeout이 이기고
  재poll했을 때 artifact 개수와 파일 바이트가 늘지 않는지
- 부분 저장 rollback — 특히 **같은 이름의 기존 artifact가 보존되는지**
- rollback 실패의 표면화
- 정책 단조 병합 — 플래그 없는 후속 poll이 요구를 내리지 않는지
- 네 completion 경로 전부. **하나라도 빠지면 met이 아니다**
- 거부가 **브라우저 준비 함수 호출 전에** 일어나는지. `sessions resume`은
  현재 `ensureHeadedBrowserForWebAi` 이후에 dispatch되므로(`cli.mjs:840`)
  preflight를 그보다 앞으로 빼야 한다
