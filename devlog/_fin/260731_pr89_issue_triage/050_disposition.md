# 050 — PR #89 / 이슈 #87 · #88 처분 권고 (실행은 사용자 승인 대기)

- 작성: 2026-08-06, dev @ `556db70` (origin/dev + 로컬 9커밋, 미푸시)
- 선행: `002_pr89_delta_inventory.md`(2026-07-31 원장), `010_wp2_family_probe_and_mcp.md`
- **이 문서는 권고와 초안만 담는다.** push / merge / PR close / issue close는
  전부 사용자 결정이다.

## 전제 상태

| 항목 | 상태 | 확인 |
| --- | --- | --- |
| PR #89 | OPEN, base `main`, head `hanbinnoh:fix/web-ai-family-cli-wiring`, 커밋 `d5d9475`(#87) + `4ada9cb`(#88) | `gh pr view 89` 2026-08-05 |
| 이슈 #87 | OPEN | `gh issue list` 2026-08-05 |
| 이슈 #88 | OPEN | 동상 |
| 로컬 dev | origin/dev보다 9커밋 앞(`0d007ee`~`556db70`), **미푸시** | `git log origin/dev..dev` |

어떤 처분도 로컬 9커밋의 push 없이는 근거가 원격에서 보이지 않는다.
**순서상 push 승인이 모든 처분의 선행 조건이다.**

## PR #89 — 권고: close (merge 아님)

두 커밋 모두 dev의 독립 구현이 기능적으로 흡수했다. merge 불가 사유는 002가
상세 기록한 컨텍스트 불일치다 — PR은 구버전 리더(`readAssistantMessages` 직접
evaluate)를 전제하고, dev는 분할 리더(`readAssistantSnapshotSources`,
`chatgpt-response-dom.mjs:297`)로 이미 리팩터됐다. hunk가 적용되지 않고,
PR의 trimmed 읽기는 dev의 correlate 좌표계를 깨뜨린다.

커버리지 대조:

| PR 커밋 | 의도 | dev 커버리지 |
| --- | --- | --- |
| `d5d9475` fix(web-ai): carry --family through the CLI and MCP send paths | #87 | CLI 배선은 `f8e8b9b`(`cli.mjs:615/761/1692-1701`, `chatgpt-model.mjs:400-552`). 잔여 갭 2건(probe가 family 무시, MCP 비-ChatGPT 무음 드롭)은 `76e4793`이 구현 — probe fail-closed + MCP `capability.unsupported` 거부 |
| `4ada9cb` fix(web-ai): bound assistant DOM reads by the polling deadline | #88 | `8a971ff`(전 provider poll 상한), `93f21f0`(반환 경계), `d2f442d`~`5d849f0`(store lock awaited), `94d81ff`+`523635d`+`2913bb1`(check-then-write 창), recovery 읽기 포함 — PR이 다루지 않은 `readActivityState`까지 확장 |

### 코멘트 초안 (PR #89)

> Thanks for this PR — both fixes were real, and both shaped what landed.
> We could not take the patches directly: dev's assistant reader was already
> refactored to the split snapshot reader
> (`web-ai/chatgpt-response-dom.mjs:297`), so the #88 hunks no longer apply,
> and the trimmed read would break the wrapped/wrapperless correlation.
> Instead dev carries independent implementations covering both commits:
> `--family` now reaches the model probe fail-closed and MCP rejects
> non-ChatGPT family combinations (`76e4793`), and every assistant DOM read,
> recovery read, and session-store write is bounded by the polling deadline
> (`8a971ff` through `107233e` — see
> `devlog/_plan/260731_webai_poll_deadline/`). Closing in favor of those;
> the campaign devlog credits this PR as the trigger.

## 이슈 #87 — 권고: close

요구 전부가 dev에 존재한다.

| 요구 | 근거 |
| --- | --- |
| CLI 파서 `--family` 선언·운반 | `web-ai/cli.mjs:615`, `:761` |
| 미지원 alias fail-closed | `web-ai/cli.mjs:1692-1701` |
| selector가 family 선택·검증 | `web-ai/chatgpt-model.mjs:400-409`, `:449-458`, `:525-552` |
| capability probe가 family를 읽고 메뉴 열기 전 fail | `76e4793` (`chatgpt-model.mjs` probe) |
| MCP 비-ChatGPT + family 조합 거부 | `76e4793` (`mcp-server.mjs`, `capability.unsupported`) |
| 문서화 | `web-ai/cli.mjs:128-132` |

단, `76e4793`은 origin/dev에 이미 있으나 `main`/릴리스에는 없다.
close 시 코멘트에 dev 기준임을 명시할 것.

### 코멘트 초안 (이슈 #87)

> Fixed on dev. `--family` is wired through the CLI parser
> (`web-ai/cli.mjs:615,761`), fails closed on unsupported aliases before any
> browser mutation (`cli.mjs:1692-1701`), is honored and verified by the
> model selector (`chatgpt-model.mjs:400-552`), and — closing the two gaps
> this issue correctly called out — the capability probe now reads the
> requested family and fails before opening the menu, and MCP rejects
> family on non-ChatGPT providers instead of silently dropping it
> (`76e4793`). Not yet in a tagged release; reopen if the released CLI
> still ignores it after the next release.

## 이슈 #88 — 권고: 조건부 close (또는 코멘트 후 open 유지)

보고된 결함 자체(assistant DOM evaluate 정체가 `--timeout`을 넘겨 hang)는
dev에서 닫혔다:

| 방어 | 커밋 |
| --- | --- |
| 전 provider poll이 stalled probe에 상한 | `8a971ff` |
| 반환 자체의 hard deadline + late-side-effect fencing | `93f21f0`~`6a5a2b2` |
| store lock의 blocking wait 제거(데드라인 경로) | `d2f442d`~`5d849f0` |
| check-then-synchronous-write 창 폐쇄 | `94d81ff`+`523635d`+`2913bb1` |
| corrupt store 읽기 보고(B23) | `9d49c31`+`107233e` |
| resume/MCP/watch가 저장 데드라인을 초과하지 않음 | `888c850`, `89357fd` |

정직한 잔여(이슈가 직접 보고한 증상은 아님, 00_index에 기록):
single-flight(패배한 evaluate의 선형 누적, G4 의존), pre-poll 구간,
initial `sendDeepResearch` hard-deadline token, in-flight archive 취소.

**판단 분기**: 이슈 제목의 계약("pollWebAi can hang past --timeout")만 보면
close 가능. 잔여를 같은 이슈에서 추적하고 싶으면 open 유지 + 코멘트.
어느 쪽이든 사용자 결정.

### 코멘트 초안 (이슈 #88)

> The reported contract violation is fixed on dev: every assistant DOM
> read, recovery read, and provider poll is bounded by the armed deadline
> (`8a971ff`, `93f21f0`), the session-store lock is awaited instead of
> blocking the event loop that runs the deadline timer (`d2f442d`), and the
> final check-then-write window — where a write could land after its
> deadline passed while waiting for the lock — is closed with post-lock
> re-checks returning without writing (`523635d`). A poll now returns
> within its `--timeout` even when the page stalls, the store is contended,
> or the store file is corrupt (reported as `session-store-read-failed`
> instead of silently borrowing a baseline). Remaining hardening that goes
> beyond this issue's contract (single-flight for abandoned evaluates,
> pre-poll bounds, in-flight archive cancellation) is tracked in
> `devlog/_plan/260731_webai_poll_deadline/` and
> `devlog/_plan/260731_webai_artifact_finalizer/`.

## 실행 순서 (전부 사용자 승인 필요)

1. `git push origin dev` — 로컬 9커밋. 이것 없이는 아래 근거가 원격에 없다.
2. PR #89 close + 코멘트.
3. 이슈 #87 close + 코멘트 (dev-기준 명시).
4. 이슈 #88 — close 또는 코멘트-후-유지, 사용자 선택.
