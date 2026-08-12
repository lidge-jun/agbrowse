# WP0 플랜 정합화 캐논 (2026-07-10, 인터뷰 확정 결정의 문서 반영 기준)

입력: devlog/_plan/260710_gpt56_update/10_patch_interview.md (확정 결정 요약 +
Mind C/D 스캔의 path:line 파급 목록). 이 노트가 WP0 워커 8기(A~H)의 단일 기준이다.

## 캐논 결정

1. **tier 3분리**: session.mjs tier 표 `pro` → `chatgpt-pro: 5400`,
   `grok-heavy: 3600` 신설, `deep-research: 3600` 유지.
   deriveTimeoutTier: grok heavy→`grok-heavy`, chatgpt pro→`chatgpt-pro`.
   `PRO_TIMEOUT_SEC` → `CHATGPT_PRO_TIMEOUT_SEC` (기존 명칭은 호환 export로
   유지, 5400 가리킴). 문서의 모든 "Pro 3600 SSOT 유지" 캐논 문구는
   "chatgpt-pro 5400 SSOT (tier 3분리)"로 교체. 시간 표기: 90분/5400s.
2. **work send 진입점**: Chat 명령(send/query/poll/watch, MCP
   web_ai_submit_prompt)은 Work 표면에서 hard-error(reject) 유지.
   Work mutation의 유일한 진입점은 신설 `work` 최상위 커맨드
   (`web-ai work send --prompt ... --power N`, project-sources 2단 파서 선례)
   + MCP `web_ai_work_send` 도구 신설. 기존 도구에 surface 파라미터 확장 금지 —
   02의 "send에 surface=work 추가" 제안 서술은 삭제.
3. **소유권 확정 (02↔04 역참조 해소)**: 04가 detector
   (`detectChatGptComposerSurface`)·가드·`workSurfaceUnsupportedError`·work send
   구현 전부를 단독 소유. 02는 typedef/alias/스키마/증거 계약 + "스키마 단계
   reject 정책"만 소유하고 04 헬퍼를 호출하는 diff를 제거(참조 각주로 전환).
   02는 자기 diff만으로 checkjs-clean하게 독립 종료 가능해야 한다.
4. **실행 순서 (fixture-first, 순환 해소)**: WP2=07 fixture 생성 파트+02 적용 →
   WP3=03 → WP4=04(+work send, WP1 재프로브 실측 소비) → WP5=05 → WP6=06 →
   WP7=08+09+최종 회귀 매트릭스(07 잔여 파트). 07 문서는 "fixture 정의(선행)"와
   "회귀 매트릭스(최종)"로 2분할 서술. 각 phase P에서 문서 앵커 stale-check.
5. **00 정정**: "다음 유닛이 01~09 실행" → "02~09 실행(01은 증거 입력,
   10은 인터뷰 기록)". 07 적용 순서 번호 중복(6,6) 정정.
6. **검증 프로토콜 명기**: npm ci 선행(vitest 3.2.6), checkjs는 touched-files
   스코프(기존 베이스라인 24+124건은 증가 금지 기준), 유닛 git add 후
   논리 단위 커밋.
7. **Work effort/speed/power**: `--power N`(1~6)이 1차 UX. Power↔Model×Effort
   매핑은 WP1 재프로브로 확정 — 04 문서는 매핑 표를 TBD-WP1 플레이스홀더로
   명시(구현 diff는 재프로브 후 WP4 P에서 확정).
8. **semantic gate 토큰(09)**: `chatgpt-pro=5400`, `grok-heavy=3600`,
   `deep-research=3600` 3종 독립 검사. `pro=3600`/`3600 Pro/Deep Research`
   needle 제거.
9. **legacy `extended` 경고 계약 (A게이트 blocker 1)**: `--effort extended`는
   High로 재매핑 + **경고 1줄 방출**("extended is a legacy alias; selected
   High" 형태, stderr) — 02의 alias 표와 CLI/MCP 정규화 서술에 경고 계약을
   명시. Pro의 legacy standard/extended 요청도 동일 패턴(선택 없음 경고).
10. **02 diff 처분 확정 (blocker 3)**: 02:964-1037의 구현 블록(detector,
    workSurfaceUnsupportedError 호출, composer-scoped 흐름)은 **통째로 04
    소유로 이동** — 02에서는 해당 diff를 삭제하고 "시행은 04(§detector/guard)"
    참조 산문+계약 서술만 남긴다. 02에 남는 것: typedef/alias(경고 포함)/
    스키마 reject/증거 스키마/셀렉터·discriminator **상수 정의**. 02는 상수와
    스키마만으로 checkjs-clean 독립 종료. 04는 이동받은 구현 diff를 자기
    섹션에 흡수(중복 정의 금지 — 04 기존 구현과 병합).
11. **WP1 재프로브 배치 (blocker 4)**: WP1은 WP0 D-close 직후, WP2 이전에
    실행. 담당=메인 세션(인앱 브라우저 직접 조작, 로그인 세션). 완료 증거=
    01 §5.1 5항목 실측 기록 + Power↔Model×Effort 매핑 표. WP4 P는 이 증거로
    04의 TBD-WP1 표를 확정한 후에만 B 진입.
12. **release-gate/publish 경계 (blocker 6)**: 09 closeout이 release_gates.md
    전체 게이트(contract-drift, strict-baseline, module-graph, bin smoke,
    pack dry-run, Pages validation) 실행을 포함하도록 갱신하되, **npm publish와
    main 머지는 이 goal 범위 밖**임을 09 closeout에 명시(dirty dev 브랜치에서
    논리 단위 커밋까지가 경계). 소유: 워커 C.
13. **family 미지정 무조작 (R2 blocker 1)**: `--family` 생략 시 패밀리
    서브메뉴 mutation 0회 — 현재 UI 선택을 그대로 존중(읽기/증거 기록만).
    02의 계약 서술(워커 D)과 08의 공개 문서(워커 B)에 이 보존 조건을 명시.

## 워커 배분 (배타 쓰기 스코프)

| 워커 | 파일 | 작업 |
| --- | --- | --- |
| A | 05 | 3분리+5400 파급 (Mind C 목록 전부) + 테스트 명세 3-tier 분리 |
| B | 08 | timeout 표 3행(5400/3600/3600), EN/KO 서술, changelog, 검증 needle + **work send/web_ai_work_send 문서 표면 추가** (CLI help·SKILL·README·docs의 Work 명령 서술) |
| C | 09 | SoT 문구 5곳 + gate 토큰 3종 + **Work 계약 SoT 반영** + closeout에 git add 선행 + **full release-gate 목록 + no-publish/no-main-merge 경계 명시** (캐논 12) |
| D | 02 | work send 재정의(Chat reject 유지+work 진입점), surface=work 확장 제안 삭제, **구현 블록 964-1037을 04로 이관하고 계약 산문+상수만 남김** (캐논 10), **extended 경고 계약 명시** (캐논 9), 독립 종료 |
| E | 04 | 로드맵 활성화, work send CLI+MCP 소유, 경계 분리, **02에서 이관받은 구현 diff 병합**, TBD-WP1 매핑 표 (캐논 7·10·11) |
| F | 00+07 | 00 순서 재설계/정정(WP1 재프로브 포함 체인 명시) + 07 2분할(fixture 선행/회귀 최종) + 3-tier 회귀 행 + **Work send 회귀 행 추가** + fixture family 확인 + 03:1240-1248 역순 앵커는 G 소유임을 07에서 참조만 |
| G | 03 | **역순 앵커(03:1240-1248)를 fixture-first로 수정**, Work-deferred 서술 제거, 02 이관에 따른 참조 정리 (blocker 2·5) |
| H | 06 | **Work 자동화 반영** — capability probe/진단의 Work send 경로 서술, deferred 잔재 제거 (blocker 2) |
