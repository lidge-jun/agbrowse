# 01 — GPT-5.6 UI 계약 실측 증거 (2026-07-10)

1차 수집: 2026-07-10 09:5x KST, 인앱 브라우저(Pro 구독 로그인 세션, 영어 UI),
chatgpt.com 루트. 2차 수집: 17:1x~17:4x KST, 동일 계정의 로그인된 Chrome을
Computer Use와 Chrome DOM으로 교차 관측. 조작·관측은 DOM snapshot/evaluate와 role 기반
입력만 사용했다. 스크린샷 3장은 `assets/`에 저장.

## 1. 헤더: Chat / Work 세그먼트 토글 (신규)

```text
BUTTON role=radio aria-checked=true  data-state=on  «Chat»
BUTTON role=radio aria-checked=false data-state=off «Work»
```

- data-testid 없음. radix 세그먼트 컨트롤(`data-radix-collection-item`).
- Work 클릭 시 URL 변화 없이(`https://chatgpt.com/` 유지) 메인 영역이
  Work 컴포저로 교체된다. 스크린샷: `assets/work_surface.png`.

## 2. Chat 표면: Intelligence 피커 (구 모델 스위처 대체)

트리거: 컴포저 폼 내 `button[aria-haspopup="menu"]` (data-testid 없음,
radix id `radix-_r_*_`만 존재). 필 텍스트 = 현재 선택 라벨 (`Instant`, `Pro` 등).
스크린샷: `assets/chat_intelligence_picker.png`.

메뉴 루트: `[role="menu"][data-state="open"]` >
`[data-testid="composer-intelligence-picker-content"]` (role=group, 헤딩 «Intelligence»).

```text
DIV role=group
  menuitemradio aria-checked data-state «Instant» + 배지 «5.5»
  menuitemradio «Medium»
  menuitemradio «High»
  menuitemradio «Extra High»
  menuitemradio «Pro»
separator
menuitem data-has-submenu «GPT-5.6 Sol» (+ svg data-testid=menu-item-submenu-chevron)
```

- **`Light/Standard/Extended/Heavy`, `Pro Standard/Pro Extended`, `Thinking` 라벨 전면 소멸.**
- 각 menuitemradio에 **data-testid 없음** — 구 `model-switcher-gpt-5-5-*`,
  `*-thinking-effort` testid 체계 소멸. 판별 가능한 계약은
  `role=menuitemradio` + 라벨 텍스트 + `aria-checked`/`data-state` 뿐.
- Pro 선택 시 필 라벨 «Pro»로 변경 (Pro 전용 effort 서브메뉴 없음 — flat radio).
- Pro 항목 호버 툴팁/설명 문구 없음 (§5 참조).

### 2.1 모델 패밀리 서브메뉴 («GPT-5.6 Sol» hover/click)

```text
menuitemradio aria-checked=true «GPT-5.6 Sol»
menuitemradio «GPT-5.5»
menuitemradio «GPT-5.4» + 배지 «Leaving on July 23»
menuitemradio «GPT-5.3»
menuitemradio «o3»
```

- 역시 data-testid 없음. «Leaving on July 23» — 5.4 퇴역 예고 배지.
- 시사점: Intelligence 라디오(Instant~Pro)는 effort/tier 축, 서브메뉴는
  모델 패밀리 축으로 **2축 분리**됐다.
- 두 축의 결합 의미 (사용자 확인, 2026-07-10): **Instant만 GPT-5.5로 남고**,
  Medium/High/Extra High/Pro는 선택된 패밀리(현재 GPT-5.6 Sol)로 실행된다.
  «Instant» 항목에만 «5.5» 배지가 붙는 실측(§2)과 정합 — 배지는 "이 티어는
  5.5 모델" 표시이고, 패밀리 서브메뉴 checked(«GPT-5.6 Sol»)는 나머지
  티어의 모델을 가리킨다.

## 3. Work 표면 (신규 전체)

별도 컴포저(placeholder «Work on anything»), 필 라벨 «5.6 Sol Light»,
Choose project / Plugins / GitHub 연동 버튼, GitHub 태스크 제안 리스트.
스크린샷: `assets/work_surface.png`, `assets/work_power_picker.png`.

피커 메뉴 루트는 Chat과 동일한 `composer-intelligence-picker-content` testid를
공유하되 내부가 다르다:

```text
DIV data-testid=composer-model-picker-slider-simple-view
  menuitem aria-label="Power"  «5.6 Sol Light, 2 of 6.»
                               «Use Left and Right arrow keys to adjust power.»
  menuitem aria-label="Show advanced options" «Advanced»   (토글 시 "Show compact options")
  menuitemcheckbox aria-label="Enable fast mode" «Faster/Smarter/Consumes usage limits faster»
DIV data-testid=composer-model-picker-slider-advanced-view
  menuitem data-has-submenu «Model»  현재값 «GPT-5.6 Sol»
  menuitem data-has-submenu «Effort» 현재값 «Light»
  menuitem data-has-submenu «Speed»  현재값 «Standard»
```

서브메뉴 실측 (accessible name은 «Model GPT-5.6 Sol»처럼 라벨+현재값 결합):

| 서브메뉴 | 항목 (menuitemradio) |
| --- | --- |
| Model | `GPT-5.6 Sol`(checked) / `GPT-5.6 Terra` / `GPT-5.6 Luna` / `GPT-5.5` |
| Effort | `Light`(checked) / `Medium` / `High` / `Extra High` / `Max` / `Ultra`(+«Consumes usage limits faster») |
| Speed | `Standard`(+«Default usage», checked) / `Fast`(+«1.5x speed, more usage») |

Power control은 `[role=slider]` 하나이며 DOM 값은 `aria-valuemin=0`,
`aria-valuemax=5`, 공개 라벨은 `1 of 6`~`6 of 6`인 0-based 내부/1-based 외부 계약이다.
Left/Right가 한 단계씩 이동하고 양 끝에서 clamp한다. Home/End는 값을 바꾸지 않았다.

| 공개 Power | DOM `aria-valuenow` | compact 라벨 | Advanced Model | Advanced Effort |
| ---: | ---: | --- | --- | --- |
| 1 | 0 | `5.6 Terra Light` | GPT-5.6 Terra | Light |
| 2 | 1 | `5.6 Sol Light` | GPT-5.6 Sol | Light |
| 3 | 2 | `5.6 Sol Medium` | GPT-5.6 Sol | Medium |
| 4 | 3 | `5.6 Sol High` | GPT-5.6 Sol | High |
| 5 | 4 | `5.6 Sol Extra High` | GPT-5.6 Sol | Extra High |
| 6 | 5 | `5.6 Sol Ultra` | GPT-5.6 Sol | Ultra |

- Power 6에는 «Consumes usage limits faster»가 함께 노출된다. Max는 Advanced effort에는
  존재하지만 Power 1~6 프리셋에는 포함되지 않는다.
- Advanced Effort High를 선택하면 compact 값이 `5.6 Sol High, 4 of 6`으로 바뀌었다.
- Speed Fast/Standard 전환은 Power/Model/Effort를 바꾸지 않았다. compact 토글의 accessible
  name은 Standard일 때 «Enable fast mode», Fast일 때 «Enable standard mode»다.
- Chat→Work→Chat 왕복에서 Chat은 Pro, Work는 `5.6 Sol Light`/Power 2/Standard를 각각
  유지했다. 최종 사용자 탭도 이 Work 기본 상태로 복원했다.

## 4. 주장별 판정

| 주장 | 판정 | 근거 |
| --- | --- | --- |
| "Extended effort 라벨 제거" | **확인** | Chat 피커 §2: Extended/Pro Extended 계열 문자열이 어떤 메뉴에도 없음. Work Effort는 Light~Ultra 체계(§3)로 Extended 없음 |
| "모델 스위처 testid 교체" | **확인(소멸)** | §2: 메뉴 항목 data-testid 전무. 신규 testid는 `composer-intelligence-picker-content`, `composer-model-picker-slider-{simple,advanced}-view`, `menu-item-submenu-chevron`, `composer-plus-btn` 뿐 |
| "Pro 기본 추론 40분" | **UI 근거 없음, 계약은 90분으로 확정** | §2: Pro 항목에 시간 문구/툴팁 없음. 패치 계약은 사용자 결정에 따라 `chatgpt-pro=5400s`; 40분 상수는 만들지 않고 explicit→저장 deadline 잔여→tier default 우선순위를 사용 |
| "GPT-5.6 계열 롤아웃" | **확인** | §2.1/§3: GPT-5.6 Sol/Terra/Luna 실측, GPT-5.4 «Leaving on July 23» |

## 5. 미확인/한계

- 한국어 UI 라벨 미실측 (세션이 영어 UI). 구 코드의 `Pro 확장/즉시/높음` 계열
  한국어 계약은 재실측 전까지 유효성 불명 — 02/03 문서에서 legacy 유지 권고.
- Pro 실행 시간: DOM/공식 출시글에 고정 추론 시간 문구가 없다. 5400초는 agbrowse의
  poll/watcher 예산 계약이며 ChatGPT 제품의 실행시간 보장을 뜻하지 않는다.
- 무료/Plus 계정의 피커 형태 미실측 (Pro 계정 세션만 확보).

### 5.1 Work 표면 재프로브 체크리스트 (04 완전 자동화의 선행 조건)

WP1은 아래 5항목과 `04_work_surface_support.md` §7.2의 역설계 추가 10항목을
2026-07-10 2차 프로브에서 수행했다. 행별 판정과 raw 관측은
`.codexclaw/evidence/260710_wp1_live_work_probe.md`가 정본이다.

1. **PASS** — §3의 Power 1~6/DOM 0~5/Model×Effort 매핑을 모두 왕복 확인.
2. **PASS** — Model/Effort/Speed checked, compact label, Fast accessible name 전이 확인.
3. **PASS** — Chat Pro와 Work Power 2/Standard가 surface 왕복 뒤 독립 유지.
4. **PASS** — 제출 직후 `Thinking`+`Stop answering`, 완료 뒤 exact nonce+Response
   actions+Stop 소멸 확인.
5. **PASS** — open picker root는 한 개였고 simple/advanced view marker는 같은 root에
   동시 마운트됐다. surface radio로 먼저 분기해야 하며 marker 존재만으로 surface를
   판별하지 않는다.

세부 역설계 항목과 합격 증거 형식은 `04_work_surface_support.md` §7.1~§7.2를
정본으로 삼는다. 두 묶음 중 하나라도 빠지면 WP1은 미완료다.

## 6. 제출·완료·재접속 계약

- 안전 프롬프트: `Return exactly WORK_PROBE_260710_0819...`를 Power 1/Standard,
  project·attachment·plugin 없이 한 번 제출했다.
- commit 직후 Work banner, pressed `Task details`, `Outputs`, `Sources`,
  `Create file or site`, `Add sources`, user message, assistant `Thinking`,
  `Stop answering`가 동시에 보였다.
- 완료 뒤 assistant paragraph가 exact `WORK_PROBE_260710_0819`, response actions가
  Copy/Share/Switch model/More actions였고 Stop은 사라졌다.
- 영속 URL은 `https://chatgpt.com/c/6a50ae48-7b4c-83ee-bc86-5f3228cad8be`였다.
  **완료된 task**를 검증용 새 탭 A에서 로드→A 닫기→새 탭 B에서 같은 URL 재로드 후
  prompt, nonce, Work banner, Task details, Outputs/Sources가 모두 복원됐다. 사용자 원래
  탭은 닫지 않았다. 실행 중 task의 target-loss/re-entry는 검증하지 않았다.
- 따라서 Work도 현재 `/c/<uuid>` URL을 사용한다. raw UUID만으로 Chat/Work를 구분할 수
  없으므로 session identity에는 `surface:'work'`와 response contract를 함께 저장해야 한다.

## 7. 프로브 방법과 폴백 사유

`agbrowse doctor`는 통과했고 `agbrowse start --headed --keep-bg-networking`도 9222에서
성공했다. 다만 agbrowse 전용 profile의 chatgpt.com은 Google sign-in으로 이동해
로그인 계약을 실측할 수 없었다. 사용자 승인에 따라 로그인된 Chrome 탭을 Computer Use로
조작하고 Chrome DOM으로 결과·재접속을 교차검증했다. 공개 OpenAI 원문은 별도로
`agbrowse fetch`의 direct/browser ladder로 검증했다. 즉 CDP 실패가 아니라 **profile 인증
분리**가 UI 프로브 폴백 사유다.
