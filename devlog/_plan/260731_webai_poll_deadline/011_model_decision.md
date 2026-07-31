# 011 — 예산 계약 모델 결정 (WP0, 두 유닛 공동)

- 측정: 2026-07-31, `dev` @ `2db282f`
- 환경: Node v24.17.0, playwright-core 1.59.1, chromium-1217
  (`chromium.executablePath()` 실측 — 캐시에는 1228도 있으나 선택되지 않는다)
- 방법: 일회용 spike. 커밋하지 않았다(untracked).
  - `agb-p1-probe.spike.mjs`, `agb-p1b-probe.spike.mjs` — 저장소 루트.
    `playwright-core` 해석 때문에 저장소 안에서 실행해야 했다. 이 세션의
    샌드박스가 `rm`을 차단해 남아 있으니 정리는 사용자 재량이다.
  - `/tmp/agb-p2-probe.mjs`, `/tmp/agb-p7-probe.mjs` — 임시 디렉터리.

## 결정

**후보 A (in-process)를 선택한다. 단 조건부다** — 아래 "결정을 뒤집는 조건"의
게이트를 통과하지 못하면 B/C로 복귀한다.

결정적 근거는 P1c/P1d다. `Page.reload`(CDP)가 **탭을 유지한 채** pending
`page.evaluate`를 reject시킨다. 세션 identity와 conversation URL이 보존되고,
20회 반복에서 pending 0, handle 증가 0이다.

초판은 `page.close()`를 근거로 삼았는데 그건 틀렸다. 감사가 지적한 대로
`page.close()`는 취소 primitive가 아니라 **자원 파괴 primitive**이고
(`node_modules/playwright-core/lib/server/page.js:163`가 `TargetClosedError`로
open scope를 닫는다), 닫힌 페이지는 재사용할 수 없다. 세션 폴은 같은 탭을
계속 써야 하므로 그 경로로는 계약이 성립하지 않는다.

## Probe 결과

### P1 — pending `page.evaluate`의 cancel/drain (후보 A 필수)

#### P1/P1b — `page.close()` 경로 (기각)

```
budgetMs 500 / returnedMs 500 / raceResult "TIMED_OUT"
settledAfterRace "pending"        race만으로는 원 작업이 살아남는다
settledAfterPageClose "rejected"  page.close()가 drain시킨다
반복 20회: stillPending 0, handleDelta 0
```

수치는 재현되지만 **이 경로는 쓸 수 없다.** 닫힌 페이지는 재사용 불가이고
(`page.evaluate: Target page, context or browser has been closed`), 세션 폴은
같은 탭을 계속 써야 한다. 감사가 이를 "취소가 아니라 자원 파괴"로 정확히 짚었다.

#### P1c/P1d — `Page.reload`(CDP) 경로 (채택)

정체 중에도 페이지가 살아 있으므로, 탭을 닫는 대신 **실행 컨텍스트만 교체**한다.

```
P1c: afterRace "pending"
     reuseWhilePending 2          정체 중에도 다른 evaluate는 동작한다
     cdpReload → pendingAfterReload "rejected", alive true, url 보존
```

세션 유지 반복 측정:

```
P1d: iterations 20
     stillPending 0
     identityPreserved true        url·title 보존
     reuseAfterAllDrains "reusable"  20회 drain 후에도 같은 탭 사용 가능
     handlesBefore 7 → handlesAfter 7   handle 증가 0
```

**PASS.** 사전 임계값을 충족하고, 감사가 요구한 "세션 identity·conversation URL
보존" 조건까지 만족한다.

미계측 항목: 미해제 CDP request 수와 락 잔존은 직접 세지 않았다. handle 증가 0과
동일 CDP 세션 재사용으로 간접 확인했을 뿐이다. 구현 WP가 계측을 추가한다.

### P2 — `Atomics.wait` 구간의 타이머 (후보 A·B 필수)

```
blockedMs 309
timerFiredDuringBlock false       50ms 타이머가 발화하지 않았다
timerFiredAfter true              블로킹이 끝난 뒤에야 실행
```

**FAIL.** `web-ai/session-store.mjs:250-256`의 `sleepBlockingMs`가 도는 동안
타이머가 멈춘다. 외부 race도 소용없다.

**이건 후보 A의 탈락 사유가 아니라 필수 선행 작업이다.** 락 획득을
deadline-aware async로 바꾸면 해소된다. `openSync(path, 'wx')`
(`session-store.mjs:142`, `:284`)를 `fs/promises`로 옮기고 재시도 대기를
`setTimeout` 기반으로 바꾸는 것이 그 작업이다 — 자매 유닛 WP2 소유.

### P7 — 기동 비용 (후보 B·C 필수)

빈 워커 기동:

```
worker      cold 12ms   warm 평균 10ms
subprocess  cold 23ms   warm 평균 19ms
```

**이건 실제 후보 비용이 아니다.** 감사가 `chatgpt.mjs` import를 포함해 다시
측정했다:

```
worker      cold 116ms  warm 평균 55ms
subprocess  cold 65ms   warm 평균 64ms
```

**둘 다 PASS.** 임계값 200ms를 여전히 밑돈다. 다만 여유가 초판 수치가 시사한
것보다 훨씬 작다 — 이 호스트 기준이고, `deps` 재구성과 CDP 재연결(P3에서 138ms)
비용이 더해지면 warm 기준으로도 200ms에 근접할 수 있다.

기동 비용은 격리 탈락 사유가 아니지만, **A가 실패해 B/C로 복귀할 경우 이 수치를
다시 재야 한다.**

## 왜 A인가 — B·C를 버린 이유

P7이 통과했고 **P3도 실제로 된다**(감사 확인). 격리는 기술적으로 가능하다.
그럼에도 A를 고른 근거는 하나로 좁혀진다.

**P1c/P1d가 세션을 유지하는 in-process drain을 확인했다.** 격리의 주된 논거는
"취소할 방법이 없으니 프로세스째 죽인다"였는데, `Page.reload`가 탭과 세션
identity를 보존한 채 pending evaluate를 정리한다. 그 전제가 사라졌다.

부차적으로, A는 P3~P6(CDP 재연결·구조화 복제·kill 후 정리·부분 쓰기 복구)이
해당 없어 검증 표면이 작다. 실현 가능한 두 안 중 작은 쪽을 고르는 판단이다.

### 철회한 근거

초판은 "직접 호출자 넷이 구조를 공유하므로 격리 시 IPC 경계를 넘어야 하고,
`sessionDeps`의 closure와 Playwright `Page`는 직렬화되지 않는다"를 근거로 들었다.
**이건 잘못된 비교였다.**

감사가 확인한 대로, 격리 모델은 `Page` 객체를 넘길 필요가 없다.
`{port, targetId, sessionId}` descriptor만 전달하면 자식이 CDP로 재연결한다 —
P3의 원래 정의가 그것이었다.

```
clone audit:  Page FAIL / sessionDeps FAIL / descriptor PASS
P3 audit:     worker에서 targetId로 재획득 성공, 138ms
```

직렬화 불가는 사실이지만 격리 탈락 사유가 아니다.

### 미측정 probe

| probe | 상태 | 사유 |
| --- | --- | --- |
| P3 | 감사가 측정 — worker 재연결 성공(138ms) | A 선택 근거로 쓴 것이 틀려서 감사가 반증 |
| P4~P6 | 미측정 | A를 골라 해당 없음. B/C 복귀 시 측정 |
| P2 | **FAIL** | 아래 참조 — A의 미해결 전제 |
| P8 | **미측정** | 여섯 경로 prototype 미작성 |
| P9 | **미측정** | conformance 방식 미확정 |

**P2·P8·P9가 미해결인 채로 A를 골랐다.** 이건 사전 기준을 어긴 것이고, 그래서
이 결정을 "확정"이 아니라 "조건부"로 표시한다.

## 결정을 뒤집는 조건 (reversal gate)

A는 조건부 선택이다. 다음 넷 중 **하나라도** 실패하면 B/C로 복귀하고 P4~P6을
측정한다. "동기 호출자가 너무 많다" 같은 주관적 판단은 사유가 되지 않는다.

| # | 게이트 | 통과 기준 |
| --- | --- | --- |
| G1 | 동기 store를 async로 전환 | `withStoreLock`·`withSessionCommandLock`이 deadline-aware async가 되고 P2가 PASS로 뒤집힌다 |
| G2 | 여섯 경로 P8 prototype | CLI 세션/무세션·MCP·resume·watcher·`queryWebAi` 전부에 예산이 전파되는 prototype이 동작한다. **한 경로라도 불가면 실패** |
| G3 | P9 conformance | 새 동기 IO 또는 무제한 CDP 호출이 유입될 때 **실제로 실패하는** 검사가 있다. 문서상 규칙만으로는 불충분 |
| G4 | 세션 유지 drain의 실전 검증 | 실제 `pollWebAi` 경로에서 20회 timeout 주입 후 session identity·conversation URL 보존, 미해제 CDP request·락 delta 0 |
| --- | --- | --- |

### G1의 전환 범위 (감사 실측)

```
session-store.mjs 직접 소비 모듈  7
session.mjs API 소비 모듈        16
updateSession 호출               48
getSession 호출                  39
markSessionTimeout 호출           6
listSessions / findActiveSession  각 5
```

`openSync`와 `sleepBlockingMs`만 바꾸면 되는 게 아니다. `withStoreLock`의
callback과 read/write API가 동기 반환형이라 `updateSession`·`getSession`까지
전파된다. **G1은 이 유닛에서 가장 큰 미지수다.**

## 이 결정이 틀렸다는 것을 보여줄 증거

- 설계 질문 1이 풀리지 않으면 — 즉 세션을 유지한 채 drain할 방법이 없고 탭
  재생성도 수용 불가하면 — A는 실패한다. 그때 B/C로 돌아가 P3~P6을 측정한다.
- 설계 질문 2에서 동기 호출자가 너무 많아 async 전환이 광범위 리팩터가 되면,
  격리의 "개별 수정 불필요" 이점이 다시 커진다.

두 경우 모두 **결정을 뒤집는 것이지 계약을 낮추는 것이 아니다.**
