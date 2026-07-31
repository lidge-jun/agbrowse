# 011 — 예산 계약 모델 결정 (WP0, 두 유닛 공동)

- 측정: 2026-07-31, `dev` @ `2db282f`
- 환경: Node v24.17.0, playwright-core 1.59.1, chromium-1228
- 방법: 일회용 spike. 커밋하지 않았다(untracked).
  - `agb-p1-probe.spike.mjs`, `agb-p1b-probe.spike.mjs` — 저장소 루트.
    `playwright-core` 해석 때문에 저장소 안에서 실행해야 했다. 이 세션의
    샌드박스가 `rm`을 차단해 남아 있으니 정리는 사용자 재량이다.
  - `/tmp/agb-p2-probe.mjs`, `/tmp/agb-p7-probe.mjs` — 임시 디렉터리.

## 결정

**후보 A (in-process)를 선택한다.**

결정적 근거는 P1이다. `page.close()`가 pending 상태의 `page.evaluate`를
**reject시켜 drain한다** — Playwright에 취소 API가 없다는 것과 별개로,
페이지 수명주기가 취소 수단이 된다.

## Probe 결과

### P1 — pending `page.evaluate`의 cancel/drain (후보 A 필수)

```
budgetMs 500
returnedMs 500                    race는 예산대로 반환
raceResult "TIMED_OUT"
settledAfterRace "pending"        race만으로는 원 작업이 살아남는다
settledAfterPageClose "rejected"  page.close()가 drain시킨다
pageCloseMs 212
```

보강 측정 (P1b, 반복 20회):

```
iterations 20
stillPendingAfterClose 0          누적 없음
strayIterations []
handlesBefore 7 → handlesAfter 7  handle 증가 0
```

**PASS.** 사전 임계값("반복 폴 20회 후 outstanding operation·handle 증가 0")을
충족한다.

주의: 이건 `page.close()`를 **계약의 일부로 쓴다**는 뜻이다. 예산 만료 시
페이지를 닫아야 drain되므로, 세션 폴처럼 페이지를 재사용해야 하는 경우
대안이 필요하다 — 아래 "남은 설계 질문" 참조.

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

```
worker      cold 12ms   warm 평균 10ms
subprocess  cold 23ms   warm 평균 19ms
```

**둘 다 PASS.** 임계값 200ms를 크게 밑돈다. 기동 비용은 격리 모델의 탈락
사유가 아니다.

## 왜 A인가 — B·C를 버린 이유

P7이 통과했으므로 격리도 기술적으로 가능하다. 그럼에도 A를 고른 근거:

1. **P1이 in-process 취소 수단을 확인했다.** 격리의 주된 논거는 "취소할 방법이
   없으니 프로세스째 죽인다"였는데, `page.close()`가 그 전제를 무너뜨렸다.
2. **격리는 P3~P6를 모두 통과해야 한다.** CDP 재연결, 구조화 복제, kill 후 정리,
   부분 쓰기 복구. A는 그 넷이 아예 해당 없다. 실현 가능한 두 안 중 검증 표면이
   작은 쪽을 고르는 게 맞다.
3. **직접 호출자 넷(P8)이 구조를 공유한다.** MCP·resume·watcher·`queryWebAi`가
   모두 같은 프로세스에서 `deps`를 조립한다. 격리를 고르면 넷 모두 IPC 경계를
   넘어야 하고, `sessionDeps`의 closure와 Playwright `Page`는 직렬화되지 않는다.

**P3~P6은 측정하지 않았다.** A를 고른 이상 해당 없기 때문이다. 격리로 돌아가야
할 상황이 오면 그때 측정한다.

## 남은 설계 질문 (구현 WP가 답한다)

P1이 답한 것은 "drain 수단이 존재한다"까지다. 계약으로 만들려면 셋이 남는다.

1. **페이지 재사용과 drain의 충돌.** 세션 폴은 같은 탭을 계속 쓴다.
   `page.close()`로 drain하면 세션이 끊긴다. 대안: 정체 감지 시 탭을 재생성하고
   세션을 재바인딩하거나, `page.close()` 없이도 drain되는 다른 경로를 찾는다.
   이건 자매 유닛 WP3(진입점 배선)와 이 유닛 WP1의 공동 과제다.
2. **동기 IO를 실제로 async로 옮길 수 있는가.** P2가 실패했으므로 이게 A의
   전제 조건이다. `withStoreLock`과 `withSessionCommandLock` 둘 다 대상이고,
   기존 동기 호출자가 몇인지 세어야 한다.
3. **P9 conformance.** 새 동기 IO나 무제한 CDP 호출이 유입되는 걸 막는 방법.
   lint 규칙이 가장 유력하지만 CDP는 타입으로 잡기 어렵다.

## 이 결정이 틀렸다는 것을 보여줄 증거

- 설계 질문 1이 풀리지 않으면 — 즉 세션을 유지한 채 drain할 방법이 없고 탭
  재생성도 수용 불가하면 — A는 실패한다. 그때 B/C로 돌아가 P3~P6을 측정한다.
- 설계 질문 2에서 동기 호출자가 너무 많아 async 전환이 광범위 리팩터가 되면,
  격리의 "개별 수정 불필요" 이점이 다시 커진다.

두 경우 모두 **결정을 뒤집는 것이지 계약을 낮추는 것이 아니다.**
