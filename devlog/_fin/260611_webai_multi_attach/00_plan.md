# web-ai 멀티/혼합 첨부 — 프롬프트 창에 여러 파일 업로드

작성일: 2026-06-11. 상태: 구현 + 라이브 검증 완료.

질문: "프롬프트 창에 첨부하는거 이미지나 zip을 여러개 올릴수 있냐고 서로다른 종류도"
→ **가능. ChatGPT 컴포저가 mixed-type multi-upload를 지원하고, 패치 완료.**

## 실측 (2026-06-11)

라이브 chatgpt.com 컴포저의 `input[type=file]` 3개:
- `accept:(none)`, `multiple:true`, hidden — **범용 첨부(모든 타입)**
- `accept:image/*`, `multiple:true` ×2 — 이미지 전용

→ zip + png + txt 3종을 `setInputFiles([...])` 한 번으로 범용 input에 넣으니
스크린샷에 `backend.zip (Zip Archive)` + 이미지 썸네일 + `notes.txt (Document)`
세 칩이 동시에 붙음. **혼합 멀티 업로드 확인.**

## 패치

- `chatgpt-attachments.mjs`: `attachLocalFilesLive(page, files[], options)` 신규.
  - 각 파일 preflight → 배치가 전부 이미지면 image input 허용, 하나라도
    비이미지면 범용 input 강제(기존 scorer가 image-only를 -∞ 처리하므로 자동).
  - `setInputFiles(files.map(f=>f.path))` 단일 호출 → 모든 칩 수락 대기(60s).
  - 단일 파일 배치는 기존 `attachLocalFileLive`로 위임(동작 불변).
- `chatgpt.mjs` send 경로: `input.filePaths[]` 우선(레거시 `filePath` 폴백) →
  `attachLocalFilesLive`로 일괄 업로드, sent-turn 증거 검증을 파일별 루프.
- `cli.mjs`: `--file`을 `multiple:true`로 변경(반복 가능) → `filePaths[]`
  정규화. preflight/attachmentPolicy/filePath 사용처 모두 배열 대응. help 갱신.

## 검증

- 신규 테스트 3 (혼합 멀티/단일 위임/빈 배치) + 기존 9, 전체 789/789, tsc 0,
  drift 140/counts 60 PASS.
- **라이브 e2e (실제 CLI)**: `agbrowse web-ai query --file backend.zip
  --file pixel.png --file notes.txt --prompt "파일명과 종류 알려줘"` →
  GPT가 "backend.zip — ZIP, pixel.png — PNG 이미지, notes.txt — TXT" 3종 모두
  인식. 혼합 타입 동시 첨부 동작 확인.

## 범위/한계

- 업로드 캡: 파일당 `--max-upload-file-size`(per-file preflight). 총합 캡은 미설정.
- context-package 업로드와 `--file` 병용은 기존대로 금지(상호배타).
- Gemini/Grok 멀티 첨부는 별도(컴포저 표면 상이) — 후속.
