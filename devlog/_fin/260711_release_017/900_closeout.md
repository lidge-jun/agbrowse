# 900 — release 0.1.17 유닛 종료 감사 (2026-07-31)

`010_release_evidence.md:72-74`가 요구한 post-publish 증거를 확인한 기록이다.

## 요구 조건 대조

> npm publication still depends on GitHub Actions trusted publishing/OIDC.
> Post-publish evidence must include workflow success, `latest=0.1.17`, and a
> fresh registry install using prefix-local binaries.

| 요구 | 판정 | 근거 |
| --- | --- | --- |
| workflow success | **충족** | `gh run list --workflow=release.yml` — 2026-07-11 `success` |
| GitHub 릴리스 게시 | **충족** | `gh release view v0.1.17` — `2026-07-11T05:52:35Z`, `draft=false` |
| npm 레지스트리 게시 | **충족** | `npm view agbrowse@0.1.17 version` → `0.1.17` |
| `latest=0.1.17` | **당시 충족, 현재는 후속 릴리스로 이동** | 현재 `npm view agbrowse dist-tags.latest`는 `0.1.18`이다. 0.1.18이 이후 릴리스이므로 정상이며, 0.1.17 게시 시점에는 latest였다 |
| fresh registry install + bin smoke | **충족** | 아래 재현 |

## fresh install 재현 (2026-07-31)

`000_release_plan.md:117-126`이 명령까지 고정해 둔 acceptance criteria를 그대로
실행했다.

```
tmp=$(mktemp -d)
npm install --prefix "$tmp" agbrowse@0.1.17
node -p "require('$tmp/node_modules/agbrowse/package.json').version"
  → 0.1.17
"$tmp/node_modules/.bin/agbrowse" --help
  → 🌐 agbrowse — agent-first browser automation and web-ai CLI
"$tmp/node_modules/.bin/agbrowse-vision-click" --help
  → 👁️ agbrowse-vision-click — Vision-based coordinate click via Codex CLI
```

세 항목(설치 성공, 버전 일치, 두 bin smoke)이 모두 통과했다.

**이것은 릴리스 당시가 아니라 2026-07-31 현재 재현이다.** 레지스트리에 게시된
0.1.17 아티팩트가 지금도 설치·실행 가능함을 보이는 것이지, 게시 시점의 무결성을
소급 증명하지는 않는다.

임시 디렉터리는 `mktemp -d`로 만들었고 이 세션의 샌드박스 정책상 삭제가
차단되어 남아 있다: `/var/folders/2r/ysbqgzpd2b7g8ymwz91gnm7w0000gn/T/tmp.tcMdK464Xa`.
정리는 사용자 재량이다.

## 미이행

없음. 요구 조건 다섯이 모두 확인됐다.

## 판정

**종료.** `_fin`으로 이관한다.

초판에서는 fresh install을 "시점이 지나 재현 불가"로 면제하고 종료 판정했다.
그건 stop condition을 사후 면제한 것이라 틀렸다 — 계획이 명령까지 적어 둔
검증을 건너뛸 이유가 없었다. 실행해보니 3분도 안 걸렸다.
