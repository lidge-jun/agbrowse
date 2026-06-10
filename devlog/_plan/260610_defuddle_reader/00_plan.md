# Defuddle reader candidate — vendored in-page extraction (no npm dependency)

날짜: 2026-06-10. 분류: C3 (adaptive-fetch 공개 동작 + cli-jaw 미러).
요청: 사용자 — "의존성 없이 구현을 agbrowse에 접목하고 cli-jaw 미러까지".

## 배경

- browser-escalation의 본문 추출이 `document.body.innerText` (browser-escalation.mjs
  `readVisibleText`) — 잡음 포함, 구조(표/링크/코드) 소실.
- fetch 경로에는 Jina Reader(`r.jina.ai`) 외부 API 후보가 이미 존재
  (third-party-readers.mjs). kepano/defuddle은 같은 품질의 본문→Markdown 추출을
  로컬에서 수행 (Obsidian Web Clipper 엔진, MIT).
- defuddle npm 패키지(0.18.1)는 멀티파일 ESM만 제공 → 단일 IIFE 번들을 1회
  빌드해 vendoring. **package.json 의존성 추가 없음** (사용자 결정).

## 설계

1. `skills/browser/adaptive-fetch/vendor/defuddle.iife.min.js` — 282KB, esbuild
   1회 번들 (재현 명령은 vendor/README.md). MIT 라이선스 고지 포함.
2. `skills/browser/adaptive-fetch/defuddle-extractor.mjs` — 번들 lazy-load(캐시),
   주입 2단계: `page.addScriptTag({content})` → 실패 시(CSP)
   `page.evaluate(new Function(src))`. 둘 다 실패하면 null + reason (후보 탈락,
   innerText 후보는 유지 — 경고로 기록, silent 아님).
3. `browser-escalation.mjs` — 렌더 후 defuddle parse(`{markdown:true, url}`) 실행,
   결과를 `defuddleCandidate`로 browserResult에 동봉 (networkCandidates 패턴 동일).
   `collectDefuddleCandidate(browserResult)` export 추가.
4. `index.mjs` — browser 후보 push 지점에서 defuddle 후보도 push + trace attempt
   기록. 선택은 기존 content-scorer가 수행 (아키텍처 변경 없음).
5. 테스트: `test/unit/browser-adaptive-fetch-defuddle.test.mjs` — fake page로
   성공/CSP폴백/실패/빈본문 4경로.
6. cli-jaw 미러: `src/browser/adaptive-fetch/`에 TS 포트 (defuddle-extractor.ts,
   browser-escalation.ts, index.ts) + vendor 에셋 + dist 빌드 + 테스트.

## 검증 게이트

- agbrowse: `npm run test:unit` + `bash structure/check-doc-drift.sh` +
  `bash structure/verify-counts.sh` (str_func.md 갱신)
- cli-jaw: tsc 빌드 0 에러 + 관련 테스트 + dist 산출 확인
- 실증: `agbrowse fetch <X 포스트 URL>` trace에 browser-defuddle 후보 등장

## 결정 기록

- 의존성 vs vendoring: 사용자가 명시적으로 무의존 접목 선택. esbuild는 vendoring
  시점 1회 도구 (런타임/CI 미사용).
- ~~lite 번들(`dist/index.js`) 사용~~ → **full 번들로 변경** (구현 중 발견:
  markdown serializer가 full에만 포함, lite는 `markdown:true` 무시 — 구현 결과
  섹션 참조).
- fetch 정적 경로(JSDOM 필요)는 범위 제외 — 브라우저가 있을 때만 defuddle 후보
  생성. Jina 후보는 그대로 유지(제거 아님, 경쟁 후보).

## 구현 결과 (2026-06-10)

- 적용 파일: vendor/defuddle.iife.min.js (683KB, **full 빌드** — markdown
  serializer는 full에만 존재, lite는 `markdown:true` 무시 확인),
  defuddle-extractor.mjs, browser-escalation.mjs(+30), index.mjs(+16),
  test/unit/browser-adaptive-fetch-defuddle.test.mjs (8 tests).
- 설계 변경 1건: boundary 마커 시 defuddle skip 조건 제거 — Wikipedia 'log in'
  텍스트가 auth 마커 오탐을 내며 추출을 막았음. 기존 innerText 추출과 동일하게
  마커 유무와 무관하게 추출하고 경고만 흘린다.
- 검증: vitest 761/761, tsc(checkjs) 0 에러, drift 140 PASS, counts 60 PASS.
  실증 — example.com에서 browser-defuddle 후보가 scorer 선택(score 40),
  Wikipedia/Markdown에서 markdown 본문 33KB + author/published 메타데이터 추출.
