# MCP Runway 전체 해부 (11 Tools)

Source: Runway MCP server at `https://mcp.runwayml.com/mcp`
Protocol: JSON-RPC over MCP (via `mcp-remote` bridge)
Auth: OAuth — MCP 연결 시 Runway 계정 로그인, workspace 선택
Billing: **모든 생성은 크레딧 소모** (Unlimited 플랜이어도 MCP 경유 시 크레딧 차감)

---

## 1. `whoami`

인증된 사용자 프로필 + 현재 워크스페이스 + 사용 가능 모델 목록 반환.

```
params: { rationale?: string }
returns: { user, workspace, availableModels[], multipleWorkspacesAvailable }
```

- 워크스페이스별 모델 가용성이 다름 (disabled models)
- `multipleWorkspacesAvailable: true`면 `list_workspaces` 호출 가능

**agbrowse 대응 필요**: 웹 UI에서 plan 타입, 크레딧 잔량, 사용 가능 모델 추출

---

## 2. `list_workspaces`

사용자가 속한 모든 워크스페이스 목록 + role + disabled model 요약.

```
params: { includeDisabledModels?: boolean, rationale?: string }
returns: { workspaces[{ id, name, role, disabledModels? }] }
```

- 워크스페이스 전환은 MCP 재연결 필요
- agbrowse에서는 브라우저 내 워크스페이스 전환이 가능 (우위)

---

## 3. `list_recent`

최근 업로드/생성 에셋 목록. 재사용할 reference 이미지/비디오 선택용.

```
params: { limit?: 10-50 (default 12), rationale?: string }
returns: { assets[{ id, mediaType, taskId?, url }] }
```

**agbrowse 대응 필요**: Recents 서피스 DOM 파싱으로 에셋 목록 추출

---

## 4. `generate_image` ⭐ 핵심

이미지 생성 AND 편집. 별도 edit_image 없음.

```
params: {
  promptText: string (required)
  model?: "nano-banana-pro" | "gpt-image-2" | "gen-4" (default: nano-banana-pro)
  ratio?: string (모델별 지원값 다름)
  count?: 1|2|3|4 (default: 1)
  referenceImages?: [{ url, tag? }] (편집/합성용)
  referenceImageFile?: { download_url, file_id } (ChatGPT 전용)
  rationale?: string
}
```

### 3가지 모드
1. **Text-to-image** — promptText만. 새 이미지 생성
2. **Image edit/transform** — referenceImages[0] + promptText. 배경 교체, 스타일 전환, 객체 추가/제거
3. **Composite** — referenceImages 2개+ 각각 tag → promptText에서 @tag로 참조

### 모델별 차이
| Model | 특징 |
|-------|------|
| nano-banana-pro | 기본값, 빠름 |
| gpt-image-2 | OpenAI GPT Image 2 |
| gen-4 | Runway Gen-4 이미지 |

**agbrowse 우위**: MCP는 3개 모델 고정. 웹 UI는 더 많은 모델 노출 가능

---

## 5. `generate_video` ⭐ 핵심

비디오 생성 AND 편집. 별도 edit_video 없음.

```
params: {
  promptText: string (required)
  model?: "seedance-2" | "kling-o3-pro" | "kling-3-pro" | "gen-4.5" | "veo-3.1" | "gen-4-turbo"
  duration?: number (모델별 다름, 보통 5|10|15)
  ratio?: string
  resolution?: string (480p|720p|1080p 모델별)
  startFrame?: { url } (image-to-video 소스)
  endFrame?: { url } (끝 프레임 타겟)
  referenceVideo?: { url, durationSeconds? } (video-to-video 소스)
  referenceImages?: [{ url, tag? }] (스타일/주제 참조)
  generateAudio?: boolean
  startImageFile?: { ... } (ChatGPT 전용)
  referenceVideoFile?: { ... } (ChatGPT 전용)
  rationale?: string
}
```

### 3가지 모드
1. **Text-to-video** — promptText만. gen-4-turbo는 먼저 이미지 생성 후 애니메이트 권장
2. **Image-to-video** — startFrame + promptText. 정지 이미지를 영상으로
3. **Video-to-video** — referenceVideo + promptText. 기존 영상 편집 (배경 제거, 객체 제거, 스타일 변경)
   - seedance-2, kling-o3-pro만 지원

### 모델별 차이
| Model | 모드 | Duration | Resolution |
|-------|------|----------|------------|
| seedance-2 | t2v, i2v, v2v | 5/10/15 | 480p/720p/1080p |
| kling-o3-pro | t2v, i2v, v2v | 5/10/15 | ? |
| kling-3-pro | t2v, i2v | 5/10/15 | ? |
| gen-4.5 | t2v, i2v | ? | ? |
| veo-3.1 | t2v, i2v | ? | 720p/1080p (1080p는 8s 필요) |
| gen-4-turbo | t2v (이미지 먼저 생성 권장) | ? | ? |

**agbrowse 우위**: 웹 UI에서 Explore 모드 선택 → 크레딧 미소모. MCP는 항상 크레딧 소모.

---

## 6. `generate_multishot_video`

멀티샷 비디오 (3-5 연결 장면). Kling 3.0 기반.

```
params: {
  mode?: "auto" | "custom"
  storyPrompt?: string (auto 모드 필수)
  promptText?: string (storyPrompt 별칭)
  shots?: [{ prompt }] (custom 모드 필수, 3-5개)
  duration?: 5|10|15 (총 길이, 샷별 균등 분할)
  aspectRatio?: "16:9" | "1:1" | "9:16"
  resolution?: "720p" | "1080p" (Kling 3.0 Pro)
  firstSceneImage?: { url, assetId? }
  sound?: boolean
  rationale?: string
}
```

- auto: 하나의 storyPrompt로 자동 장면 분할
- custom: 장면별 프롬프트 직접 지정
- 5-10분 소요

**agbrowse 대응 필요**: 웹 UI에서 multi-shot은 Workflow 서피스에 해당할 수 있음

---

## 7. `generate_product_marketing_video`

상품 URL/이미지 → 크리에이티브 광고 영상 자동 생성.

```
params: {
  promptText: string (required — 광고 아이디어)
  productUrl?: string (상품 페이지 URL)
  productImages?: [{ url, tag? }]
  productImageFile?: { ... } (ChatGPT 전용)
  referenceImages?: [{ url, tag? }] (캐릭터/씬/무드 참조)
  format?: "creative_ad_video" (v1 유일값)
  duration?: 10|15
  productMetadata?: { title, description, url, image }
  storyboardImage?: { url } (내부 continuation용)
  rationale?: string
}
```

워크플로우:
1. productUrl에서 상품 이미지 추출 (또는 productImages 직접 전달)
2. 3x3 스토리보드 이미지 자동 생성 (GPT Image 2 또는 Nano Banana Pro)
3. 스토리보드 기반 Seedance 2로 최종 영상 생성

**agbrowse 대응**: 이건 compound workflow — agbrowse에서는 step-by-step으로 분해 가능

---

## 8. `init_upload`

파일 업로드 초기화. 임시 업로드 URL 반환.

```
params: {
  filename?: string
  fileSize?: number (bytes, > 0)
  mimeType?: "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "video/mp4" | "video/quicktime" | "video/webm"
  file?: { ... } (ChatGPT 전용)
  rationale?: string
}
returns: { uploadId, uploadUrls[], partSize }
```

- 반환된 URL에 PUT으로 파일 바이트 전송
- ETag 헤더 캡처 필요

---

## 9. `complete_upload`

업로드 완료 → 에셋 URL 반환.

```
params: {
  uploadId: string
  parts: [{ partNumber, etag }] (단일 파트여도 필수)
  rationale?: string
}
returns: { assetUrl }
```

- 반환된 assetUrl을 startFrame/referenceImages/referenceVideo에 사용

**agbrowse 우위**: 브라우저에서 input[type="file"]에 직접 파일 주입 → 업로드 API 불필요

---

## 10. `get_task`

생성 작업 상태 조회.

```
params: { id: string, rationale?: string }
returns: { status: "PENDING"|"RUNNING"|"THROTTLED"|"SUCCEEDED"|"FAILED", assetUrl? }
```

- 이미지: 30-60초 대기 권장
- 비디오: 60-120초 대기 권장
- SUCCEEDED 시 에셋 URL 포함

**agbrowse 대응**: `poll` 명령이 이미 DOM 기반으로 이를 커버. 더 풍부한 progress 정보 (%, queue position)

---

## 11. `feedback`

도구 사용 중 문제 보고. Runway 팀용.

```
params: { summary, attempted, userIntent }
```

agbrowse 불필요.

---

## MCP 지원 모델 전체 목록

### 이미지 모델 (3개)
- `nano-banana-pro` (default)
- `gpt-image-2`
- `gen-4`

### 비디오 모델 (6개)
- `seedance-2` (default, t2v/i2v/v2v)
- `kling-o3-pro` (t2v/i2v/v2v)
- `kling-3-pro` (t2v/i2v)
- `gen-4.5` (t2v/i2v)
- `veo-3.1` (t2v/i2v)
- `gen-4-turbo` (t2v — 이미지 먼저 생성 권장)

### 멀티샷 엔진 (1개)
- Kling 3.0 (720p standard / 1080p pro)

### MCP에 없는 웹 UI 모델 (agbrowse 우위)
- FLUX 계열 (FLUX.2 Max 등)
- 향후 추가되는 모델 전부 (MCP 업데이트 대기 불필요)
