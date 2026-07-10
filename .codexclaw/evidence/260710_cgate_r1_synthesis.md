# C-gate R1 synthesis (2026-07-10, reviewer Mendel FAIL 8 HIGH)

블로커별 처분과 캐논 결정 (수리 워커 디스패치의 단일 기준):

1. Before 비인용 (03/05/06) — ACCEPT. 모든 Before 블록을 실코드 verbatim으로 교체.
2. family/alias 이원화 — ACCEPT + 캐논 결정: Chat 패밀리 서브메뉴 실측(01 §2.1)이
   선택 가능 집합 = GPT-5.6 Sol / GPT-5.5 / GPT-5.4(7/23 퇴역 경고) / GPT-5.3 / o3.
   CLI family alias도 이 5개(gpt-5.6-sol, gpt-5.5, gpt-5.4, gpt-5.3, o3).
   Terra/Luna는 Work Model 서브메뉴에서만 실측 — Work와 함께 DEFERRED.
   effort 캐논: medium|high|xhigh + 표기 정규화(extra-high/extra_high/"extra high"→xhigh)는
   02가 소유.
3. 08 예제 거부 — ACCEPT: family는 `--family` 플래그 전용(02 확정 유지),
   08 예제는 `--model thinking --effort high --family gpt-5.6-sol` 형으로 수정.
4. discriminator 모순 — ACCEPT + 캐논 결정(3-상태): toggle 존재+chat=진행 /
   toggle 존재+work=fail(stage `provider-surface-preflight`, retry `switch-to-chat`) /
   toggle 존재+ambiguous(aria-checked/data-state 불일치)=fail-closed /
   toggle 부재=legacy UI로 판정, legacy 셀렉터 경로 + 경고로 진행.
   02/04/07 모두 이 계약과 이 에러 명칭으로 통일.
5. familyEvidence 반환형 — ACCEPT 캐논: `selectChatGptFamily()`는
   `{label, changed, verified}` 객체 반환(02 소비형 승리). 03 수정.
6. 중복 선언/미정의 심볼 — ACCEPT 소유권 지정: `CHATGPT_FAMILY_OPTIONS`+피커 루트
   셀렉터 상수는 02 diff가 단독 정의(03/04는 참조만). 메뉴 루트 헬퍼는 03이 정의,
   04는 소비. 미정의 심볼 구현 diff: family 헬퍼(readVisibleChatGptFamilyEvidence,
   familyMismatch, findOpenFamilySubmenu)+isLegacyComposerModelMenuOpen→03,
   workSurfaceUnsupportedError→04.
7. capability unknown→ready — ACCEPT: 4번 3-상태 계약 적용 — toggle 존재 시
   work/ambiguous는 probe `fail`(statusWebAi blocked), toggle 부재는 legacy probe
   경로 유지(warn 허용). verified=false + toggle 존재는 ready로 보고 금지. 06 수정.
8. root CLI help 누락 — ACCEPT: skills/browser/browser.mjs:3376+3385/3424
   (web-ai help 블록, Pro 예시 1800s)를 08 대상에 추가.

수리 워커 8기(문서당 1기, 배타 스코프)로 병렬 재작성 후 동일 리뷰어 재검증.

## C-gate R2 추가 캐논 (Herschel FAIL 2 HIGH + residual 2)

9. workSurfaceUnsupportedError 시그니처 — 소유자(04)의 형이 캐논:
   `ChatGptComposerSurfaceStatus` 객체(`{surface, ui, evidence}`)를 인자로 받는다.
   02의 호출부(02:1003, 02:1018)가 문자열 discriminator를 넘기는 부분을
   status 객체 전달로 수정.
10. chatGptLegacyMenuRootOpenedByComposer(03:876) — 차단 상태는 `unknown`이
    아니라 `ambiguous`(04 detector 반환형 chat|work|ambiguous|null 기준).
    `ambiguous`는 fail-closed, `null`(toggle 부재)만 legacy 진행. 검사 범위는
    page-wide가 아니라 composer-scoped trigger/menu.
11. residual: 06:26의 폐기 명칭 `isLegacyComposerModelMenuOpen` →
    `chatGptLegacyMenuRootOpenedByComposer`로 정정; 06:19의 "GPT-5.6 family"
    축약 → 실측 5종 집합 명시.
