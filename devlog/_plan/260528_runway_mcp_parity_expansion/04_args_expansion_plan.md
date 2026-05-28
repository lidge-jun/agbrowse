# agbrowse runway Args 확장 계획

## 설계 원칙

1. **Safety 계층화** — read-only(기본) / write(--allow-mutation) / submit(--allow-submit) 3단계
2. **MCP 전체 커버** — MCP 11개 도구가 하는 모든 것을 agbrowse CLI에서 가능
3. **MCP 초과** — Explore 모드 전환, 전체 모델 접근, DOM 기반 풍부한 상태
4. **기존 명령 하위호환** — 현재 5개 명령 시그니처 변경 없음

---

## Phase 1: 기존 명령 강화 (MCP `whoami` + `list_recent` 대응)

### `agbrowse runway status` 확장

현재: 서피스 감지 + 셀렉터 검사 + 인증/quota 힌트
추가:

```
agbrowse runway status [--surface auto|apps|custom-tools] [--json]
```

**추가할 추출 항목:**
- `plan.type`: Unlimited / Standard / Free (credit-info-button 텍스트 파싱)
- `plan.credits`: 잔여 크레딧 수치 (가능한 경우)
- `models.available[]`: 현재 서피스에서 보이는 모델 목록 (DOM 파싱)
- `models.selected`: 현재 선택된 모델명
- `mode`: Explore / Credits (모드 토글 상태)
- `workspace.name`: 워크스페이스 이름

→ MCP `whoami` + `list_workspaces` 대응 완료

### `agbrowse runway recents` (신규)

```
agbrowse runway recents [--limit 20] [--type image|video|all] [--json]
```

Recents 서피스 DOM에서 에셋 카드 파싱:
- `assets[].id` — 에셋 식별자
- `assets[].type` — image/video
- `assets[].thumbnail` — 썸네일 URL
- `assets[].model` — 생성 모델명
- `assets[].timestamp` — 생성 시각
- `assets[].downloadUrl` — 다운로드 링크 (가능한 경우)

→ MCP `list_recent` 대응 완료

---

## Phase 2: 생성 워크플로우 (MCP `generate_*` 대응) ⭐ 핵심

### Safety 계층

```
Level 0 (기본):  read-only. 현재와 동일.
Level 1 (--allow-mutation):  프롬프트 입력, 모델 선택, 파라미터 설정, 파일 업로드 허용.
                              Generate 버튼은 여전히 금지.
Level 2 (--allow-submit):  Generate 버튼 클릭 허용. 완전 자동 생성.
```

### `agbrowse runway setup` (신규 — Level 1)

프롬프트 + 파라미터를 UI에 세팅만 하고, Generate는 누르지 않음.
사람이 검토 후 직접 Generate 클릭.

```
agbrowse runway setup \
  --surface custom-tools \
  --model seedance-2 \
  --prompt "A cat walking through a neon city" \
  --mode video \
  --duration 10 \
  --ratio 16:9 \
  --resolution 1080p \
  --seed-image ./cat.png \
  --explore \
  --json
```

**Args:**
| Arg | Type | Default | MCP 대응 | 설명 |
|-----|------|---------|---------|------|
| `--surface` | string | custom-tools | N/A | 타겟 서피스 |
| `--model` | string | auto | generate_*.model | 모델 선택 |
| `--prompt` | string | (필수) | generate_*.promptText | 프롬프트 텍스트 |
| `--mode` | string | auto | N/A (MCP는 도구로 분리) | video/image/audio 모드 |
| `--duration` | number | 10 | generate_video.duration | 비디오 길이 (초) |
| `--ratio` | string | 16:9 | generate_*.ratio | 비율 |
| `--resolution` | string | auto | generate_video.resolution | 해상도 |
| `--seed-image` | path | null | generate_video.startFrame | 시작 프레임 이미지 |
| `--end-image` | path | null | generate_video.endFrame | 끝 프레임 이미지 |
| `--reference-video` | path | null | generate_video.referenceVideo | V2V 소스 비디오 |
| `--reference-images` | path[] | [] | generate_*.referenceImages | 참조 이미지 (복수) |
| `--explore` | boolean | false | N/A (MCP 불가) | **Explore 모드 강제 (우위)** |
| `--audio` | boolean | true | generate_video.generateAudio | 오디오 생성 |
| `--count` | number | 1 | generate_image.count | 이미지 생성 수 |
| `--json` | boolean | false | N/A | JSON 출력 |

**출력:**
```json
{
  "ok": true,
  "command": "setup",
  "model": "seedance-2",
  "prompt": "A cat walking through a neon city",
  "mode": "video",
  "explore": true,
  "params": { "duration": 10, "ratio": "16:9", "resolution": "1080p" },
  "seedImage": { "uploaded": true, "filename": "cat.png" },
  "readyToGenerate": true,
  "safety": { "mutationAllowed": true, "submitAllowed": false }
}
```

→ MCP `generate_image`, `generate_video`의 파라미터 세팅 부분 대응
→ MCP에 없는 `--explore` 플래그로 Unlimited 우위 확보

### `agbrowse runway generate` (신규 — Level 2)

setup + Generate 클릭 + poll까지 한 번에.

```
agbrowse runway generate \
  --model seedance-2 \
  --prompt "A cat walking through a neon city" \
  --mode video \
  --duration 10 \
  --seed-image ./cat.png \
  --explore \
  --output ./cat-walking.mp4 \
  --timeout 600000 \
  --json
```

**추가 Args (setup에 더해서):**
| Arg | Type | Default | 설명 |
|-----|------|---------|------|
| `--output` | path | null | 생성 완료 시 파일 다운로드 경로 |
| `--timeout` | number | 600000 | poll 타임아웃 (ms) |
| `--interval` | number | 5000 | poll 간격 (ms) |
| `--allow-submit` | boolean | (implicit) | generate 명령은 암묵적 Level 2 |

워크플로우:
1. `open --surface custom-tools`
2. 모델 선택 (base-model-select 클릭 → 목록에서 선택)
3. Explore 모드 확인/전환
4. 프롬프트 입력 (prompt-editor에 텍스트 삽입)
5. 파라미터 설정 (duration, ratio, resolution)
6. 파일 업로드 (seed-image → file-input에 주입)
7. Generate 클릭
8. poll로 완료 대기
9. 결과 에셋 URL 추출
10. --output 지정 시 다운로드

**출력:**
```json
{
  "ok": true,
  "command": "generate",
  "status": "complete",
  "model": "seedance-2",
  "explore": true,
  "creditsUsed": 0,
  "outputUrl": "https://...",
  "outputFile": "/absolute/path/to/cat-walking.mp4",
  "metadata": { "duration": "10s", "resolution": "1080p", "ratio": "16:9" },
  "poll": { "polls": 15, "waitedMs": 75000 }
}
```

→ MCP `generate_image` + `generate_video` + `get_task` 전체 대응
→ 크레딧 0 사용 (Explore 모드 우위)

---

## Phase 3: 파일 관리 (MCP `init_upload` + `complete_upload` 대응)

### `agbrowse runway upload` (신규)

```
agbrowse runway upload \
  --file ./my-video.mp4 \
  --json
```

브라우저의 file input을 통해 파일 업로드. MCP의 3단계(init→PUT→complete)를 1단계로.

**출력:**
```json
{
  "ok": true,
  "command": "upload",
  "filename": "my-video.mp4",
  "uploaded": true,
  "fileInputSelector": "input[type=\"file\"]"
}
```

→ MCP `init_upload` + `complete_upload` 대응 (더 간단)

---

## Phase 4: 고급 워크플로우 (MCP `generate_multishot_video` + `generate_product_marketing_video` 대응)

### `agbrowse runway multishot` (신규)

```
agbrowse runway multishot \
  --shots "wide shot of cafe" "barista looks up" "frozen coffee droplet" \
  --duration 15 \
  --ratio 16:9 \
  --first-scene-image ./cafe.png \
  --explore \
  --output ./cafe-story.mp4 \
  --json
```

또는 자동 모드:

```
agbrowse runway multishot \
  --story "a barista discovers their cafe has been frozen in time" \
  --duration 10 \
  --explore \
  --output ./frozen-cafe.mp4 \
  --json
```

→ MCP `generate_multishot_video` 대응

### `agbrowse runway product-ad` (신규)

```
agbrowse runway product-ad \
  --product-url "https://example.com/product/123" \
  --prompt "chameleon in a jewelry store, cinematic" \
  --duration 10 \
  --output ./product-ad.mp4 \
  --json
```

→ MCP `generate_product_marketing_video` 대응
→ 이건 compound workflow라서 내부적으로 setup → generate를 여러 번 호출

---

## Phase 5: 결과 관리

### `agbrowse runway download` (신규)

```
agbrowse runway download \
  --index 0 \
  --output ./result.mp4 \
  --json
```

현재 Custom/tools 서피스의 최근 생성물에서 지정 인덱스의 에셋을 다운로드.

### `agbrowse runway screenshot` (기존 agbrowse 기능 활용)

```
agbrowse runway screenshot --output ./runway-state.png
```

현재 Runway 탭 스크린샷. MCP에 없는 기능.

---

## 전체 명령 요약 (확장 후)

| 명령 | Safety Level | MCP 대응 | Phase |
|------|-------------|---------|-------|
| `selectors` | 0 (read-only) | — | 기존 |
| `status` | 0 (read-only) | whoami, list_workspaces | P1 강화 |
| `open` | 0 (navigation) | — | 기존 |
| `preflight` | 0 (navigation) | — | 기존 |
| `poll` | 0 (read-only) | get_task | 기존 |
| `recents` | 0 (read-only) | list_recent | P1 신규 |
| `upload` | 1 (mutation) | init_upload + complete_upload | P3 신규 |
| `setup` | 1 (mutation) | generate_* 파라미터 | P2 신규 |
| `generate` | 2 (submit) | generate_* 전체 | P2 신규 |
| `multishot` | 2 (submit) | generate_multishot_video | P4 신규 |
| `product-ad` | 2 (submit) | generate_product_marketing_video | P4 신규 |
| `download` | 0 (read-only) | — | P5 신규 |
| `screenshot` | 0 (read-only) | — | P5 신규 |

## 모델 지원 전략

MCP는 모델을 enum으로 하드코딩:
```
image: "nano-banana-pro" | "gpt-image-2" | "gen-4"
video: "seedance-2" | "kling-o3-pro" | "kling-3-pro" | "gen-4.5" | "veo-3.1" | "gen-4-turbo"
```

agbrowse는 **동적 모델 감지**:
```
--model auto       → 현재 UI에 선택된 모델 사용
--model seedance-2 → base-model-select에서 해당 모델 선택
--model "FLUX.2 Max" → MCP에 없는 모델도 접근 가능
```

모델 목록은 하드코딩하지 않음. UI에서 동적으로 읽어서 매칭.
이렇게 하면 Runway가 새 모델을 추가해도 agbrowse 코드 변경 없이 즉시 지원.
