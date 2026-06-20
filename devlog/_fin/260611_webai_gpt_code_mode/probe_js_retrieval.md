# JS-only zip 회수 재현 절차 (경로 B 실측 로그)

2026-06-11, cli-jaw 공유 브라우저(로그인된 chatgpt.com 탭)에서 검증.
모든 단계는 **브라우저 컨텍스트 안**에서 실행해야 함 (estuary URL이 쿠키 바운드).

## 1. 세션 토큰 + sandbox 경로 탐지

```js
// cli-jaw browser evaluate "<...>"
const s = await fetch('/api/auth/session').then(r=>r.json());        // accessToken
const conv = '<conversation_id>';
const c = await fetch('/backend-api/conversation/' + conv,
                      {headers:{Authorization:'Bearer '+s.accessToken}}).then(r=>r.json());
// mapping 순회로 execution_output 의 /mnt/data/*.zip 추출
```

실측: `hasToken:true`, user kugpt01@gmail.com, exp 2026-09-08.
sandbox 경로 `/mnt/data/example-todo-api.zip` 자동 추출됨 (message_id
`517d31b0-...`).

## 2. presigned URL 발급

```js
const u = '/backend-api/conversation/'+conv+'/interpreter/download'
        + '?message_id='+mid+'&sandbox_path='+encodeURIComponent('/mnt/data/example-todo-api.zip');
const d = await fetch(u, {headers:{Authorization:'Bearer '+s.accessToken}}).then(r=>r.json());
// d.download_url = https://chatgpt.com/backend-api/estuary/content?id=file_...&fn=...&sig=...
```

실측: status 200, estuary presigned URL 수신.

## 3. 회수 — 반드시 in-page (쿠키 필수)

```js
const r = await fetch(d.download_url, {credentials:'include'});
const bytes = new Uint8Array(await r.arrayBuffer());
let bin=''; for (let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]);
return JSON.stringify({status:r.status, size:bytes.length, b64:btoa(bin)});
// 호출측: base64 디코드 → 파일 저장
```

실측: 1,495B 수신 → 저장 → `unzip -t` 에러 0, 4파일 정상
(package.json/README/src/server.js).

## ⚠ 외부 fetch는 막힘 (설계 제약 근거)

동일 presigned URL을 외부 `curl`(쿠키 없음)로 받으면 **403 + JSON 에러**.
→ 회수의 마지막 단계는 브라우저 컨텍스트 고정이 필수.

## ⚠ 정책 차이

- `cli-jaw browser evaluate`: 허용 → 위 전 단계 동작.
- `agbrowse evaluate`: "evaluate denied by policy"로 차단 → code mode는
  전용 allow 플래그 필요 (Phase 12).
