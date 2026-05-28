# MCP vs agbrowse Gap Analysis

## MCP 도구 → agbrowse 대응 매핑

| # | MCP Tool | agbrowse 현재 | Gap | 우선순위 |
|---|----------|--------------|-----|---------|
| 1 | `whoami` | `status` (부분) | 모델 목록, plan 타입, 크레딧 잔량 미추출 | P1 |
| 2 | `list_workspaces` | 없음 | 워크스페이스 전환은 브라우저에서 가능 (우위) | P3 |
| 3 | `list_recent` | 없음 | Recents 서피스 DOM 파싱 필요 | P2 |
| 4 | `generate_image` | 없음 (safety blocked) | 전체 이미지 생성 워크플로우 필요 | **P0** |
| 5 | `generate_video` | 없음 (safety blocked) | 전체 비디오 생성 워크플로우 필요 | **P0** |
| 6 | `generate_multishot_video` | 없음 | 멀티샷은 웹 UI Workflow 서피스 | P2 |
| 7 | `generate_product_marketing_video` | 없음 | compound workflow — step 분해 가능 | P3 |
| 8 | `init_upload` | 없음 | 브라우저 file input으로 대체 가능 (우위) | P1 |
| 9 | `complete_upload` | 없음 | 위와 동일 — 브라우저 네이티브 업로드 | P1 |
| 10 | `get_task` | `poll` (완전) | DOM 기반 더 풍부한 progress 정보 (우위) | 완료 |
| 11 | `feedback` | 불필요 | Runway 내부용 | N/A |

## agbrowse 우위 (MCP가 못 하는 것)

### 1. Unlimited/Explore Mode 사용 ⭐⭐⭐
```
MCP:  항상 크레딧 소모 (공식 FAQ 확인됨)
agbrowse: 웹 UI Explore 모드 선택 → 크레딧 미소모 (relaxed rate)
```
이것이 가장 큰 우위. Unlimited 플랜 사용자가 MCP 대신 agbrowse를 쓸 이유.

### 2. 전체 모델 접근
```
MCP 이미지: 3개 (nano-banana-pro, gpt-image-2, gen-4)
MCP 비디오: 6개 (seedance-2, kling-o3-pro, kling-3-pro, gen-4.5, veo-3.1, gen-4-turbo)
agbrowse:   웹 UI에 노출되는 모든 모델 (FLUX 계열, 신규 모델 포함)
```

### 3. API 키 불필요
```
MCP:  Runway API 인증 (OAuth 또는 API key)
agbrowse: Chrome 프로필의 기존 로그인 세션 사용
```

### 4. 시각적 검증 + 스크린샷
```
MCP:  task ID로 상태 조회 → 에셋 URL 반환 (시각적 확인 없음)
agbrowse: DOM 검사 + 스크린샷으로 실제 UI 상태 확인 가능
```

### 5. DOM 기반 풍부한 Progress
```
MCP:  PENDING | RUNNING | THROTTLED | SUCCEEDED | FAILED (5 상태)
agbrowse: %, queue position, active signal count, output item count, button disabled 상태 등
```

### 6. 큐 관리 + 수동 개입
```
MCP:  큐가 차면 실패 또는 대기
agbrowse: 큐 상태 실시간 감시 + 사람이 개입할 수 있는 표면
```

### 7. 파일 업로드 간소화
```
MCP:  init_upload → PUT bytes → complete_upload (3단계)
agbrowse: input[type="file"]에 파일 직접 주입 (1단계)
```

## agbrowse 열위 (MCP가 잘 하는 것)

### 1. Headless 실행
```
MCP:  서버 프로세스만으로 실행 가능
agbrowse: Chrome 브라우저 필요 (headed)
```

### 2. 속도
```
MCP:  API 직접 호출 → DOM 파싱 없음
agbrowse: 셀렉터 대기 + DOM 평가 오버헤드
```

### 3. 안정성
```
MCP:  API 계약 — 셀렉터 변경에 영향 없음
agbrowse: UI 변경 시 셀렉터 깨질 수 있음
```

### 4. Multi-provider 통합
```
MCP:  ChatGPT file param으로 다른 AI 에이전트와 자연 연결
agbrowse: 파일 경로 기반 (로컬 워크플로우에 더 적합)
```

## 종합 판단

```
MCP:  "API 파이프라인 자동화"에 적합. 크레딧 소모.
agbrowse: "사람이 직접 쓰는 워크플로우 자동화"에 적합. Unlimited 활용.
```

결론: 두 시스템은 보완 관계이지만, **Unlimited 플랜 사용자에게는 agbrowse가 압도적 우위**.
agbrowse가 MCP 전체 기능을 커버하면서 Explore 모드 + 전체 모델 접근을 추가하면,
MCP를 완전 대체 가능.
