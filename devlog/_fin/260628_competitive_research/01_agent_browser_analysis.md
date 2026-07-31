# Vercel agent-browser 분석 + agbrowse 차용 방향

Research date: 2026-06-28

## 1. agent-browser 핵심 아키텍처

### Client-Daemon 구조

```
CLI (Rust native binary)
  → Unix domain socket / TCP
  → Daemon (Rust native, persistent)
    → CDP WebSocket
    → Chrome / Lightpanda / Remote CDP
```

- **CLI**: 인수 파싱만 담당, sub-ms 응답
- **Daemon**: warm 상태 유지, 첫 명령 ~500ms, 이후 <100ms
- **Zero Node.js**: Playwright 없이 CDP 직접 통신
- **Tokio 비동기**: WebSocket reader task로 CDP 메시지 멀티플렉싱

### vs agbrowse 현재 구조

```
CLI (Node.js)
  → direct CDP (per-command reconnect)
  → Chrome
```

| 항목 | agent-browser | agbrowse |
|------|--------------|----------|
| 언어 | Rust | Node.js (ESM) |
| 아키텍처 | client-daemon (persistent) | per-command process |
| 첫 명령 latency | ~500ms | ~300-800ms |
| 이후 latency | <100ms | 200-500ms (reconnect) |
| Browser support | Chrome, Lightpanda, remote CDP | Chrome only |
| Session isolation | multi-session (per-socket) | single profile |
| MCP server | built-in | built-in (web-ai/mcp-server.mjs) |

### 핵심 차별점: 속도

agent-browser의 최대 강점은 **daemon이 warm 상태를 유지**하는 것. agbrowse는 매
명령마다 Node.js 프로세스를 새로 띄우고 CDP에 재연결한다. 50개 명령을 연속으로
치면 agent-browser는 ~5초, agbrowse는 ~15-25초 걸릴 수 있음.

## 2. agent-browser가 잘하는 것

### 2.1 Snapshot + Ref 시스템

- Accessibility tree 기반 (`@e1`, `@e2` 형식)
- interactive elements만 필터링 → 토큰 절약
- 스크린 리더가 소비하는 것과 동일한 트리 사용

**agbrowse 이미 동일**: `snapshot --interactive`가 같은 역할. `e1`, `e2` 레퍼런스
시스템 보유. 여기서는 parity 달성.

### 2.2 React DevTools 통합

- `react tree`, `react inspect` 명령
- React 컴포넌트 트리를 접근 가능

**agbrowse 미보유**: 현재 React DevTools 통합 없음. 대상 유저가 React 앱을
디버깅하는 케이스가 많다면 고려할 만함.

### 2.3 Web Vitals 보고

- `vitals` 명령으로 Core Web Vitals (LCP, CLS, INP) 측정
- 성능 분석용

**agbrowse 미보유**: 현재 performance 측정 기능 없음.

### 2.4 Multi-session Isolation

- 세션별 독립 소켓, 쿠키, ref 캐시
- 에이전트 병렬 작업 가능

**agbrowse 부분 보유**: `--new-tab` / `--parallel` 플래그로 탭 레벨 격리는 가능.
프로파일 레벨 완전 격리는 없음.

### 2.5 Plugin System

- 확장성을 위한 플러그인 아키텍처
- Browserbase, Browserless 등 remote provider 지원

**agbrowse 미보유**: 명시적 plugin API 없음. `adaptive-fetch/endpoint-resolvers.mjs`가
비슷한 역할을 하나 형식화되지 않음.

### 2.6 Cross-platform Native Binaries

- macOS, Linux, Windows 바이너리 배포
- npm 설치 + `agent-browser install`로 Chromium 다운로드

**agbrowse**: npm 패키지로 배포, 시스템 Chrome 사용. 별도 바이너리 없음.

## 3. agbrowse가 agent-browser보다 강한 것

| 영역 | agbrowse 강점 |
|------|--------------|
| Web-AI provider 자동화 | ChatGPT/Gemini/Grok 세션 관리, 모델 선택, code zip 추출 — 유일 |
| Adaptive fetch 6-phase ladder | URL 하나를 다양한 방법으로 읽는 멀티 시도 시스템 |
| Evidence/source audit | 출처 검증, trace, claim audit — evidence-first |
| Search orchestration | query rewrite → fetch → evidence score 파이프라인 |
| Runway 자동화 | 미디어 생성 워크플로우 |
| Korean research planning | 한국어 검색 최적화 (source hints, constraint ledger) |

## 4. 차용 로드맵 (우선순위순)

### P1: Connection Pool / Warm Daemon 패턴 (성능)

agbrowse의 per-command process 모델은 빈번한 명령에서 느림.
**방향**: `agbrowse daemon` 또는 persistent connection pool 도입.

```bash
agbrowse daemon start          # warm daemon 시작
agbrowse click e3              # daemon 경유 (<100ms)
agbrowse daemon stop           # 정리
```

구현 옵션:
- (A) Rust daemon (agent-browser 방식) — 대규모 리라이트, 고비용
- (B) Node.js daemon (Unix socket) — 기존 코드 재사용, 중간 비용
- (C) Persistent CDP connection cache (file-descriptor 유지) — 최소 변경

**추천: (B) 또는 (C)**. Node.js 장점(web-ai 모듈 재사용)을 유지하면서 warm 연결.

### P2: Multi-session Isolation

```bash
agbrowse session create --name "shopping"
agbrowse session create --name "research"
agbrowse --session shopping click e3
```

독립 프로필, 쿠키, 탭 상태. 병렬 에이전트 작업 지원.

### P3: Plugin/Provider 확장 API

```js
// agbrowse.config.mjs
export default {
  providers: ['@agbrowse/browserbase'],
  extractors: ['@agbrowse/stagehand-extract'],
  resolvers: ['@agbrowse/custom-endpoints'],
};
```

### P4: React DevTools + Web Vitals (nice-to-have)

타겟 유저가 React 앱 디버깅을 자주 한다면 추가.
Web Vitals는 `evaluate` 명령으로 이미 구현 가능하지만 전용 명령이 편리.

## 5. 핵심 결론

agent-browser는 **속도와 polished DX**에서 앞선다. agbrowse는 **Web-AI workflow와
evidence-first research**에서 유일하다. 따라서:

- 속도를 따라잡되 (daemon/pool), 독자적 강점(web-ai, evidence, search)을 유지
- agent-browser의 "50+ commands, cross-platform, plugin" 전략을 모방하지 말 것
- 대신 "logged-in browser + evidence + provider automation" 니치를 더 깊이 파기
- Remote CDP 지원은 장기적으로 필요하지만, 핵심 가치는 local-first 유지
