---
created: 2026-05-14
tags: [agbrowse, stability-upgrade, operational-weakness]
aliases: [agbrowse stability backlog, agbrowse 안정성 업그레이드]
---

# Stability Upgrade Index

이 폴더는 `agbrowse`의 실제 작동 취약점을 기록한다. 여기서 말하는 취약점은
보안 상상 목록이 아니라, live provider UI와 session runtime을 쓰면서 실제로
사용자 결과를 틀리게 만들 수 있는 약한 지점이다.

## Scope Guard

- 기록한다: provider DOM drift, session recovery, artifact 저장 실패, model evidence
  누락, live smoke에서 재현된 tab crash/retry 문제.
- 기록하지 않는다: CAPTCHA 우회, provider subscription 보장, 막연한 보안 공포,
  실제 command surface와 연결되지 않은 speculative edge case.
- 표현 원칙: "무엇이 깨질 수 있는지", "사용자가 어떻게 알 수 있는지",
  "현재 방어", "다음 upgrade"만 적는다.

## Files

| File | Purpose |
| --- | --- |
| [01_operational_weakness_register.md](01_operational_weakness_register.md) | 실제 작동 취약점 register |

## Current Priority

1. Session recovery under browser/tab closure during long image generation.
2. Live provider DOM drift checks for generated images and upload chips.
3. Deep Research long-run artifact/finalization confidence.
4. Project Sources live add selector confidence.

## Verification Policy

이 폴더의 항목은 코드가 아니라 claim gate다. 항목을 닫으려면 최소 하나가 필요하다.

- focused unit/integration test
- source contract test
- live smoke output with session id and artifact path
- employee or GPT Pro read-only verification report

