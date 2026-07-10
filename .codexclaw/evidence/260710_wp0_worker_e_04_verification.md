# WP0 워커 E — 04 Work surface 문서 정합화 검증

- 검증 시각: 2026-07-10 KST
- 대상: `devlog/_plan/260710_gpt56_update/04_work_surface_support.md`
- 작업 종류: docs-only contract reconciliation

## 실행 명령

```bash
node - <<'NODE'
// 대상 문서를 읽어 필수 계약 13개, 금지 패턴 3개,
// 공식 Power 매핑 6개 행, trailing whitespace를 검사한다.
NODE

rg -n '^### 1\.2|^### 1\.3|^## 2\.|^### 3\.1|readWorkTaskState|findActiveSession|^## 7\.|^### 7\.1|^### 7\.2|^## 9\.' \
  devlog/_plan/260710_gpt56_update/04_work_surface_support.md

git status --short -- devlog/_plan/260710_gpt56_update/04_work_surface_support.md
```

## 출력

```text
file: devlog/_plan/260710_gpt56_update/04_work_surface_support.md
lines: 343

required:
  work CLI: pass
  MCP tool: pass
  strict schema: pass
  Chat hard error: pass
  surface transition: pass
  picker owner: pass
  power mutation: pass
  work response state: pass
  four task states: pass
  session surface filter: pass
  WP1 marker: pass
  WP1 10 probes: pass
  WP4 B gate: pass

forbidden:
  DEFERRED heading absent: pass
  OPEN heading absent: pass
  existing send/tool surface extension proposal absent: pass

powerRows:
  power-1: pass
  power-2: pass
  power-3: pass
  power-4: pass
  power-5: pass
  power-6: pass

trailingWhitespaceLines: []
ok: true
exit: 0

key lines:
  37: CLI v1
  53: MCP v1
  75: ownership and merged symbols
  142: official Power mapping
  208: readWorkTaskState
  239: findActiveSession surface filter
  251: WP1 prerequisite gate
  257: original five live probes
  265: reverse-engineering ten additional probes
  293: tests and completion criteria

target status:
  ?? devlog/_plan/260710_gpt56_update/04_work_surface_support.md
```

## 판정

PASS. 캐논 2·7·10·11의 필수 계약이 대상 문서에 존재하고, 이전 범위의
`DEFERRED`/`OPEN` heading은 제거됐다. 공식 Power 1..6 매핑은 각 행에 WP1 live
verification 표식을 유지한다. Chat hard-error와 Work 전용 진입점, 전용 picker/helper,
composer-scoped adapter, `chat|work` response contract, 네 상태의
`readWorkTaskState`, session surface/task identity, WP1 5+10 증거의 WP4 B 선행 조건이
모두 검출됐다.

이 작업은 구현 전 계획 문서 정합화이므로 runtime build/test는 적용 대상이 아니다.
대신 문서 계약 needle과 금지 잔재를 fresh command로 검사했으며 exit code 0을 확인했다.
