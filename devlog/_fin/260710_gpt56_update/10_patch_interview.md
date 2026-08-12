# 10 — 패치 실행 인터뷰 기록 (2026-07-10, I-phase)

01~09 패치 준비 문서(C게이트 3라운드 PASS)를 실제로 실행하는 방법을 정하는
인터뷰. 주인은 메인 세션, 형식은 IPABCD I-phase (cxc-interview).

## 사전 확정 사항 (이전 사이클에서 이미 결정 — 재질문 안 함)

- 코어 계약: 2축 입력(tier `--model` + family `--family`), effort 캐논
  medium/high/xhigh + legacy 재매핑, Work 전용 입력 DEFERRED (02).
- 3-상태 surface discriminator, composer-scoped 셀렉터, legacy testid는
  fallback 강등 (02/03/04).
- 타임아웃: 40분 상수 금지, explicit → 저장 deadline 잔여 → tier default
  상속, deadline 생성 tier-aware (05).
- 문서/게이트: browser.mjs help 포함 15개 문서 표면 + semantic drift 게이트 (08/09).

## 실행 결정 장부 (인터뷰 종결)

라운드 기록의 임시 질문 번호를 재사용하지 않고 아래 stable decision ID만 후속 단계가
참조한다.

| ID | 차원 | 확정 값 | 상태 |
| --- | --- | --- | --- |
| D1 | Budget | `chatgpt-pro=5400`, `grok-heavy=3600`, `deep-research=3600` | 종결 |
| D2 | Goal | 02~09 전체를 work-phase별 PABCD 반복으로 구현 | 종결 |
| D3 | Work UX | `web-ai work send --prompt ... --power N` 전용 명령 | 종결 |
| D4 | MCP | `web_ai_work_send` 동시 신설, 기존 tool surface 확장 금지 | 종결 |
| D5 | Family | `--family` 미지정 시 현재 UI 선택 무조작 | 종결 |
| D6 | Legacy | `--effort extended`→High 재매핑 + stderr 경고 한 줄 | 종결 |
| D7 | Probe | 로그인 세션으로 에이전트가 직접 live probe | 종결 |
| D8 | Success | 라이브 스모크 포함, npm publish/main merge는 goal 밖 | 종결 |
| D9 | Locale | 한국어 신규 라벨 미실측; legacy 라벨 보존 + 영어 신규 계약 우선 | 종결(가정 명시) |

## 라운드 기록

(각 라운드의 질문/답변/재스캔 결과를 아래에 append)

### 라운드 1 — Mind 스캔 (2026-07-10)

**Mind A (사용자 의도 렌즈)** — 당시 확인 필요 5건(HISTORICAL; D1~D6로 종결):
- [HIGH] "Pro 기본 추론 40분" 의미: agbrowse 기본 timeout을 2400s로 바꾸라는
  뜻인지, 40분 추론을 견딜 예산 경로 수리(현행 3600s 유지)인지. → D1
- [MED] Work 범위: 분석 완료로 충분한지, 자동화 구현(재프로브 포함)까지인지. → D3
- [MED] 다음 goal 경계: 01~09 실제 적용 시작 여부/승인 단계. → D2
- [MED] family 미지정 기본값: 현재 UI 선택 존중(02 캐논) vs gpt-5.6-sol 암묵 강제. → D5
- [LOW] legacy `extended` alias: 재매핑+경고 유지(02 캐논) vs 공개 입력에서도 제거. → D6

**Mind B (레포 현실 렌즈)** — 플랜 수리 대상 7건 (질문 아님, P에서 접을 것):
- [HIGH] checkjs 베이스라인 실패(24+124건, 05/06 범위 밖 다수) — "checkjs 0"
  완료 조건은 touched-files 스코프 또는 베이스라인 정리 선행으로 수정 필요.
- [HIGH] 09 closeout의 `git mv`는 유닛이 untracked라 실패 — `git add` 선행.
- [HIGH] 03↔04↔07 테스트/fixture 순환 — fixture-first 실행 순서로 재배열.
- [HIGH] 02가 chatgpt-model.mjs:78-102 교체 후 03의 Before 앵커 무효화 —
  단계별 앵커 재검증(스테일 체크)을 실행 프로토콜에 명시.
- [MED] 09 closeout이 release_gates.md 전체 게이트(contract-drift,
  strict-baseline, module-graph, bin smoke, pack dry-run, Pages)보다 약함.
- [MED] 릴리스는 clean main 전제인데 현재 dirty dev — 브랜치/릴리스 전략 필요. → D8
- [MED] vitest manifest 3.2.6 vs 설치 3.2.4 — 검증 전 `npm ci` 선행.

### 라운드 1 당시 상태 (HISTORICAL, 이후 전부 종결)

- request_user_input 다이얼로그가 2회 연속 빈 응답으로 유실돼 당시 상위 3개 쟁점을
  채팅 텍스트로 직접 질문했다. 아래 라운드 답변과 D1~D9가 모두 종결했으므로 현재
  대기 중인 질문은 없다.
- 재스캔(INTERVIEW-SCAN-01): 신규 답변 없음 → 모순 목록 변동 없음.
  Mind B의 7건은 사용자 질문이 아니라 P-phase 플랜 수리 항목으로 분류 유지.

### 라운드 1 답변 (2026-07-10, 채팅 텍스트)

- **Pro 예산 → 확대(D1)**: "기본을 90분까지 올리고 어차피 poll watcher 되잖아" —
  Pro tier 기본 대기 예산을 **5400초(90분)** 로 상향. 05의 상속형 수리(잔여
  budget 상속, deadline 생성 tier-aware)는 그대로 유지하고, SSOT 값만
  3600→5400으로 변경. 40분 상수 금지 원칙 유지(2400 안 만듦).
  → 05 수정 필요: session.mjs:394-402 tier 표의 pro 값, 관련 테스트
  (web-ai-timeout-default.test.mjs의 3600 행), help/문서 표기(08) 연쇄.
  deep-research tier(3600)는 당시 미확정이었고 라운드 2에서 3600 유지(D1)로 종결.
- **실행 범위 → 전체, PABCD 반복(D2)**: "pabcd 반복하면서 전체" — 02~09 전부를
  한 goal에서 work-phase 체인(사이클 반복)으로 적용. npm 릴리스 포함 여부는 당시
  미언급이었고 이후 goal 밖/별도 승인(D8)으로 종결.
- **Work UX → 사용자가 직접 정의 예정(D3)**: "work 명령어 ux 를 어떻게 할지
  정해야돼 내가 말해줄께" — Work 표면은 감지+가드를 넘어 **CLI 명령어
  UX 설계까지 이번 범위에 포함**되는 방향. 사용자가 UX를 구술할 예정 —
  라운드 2에서 수령. 04 스코프 확장 예상(재프로브 필요성 재평가 필요).

### 라운드 2 — 재스캔 (Mind C: Pro 5400 + 전체 체인 파급)

**당시 사용자 확인 항목 (HISTORICAL, D1로 종결):**
- [CRITICAL] `session.mjs:397,433-436` — `pro` tier는 Grok Heavy와 공유.
  Pro만 5400으로 올리려면 tier 분리 필요, 아니면 Grok Heavy도 함께 5400. → D1
- [MED] deep-research tier(DR/Gemini Deep Think) 3600 유지 여부 — Pro 5400과
  비대칭 발생. → D1

**P-phase 플랜 수리 항목 (질문 아님):**
- 05/00/07/08/09 문서 5개의 "Pro 3600 SSOT 유지" 캐논·숫자 표기 ~30지점을
  5400 결정으로 일괄 갱신 (semantic gate 필수 토큰 `pro=3600` 포함).
- skills/web-ai/SKILL.md:109-120, README:542-550/77/566, docs/index.html:315,
  browser.mjs:3385/3422-3424 — 1800 권고/1200 vendor 표기도 5400 계약으로.
- 체인 실행 순서 재설계: 02↔04 discriminator/guard 소유 역참조 해소,
  03↔04↔07 fixture 순환 → **fixture-first**(07의 fixture 파트 선행) +
  02/04 소유권 재배분 + 문서 앵커 stale-check를 각 work-phase P에 명시.
- 00:6-7 "다음 유닛이 01~09 실행" → "02~09 실행(01은 증거 입력)" 정정.
- 07:954-960 적용 순서 번호 6 중복 정정.

### 라운드 2 답변 (2026-07-10)

- **Work CLI → 서브커맨드형 확정(D3)**: `agbrowse web-ai work send --prompt "..." --power 4`.
  Chat과 명령 공간을 분리해 오발을 원천 차단. → 04 스코프가 "감지+가드"에서
  **Work 자동화(전용 서브커맨드) 포함**으로 확장. 02의 "Work 입력 스키마
  reject" 정책은 "Chat 명령(`send` 등)에서는 reject 유지 + 신설 `work`
  서브커맨드가 유일한 진입점"으로 재정의 필요.
- **Timeout tier → 3분리 확정(D1)**: "그냥 세개 다 분리하자" —
  `chatgpt-pro=5400`(90분) / `grok-heavy`(별도 tier, 3600 유지) /
  `deep-research`(DR·Gemini Deep Think, 3600 유지). session.mjs tier 표를
  provider-정확 tier로 분리하고 테스트/문서 연쇄 갱신.

**파생 결정 (재스캔에서 도출, P에서 접을 것):**
- `work send --power N`은 Power 슬라이더 매핑(N of 6 의미)과 Work 제출/poll
  DOM 실측이 선행돼야 구현 가능 — 01 §5.1 재프로브가 **체인 내 선행
  work-phase**로 승격 (로그인된 chatgpt.com 탭 필요 — 사용자 협조 시점 확인).

### 라운드 3 — 재스캔 (Mind D: work 서브커맨드 + tier 3분리 파급)

**당시 신규 질문 (HISTORICAL, D4로 종결):**
- [HIGH] MCP 노출 — `work send`는 CLI 전용으로 먼저 갈지, MCP에도
  `web_ai_work_send` 도구를 동시 신설할지 (기존 도구에 surface 파라미터
  확장은 명령 공간 분리 결정과 충돌이라 배제). → D4

**P-phase 플랜 수리 항목 (질문 아님, path:line은 Mind D 반환 참조):**
- 02: "Chat-only/Work 제외" 서술 재정의 (Chat 명령 reject 유지 + `work`
  서브커맨드가 유일 진입점), `send`에 surface=work 추가하는 제안 제거.
- 04: DEFERRED 로드맵을 활성 구현 순서로 복원, read-only 계약을
  parser/mutation/검증 계약으로 승격, Chat 명령의 Work hard-error는 유지하되
  `work send` 경로 분리. 재프로브 5항목은 여전히 선행 조건.
- CLI 구조: `project-sources <list|add>` 선례(cli.mjs:1813-1831)를 따라
  `work` 최상위 커맨드 + 전용 2단 파서.
- session.mjs: tier 표 `pro`→`chatgpt-pro:5400`, `grok-heavy:3600` 신설,
  `deep-research:3600` 유지; deriveTimeoutTier 정규화 경로 수정;
  PRO_TIMEOUT_SEC → CHATGPT_PRO_TIMEOUT_SEC(호환 export 선언).
- 05/07/08/09: 3-tier 분리 반영 (tier 표 3행, semantic gate 토큰 3종,
  Grok Heavy/Deep Think 비혼입 회귀 추가).

### 라운드 3 답변 (2026-07-10) — 인터뷰 종결

- **MCP → CLI와 동시(D4)**: `work send` CLI와 MCP `web_ai_work_send` 도구 둘 다.
  "pabcd 거치면서 하나씩 하면돼" — 한 goal 안에서 work-phase로 순차 구현.
- **Family → 현재 UI 선택 존중(D5)**: family 미지정 시 조작 안 함 (02 캐논 확정).
- **Legacy effort → 재매핑+경고 유지(D6)**: `extended`→High 승격 + 경고 (02 캐논 확정).
- **재프로브 → 에이전트가 직접(D7)**: "너가 띄우면 돼 로그인돼어있어" —
  인앱 브라우저로 에이전트가 chatgpt.com을 직접 열어 실측.
- **실행 모드**: "pabcd 100번을 돌려서라도 구현완료해노" — HOTL
  continue-until-done 명시 승인.

### 최종 재스캔 + 종결된 제약

모든 high 모순은 답변 또는 플랜 수리 항목으로 소진됐다. 다음은 열린 질문이 아니라
stable decision 또는 명시적 실측 범위다.

1. npm 릴리스(0.1.16 publish)는 이 goal 범위 밖이며 별도 승인 후 수행(D8).
2. 한국어 UI 신규 라벨은 미실측이고 legacy 계약을 보존한다(D9).
3. tier 값은 chatgpt-pro=5400, grok-heavy/deep-research=3600으로 확정(D1).
4. `--power N`의 Model×Effort 프리셋은 WP1 live UI adapter mapping으로 확정했으며
   공식 OpenAI taxonomy로 일반화하지 않는다.

MCP 도구명은 더 이상 가정이 아니다. 아래 확정 결정대로 `web_ai_work_send`로
고정하며 기존 도구의 `surface=work` 확장은 금지한다.

### 확정 결정 요약 (P의 입력)

| 결정 | 값 |
| --- | --- |
| Pro 대기 예산 | chatgpt-pro tier **5400s(90분)**, tier 3분리(grok-heavy/deep-research 각 3600 유지) |
| 실행 범위 | 02~09 전부 + Work 자동화 + MCP work 도구, 한 goal에서 PABCD 체인 |
| Work UX | 서브커맨드 `agbrowse web-ai work send --prompt "..." --power N` (Chat 명령 공간 분리) |
| MCP | `web_ai_work_send` 동시 신설 (기존 도구 surface 확장 금지) |
| family 기본 | 미지정 시 무조작 (현재 UI 선택 존중) |
| legacy effort | `extended`→High 재매핑+경고 유지 |
| 재프로브 | 에이전트가 인앱 브라우저로 직접 (로그인 세션 사용 가능) |
| 릴리스 | goal 범위 밖 (별도 승인) |

## 인터뷰 후 공식 조사 확정 (2026-07-10)

사용자 지시에 따라 cxc-search Tier 3를 두 wave로 수행했다. 1차는 출시/도움말/보안
경계를 세 명의 GPT-5.6 Sol medium에 분리했고, 2차는 Free·Go entitlement,
web-vs-desktop browser, ordinary-vs-scheduled persistence, Power-vs-official taxonomy를
독립 반증했다. 각 에이전트는 결과 회수 즉시 종료했다. 상세 claim ledger는
`.codexclaw/evidence/260710_work_official_web_research.md`다.

### 날짜 판정

- 공식 출시글 [ChatGPT is now a partner for your most ambitious work](https://openai.com/index/chatgpt-for-your-most-ambitious-work/)와
  [GPT-5.6](https://openai.com/index/gpt-5-6/)은 **2026-07-09** 게시다.
- RSS 기준 출시 시각은 10:00 UTC, 즉 19:00 KST다. 서울 기준 7월 10일 당일 출시는
  아니며, 7월 10일에는 도움말 업데이트와 순차 rollout이 계속됐다.

### Work가 웹에서 할 수 있는 것

1. 공개·로그아웃 사이트를 cloud browser로 열고 최신 정보 수집, 비교, interactive page
   확인과 지원되는 입력/동작을 수행한다. Task details에서 진행·스크린샷·replay를 확인한다.
2. web search로 현재 정보를 찾고 source/citation을 반환한다.
3. 연결된 apps/plugins를 읽고, 허용된 경우 외부 시스템의 create/update/send/share/delete
   등 write action을 수행한다. 기본 `Important actions` 정책은 read를 자동 허용하고
   중요한 외부 효과에 승인을 요구하지만 모든 mutation이 반드시 물어보는 것은 아니다.
4. 문서·스프레드시트·프레젠테이션·PDF를 만들고 수정하며, 연결된 Google Workspace에서는
   native Docs/Sheets/Slides를 만들거나 고칠 수 있다.
5. Sites public beta로 dashboard, tracker, portal, prototype 같은 site/lightweight app을
   preview·배포·공유·게시·업데이트·삭제할 수 있다.
6. Scheduled Tasks는 일회·반복·trigger·monitoring 작업을 deferred/background로 수행한다.
   ordinary Work는 수시간 지속할 수 있으나 브라우저/앱/기기 종료 뒤 생존을 보장하는 공식
   문구는 없다.

### 반드시 분리할 경계

| 차원 | 확정 계약 |
| --- | --- |
| web/mobile Work browser | device browser와 분리된 cloud browser; 공개 signed-out site만. credentials/login, 기존 tabs/history/extensions/passwords 사용 불가 |
| desktop built-in browser | 별도 local profile이며 사용자가 직접 로그인 가능; Computer Use/local apps는 별도 permission 계약 |
| Chrome extension | 기존 Chrome profile/session을 쓰는 별도 surface; cloud Work와 동일시 금지 |
| app action | app OAuth와 admin/user approval 계약. hostname 허용은 consequential action 승인과 별개 |
| entitlement | web/mobile은 paid rollout(Free/Go 제외), desktop launch는 Free 포함. account 전역 boolean 금지 |
| model taxonomy | 공식은 Sol/Terra/Luna, effort, max, ultra. 6단계 `Power` 명칭·매핑은 live UI adapter 계약이지 공식 API taxonomy가 아님 |

### 패치 파급

- v1 `work send`/`web_ai_work_send`는 prompt+Power(+speed, timeout)까지만 노출한다.
  browser permission, apps/plugins, Sites publish, Scheduled Tasks, project, attachment는 후속
  계약으로 유지한다.
- Work availability는 live radio로 감지하고, 문서/diagnostic에서 cloud/desktop/Chrome
  capability를 합쳐 말하지 않는다.
- `--power 6`의 UI 매핑은 Sol Ultra지만 Max와 Ultra를 동의어로 만들지 않는다.
- ordinary Work poll/watcher는 long-running interactive session으로 표현하고 durable/offline
  execution을 보장하지 않는다.

## Plugins 디렉터리 추가 실측 (2026-07-10)

사용자 추가 지시에 따라 로그인된 `https://chatgpt.com/plugins`를 별도 검증 탭에서
DOM 분석하고 공식 [Plugins in ChatGPT and Codex](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt-and-codex)와
대조했다. 실제 설치·연결·해제·workflow 실행은 하지 않았다. 상세 raw ledger는
`.codexclaw/evidence/260710_plugins_directory_probe.md`다.

### 관측 계약

- `/plugins`는 Plugins/Skills 탭, `Search plugins`, category query 링크, plugin article
  card 목록으로 구성된다. raw DOM에는 responsive duplicate tab이 있어 visible `main`
  scope와 uniqueness 확인이 필요하다.
- plugin 상세는 Apps, Skills, Information을 함께 보여준다. 설치된 GitHub에는
  `Manage/Uninstall`, 연결 app에는 `Reconnect/Disconnect`; 미설치 Notion에는
  `Install plugin`이 노출됐다.
- GitHub detail의 workflow 링크는
  `/?surface=work&hints=plugin:<id>&prompt=...` 의미의 URL이었다. 이는 현재 UI의 Work
  진입 힌트일 뿐 안정된 공개 API로 간주하지 않는다.
- `/skills`에는 `Search Skills`와 Create menu(`Create with chat`, `Create with editor`,
  `Upload from your computer`)가 있었다. 이 계정에는 나열된 personal skill이 없었다.
- 공식 계약상 plugin은 skills/apps/app templates 묶음이며, app의 role/read-write/action
  approval/sync/domain/source-system 권한을 상속한다. directory visibility는 설치·사용
  가능성을 뜻하지 않는다.

### 범위 결정

이번 v1 `work send`에는 `--plugin`이나 plugin hint 합성을 넣지 않는다. 후속 slice는
plugin identity, installed/enabled/connected 상태, OAuth handoff, app approval, workflow
activation verification, uninstall/disconnect confirmation을 한 계약으로 설계해야 한다.
현재 Work composer의 Plugins button은 오발 exclusion selector/evidence로만 사용한다.
