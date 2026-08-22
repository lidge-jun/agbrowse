# 000 - Plan: agbrowse CI/deploy hardening (260822)

## Loop spec

- Archetype: spec-satisfaction repair (verifier = local gates + YAML validity)
- Trigger: user request CI/deploy hardening job
- Goal: release/contract-drift/pages 워크플로우와 릴리스 스크립트의 공급망/권한 하드닝
- Non-goals: main merge, tag push, npm publish, 프로덕션 코드 변경, 워크플로우 버전 메이저 업그레이드
- Verifier: python3 yaml.safe_load(문법), npm run gate:all + npm test + npm run typecheck, npm run pack:dry + smoke:bins
- Stop condition: 전 criteria met 또는 BLOCKED/NEEDS_HUMAN
- Resource bounds: 서브에이전트 무제한(사용자 승인), 로컬 검증만, 외부 배포 없음

## Luna trend synthesis (2026-08-22, 5 lanes)

| # | Claim | Source | Status |
|---|-------|--------|--------|
| T1 | 서드파티/퍼스트파티 액션은 태그 대신 커밋 SHA 고정이 기본 가이드 | docs.github.com threat-protection (primary) | verified |
| T2 | tj-actions 사건(2025-03): 태그 소급 이동으로 시크릿 유출 — SHA 고정 근거 | stepsecurity.io (lead, incident) | verified |
| T3 | 최소 권한: 워크플로우/잡별 permissions 명시, 기본 토큰 축소 | docs.github.com (primary) | verified |
| T4 | npm trusted publishing OIDC GA(2025-07-31), npm >=11.5.1 필요, provenance 자동 | github.blog changelog + docs.npmjs.com (primary) | verified |
| T5 | id-token write는 OIDC JWT 발급용 — 일반 쓰기 권한 아님 | docs.github.com OIDC ref (primary) | verified |
| T6 | dist-tag 보호 정책은 npm 네이티브 없음 — 환경/태그 보호로 우회 | docs.npmjs.com dist-tag (primary) | verified |
| T7 | Node 20 런타임 폴백 2026 가을 제거 예정, runner 이미지 22.04 deprecation 시작(2026-09-17) | github.blog + runner-images (primary) | verified |
| T8 | 공급망 공격 증가: Shai-Hulud(2026-08, 1300+ 패키지), typosquat CI 시크릿 표적(2026-05) | CSA 싱가포르 + Microsoft Security Blog (primary) | verified |
| T9 | npm audit signatures로 레지스트리 서명/provenance 검증 가능 | docs.npmjs.com (primary) | verified |

## Current-state gaps (code-read 45ec48a)

### .github/workflows/release.yml
1. actions/checkout@v4, actions/setup-node@v4 — 태그 참조, SHA 미고정 (T1/T2 위반)
2. npm install -g npm@latest — 버전 미고정 글로벌 설치 = 공급망 표면 (T8)
3. 잡 레벨 timeout 있음(30m), 동시성 그룹 있음 — 양호
4. 상위 permissions(contents:write, actions:read, id-token:write) 단일 잡이라 적절 — 근거 주석 필요 (T3/T5)

### .github/workflows/contract-drift.yml
1. permissions 블록 자체가 없음 — 리포 기본값 상속 (T3 위반, 최우선)
2. 잡 timeout 없음
3. concurrency 그룹 없음
4. 액션 태그 참조 미고정

### .github/workflows/pages.yml
1. permissions 이미 명시됨(contents:read, pages:write, id-token:write) — 양호
2. 액션 태그 참조 미고정
3. 잡 timeout 없음

## File change map

### MODIFY .github/workflows/release.yml
- checkout/setup-node를 현재 태그의 커밋 SHA로 고정 + 주석에 버전 명기 (B에서 git ls-remote로 실측)
- npm install -g npm@latest 제거 -> 번들 npm/Node 버전 assert로 교체. 조건: npm >=11.5.1 **그리고** node >=22.14.0 (npm trusted-publishers 문서 요구사항, 감사 블로커 반영). runner의 node 24 + setup-node 24 조합이므로 통과 예정이나 명시적 가드로 후회 없게.

### MODIFY .github/workflows/contract-drift.yml
- 상단에 permissions 추가: contents read
- fixture-drift 잡에 timeout-minutes 15
- concurrency 그룹: contract-drift-github.ref, cancel-in-progress
- 액션 2개 SHA 고정

### MODIFY .github/workflows/pages.yml
- 액션 SHA 고정 (권한/동시성은 이미 양호)
- 각 잡 timeout-minutes 15

### READ-ONLY audit: scripts/release.sh, scripts/release-preview.sh, scripts/release-gates.mjs
- 게이트 순서/실패 전파 확인 — 수정 필요 근거가 나오면 amendment 반영, 아니면 D에 소견 기록

## Scope boundary

- IN: 위 3개 워크플로우 파일, (필요시) 릴리스 스크립트 게이트
- OUT: 프로덕션 코드(.mjs/.ts), devlog 기존 유닛, main/tag/publish 원격 작업

## Accept criteria & activation scenarios

| ID | Criteria | Activation scenario (C에서 실제 발화 증명) |
|----|----------|------------------------------------------|
| AC1 | 3개 yml 모두 파서 통과 | python3 yaml.safe_load exit 0 |
| AC2 | SHA 고정 검증: uses 줄에 40-hex SHA 존재 | grep 패턴 매치 출력 |
| AC3 | contract-drift에 permissions contents:read 존재 | grep 매치 |
| AC4 | release.yml에 unpinned npm install 부재 + npm 버전 assert 존재 | grep 부정/긍정 매치 |
| AC5 | 로컬 전체 게이트 green | typecheck/test/gate:all/pack:dry/smoke:bins exit 0 |
| AC6 | dev 커밋 + origin/dev push 성공 (사전 승인) | git log + push output |

## Verifier realness (PLAN-VERIFIER-REAL-01)

| Verifier | Reads target? | Evidence |
|----------|--------------|----------|
| python3 yaml.safe_load | O — yml 파일 직접 인자 | 실행 예정, 실패시 npx yaml 대체 |
| grep SHA pattern | O — yml 직접 | 동일 |
| npm run gate:all / test / typecheck | 간접 — 코드 전체 회귀 방지용 | exit code 기록 |
| pack:dry / smoke:bins | 간접 — 패키징 무결성 | 동일 |

워크플로우 YAML 자체의 진짜 검증은 push 후 GitHub 워크플로우 파서가 수행한다(비-main 브랜치라 실패해도 블라스터레이드 없음). 로컬 파서는 1차 방어선.
