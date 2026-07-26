# WP7 — 감시하는 척하던 CI 잡을 지웠다

WP3b에서 CI 설치 단계를 지우다 리뷰어가 발견했다. `contract-drift.yml`의
`live-drift` 잡이 이름이 약속하는 일을 하지 않는다.

## 1. 무엇이 잘못됐나

```yaml
live-drift:
  if: github.event_name == 'schedule'      # 주 1회 (cron '0 9 * * 1')
  steps:
    - run: npm run test:contract-drift
      env:
        AGBROWSE_DRIFT_MODE: live          # ← 아무도 안 읽는다
      continue-on-error: true              # ← 실패해도 통과
    - name: Alert on drift
      if: failure()                        # ← 그래서 발동 안 한다
```

네 겹으로 무의미하다.

| 층 | 사실 |
|----|------|
| env | `AGBROWSE_DRIFT_MODE`는 `node_modules`/`devlog`를 빼면 저장소 코드에서 읽히는 곳이 **0건**이다. `contract-audit.mjs`는 `process.env`를 아예 참조하지 않는다 |
| 명령 | `fixture-drift`와 **같은 명령**을 돌린다. 즉 fixture 모드를 두 번 돌리는 것이다 |
| 테스트 내용 | `test:contract-drift`가 실행하는 것은 테스트 1건이고 내용은 `expect(typeof auditContractAgainstSnapshot).toBe('function')` — export 존재 확인뿐이다 |
| 실패 처리 | `continue-on-error: true`라 스텝이 실패해도 잡은 성공한다. 그래서 `if: failure()`인 알림 스텝은 발동할 수 없다 |

주 1회 러너를 띄워 `npm ci`를 하고 fixture 테스트를 한 번 더 돌린 뒤, 무슨 일이
생겨도 초록색으로 끝난다. 남는 것은 "라이브 프로바이더를 감시하고 있다"는 인상뿐이다.

## 2. 구현하지 않고 지운 이유

원래 의도는 남아 있다(`devlog/_fin/legacy_mvp_phase_plans/08_1_detailed.md`
PR6b: "GitHub Actions with fixture mode (fail) and scheduled live mode
(alert-only)"). 그런데 live 모드는 CI에서 구현할 수 없다.

`auditContractAgainstSnapshot(page, vendor)`는 첫 인자가 playwright `Page`이고
(`contract-audit.mjs:30`), 그 안에서 `buildWebAiSnapshot(page)`이 접근성 트리를
떠서 ChatGPT/Gemini의 실제 DOM과 계약을 대조한다. **로그인된 프로바이더 세션이 있는
헤디드 브라우저**가 전제다. GitHub 러너에는 그것이 없고, 넣으려면 provider 자격
증명을 CI 시크릿에 두어야 한다 — 이 저장소가 명시적으로 피하는 것이다
(README `:183`: `~/.browser-agent`는 커밋·공유 금지).

그래서 채울 수 있는 구멍이 아니다. 남겨 두면 "언젠가 채운다"는 표시가 아니라
"이미 하고 있다"는 거짓 신호다.

**지운 자리에 무엇이었고 왜 없는지, 그리고 live 드리프트는 어디서 잡는지를 주석으로
남겼다.** 실제 계약 드리프트는 실 세션에서 `agbrowse web-ai doctor`를 돌릴 때
잡힌다 — 사람이 로그인된 브라우저를 가진 곳에서.

`fixture-drift`에는 `schedule` 트리거가 왜 그대로 유효한지 한 줄 적었다. 오해가
없도록 정확히 적는다 — **이번에 스케줄이 추가된 것이 아니다.** 최초 커밋부터
`fixture-drift`에는 잡별 `if` 조건이 없었고, 워크플로 수준 `schedule`이 그대로
걸려 이미 주 1회 돌고 있었다. `if: github.event_name == 'schedule'`가 붙어 있던
것은 `live-drift`뿐이다. 즉 원래는 조건을 안 건 부작용이었고, 이번에 그 동작을
유지하면서 근거를 명시했다.

근거는 이렇다. PR 트리거 경로에 `package.json`/`package-lock.json`이 있지만 그건
이 저장소의 PR만 잡는다. 외부 의존성이 새 버전을 내면서 fixture 결과를 흔드는
경우는 PR 없이 일어난다. WP1이 정확히 그 부류였다 — 의존성 해석이 조용히 바뀌어
15개 테스트가 침묵했다.

## 3. 검증

```
$ yaml.safe_load('.github/workflows/contract-drift.yml')
jobs: ['fixture-drift']
steps: [checkout, setup-node, npm ci, test:contract-drift, test:eval,
        test:eval-fixtures, eval:web-ai:fixtures]
triggers: ['pull_request', 'schedule']

$ rg 'AGBROWSE_ALERT_WEBHOOK|AGBROWSE_DRIFT_MODE'  (node_modules/devlog 제외)
(0건)
```

두 환경 변수 모두 저장소에서 완전히 사라졌다. 남은 잡은 하나이고 스텝 목록이
의도대로다.

`AGBROWSE_ALERT_WEBHOOK` 시크릿이 저장소 설정에 남아 있을 수 있다. 이제 아무도
쓰지 않으므로 정리 대상이지만, 시크릿 삭제는 이 QA의 권한 밖이라 여기 적어 둔다.

`fixture-drift`에 남아 있던 `env: AGBROWSE_DRIFT_MODE: fixture`도 함께 지웠다.
읽히지 않는 변수를 남기면 같은 착각이 반복된다.

## 4. 축소판도 만들 수 없다 — 리뷰어 확인

"로그인 없이 접근 가능한 부분만 검증하면 되지 않나"를 리뷰어가 따로 봤다. 두 가지
이유로 안 된다.

계약 타깃이 전부 로그인 후 화면이다. ChatGPT 계약은 `composer`, `sendButton`,
`modelPicker`, `uploadSurface`, `responseFeed`, `copyButton`, `streamingIndicator`
— 로그아웃 상태에서 볼 수 있는 것이 없다.

그리고 **감사기가 `required` 플래그를 무시한다.** `vendor-editor-contract.mjs`에서
`composer`만 `required: true`인데 `contract-audit.mjs`에는 `required`라는 단어가
없다. 모든 타깃을 동등하게 요구하고 하나라도 없으면 `severity: 'error'`를 쌓는다.
따라서 "필수 몇 개만 익명으로 검증"하는 축소판을 만들려면 감사기부터 고쳐야 하고,
그건 죽은 잡을 처분하는 일이 아니라 새 기능 개발이다.
