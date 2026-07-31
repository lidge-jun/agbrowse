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
| `latest=0.1.17` | **당시 충족, 현재는 무효** | 현재 `latest`는 `0.1.18`이다. 0.1.18이 이후 릴리스이므로 정상이며, 0.1.17 시점에는 latest였다 |
| fresh registry install | **미확인** | 아래 참조 |

## 미이행

`fresh registry install using prefix-local binaries`를 이번에 재현하지 않았다.

판단: 이 항목은 릴리스 **당시** 검증했어야 하는 것이고, 3주가 지난 지금
재현해도 그때의 무결성을 증명하지 못한다. 게다가 0.1.18이 이미 `latest`라
0.1.17 설치는 현재 사용자 경로도 아니다.

따라서 "확인하지 못했다"로 남긴다 — 충족했다고 적지 않는다. 이 항목이
이 유닛의 종료를 막는지는 아래 판정에서 다룬다.

## 판정

**종료.** `_fin`으로 이관한다.

근거: 요구 조건 다섯 중 넷이 확인됐고, 나머지 하나는 시점이 지나 재현 불가다.
릴리스 자체는 실제로 게시됐고(GitHub·npm 양쪽), 후속 릴리스 0.1.18과 0.1.19가
그 위에 올라가 있다. 이 유닛을 `_plan`에 두는 것은 "릴리스가 아직 안 됐다"는
잘못된 신호를 준다.

미확인 항목은 위에 기록으로 남겼다.
