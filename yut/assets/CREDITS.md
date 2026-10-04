# 에셋 출처

모두 CC0 라 출처 표기 의무는 없지만 기록해 둔다.

| 경로 | 내용 | 출처 | 라이선스 |
| --- | --- | --- | --- |
| `models/Horse.glb` | 말(윷말). 편 색으로 다시 칠해 쓴다 (서 있기·달리기·맞기 애니메이션 포함) | Quaternius — [Poly Pizza: Horse](https://poly.pizza/m/qvTrSG9pZF) | CC0 |
| `textures/tatami_mat_*` | 바닥에 깐 돗자리(멍석) | [Poly Haven — tatami_mat](https://polyhaven.com/a/tatami_mat) | CC0 |
| `textures/hessian_380_*` | 윷판을 그린 삼베 천 | [Poly Haven — hessian_380](https://polyhaven.com/a/hessian_380) | CC0 |
| `textures/okoume_veneer_*` | 윷가락의 평평한 면(배) | [Poly Haven — okoume_veneer](https://polyhaven.com/a/okoume_veneer) | CC0 |
| `sounds/clack-1.mp3`, `clack-2.mp3`, `clack-3.mp3`, `land.mp3` | 윷가락이 담요에 떨어져 튀는 소리 (`impactWood_light_000`, `_002`, `_004`, `impactWood_medium_001`) | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 |
| `sounds/step.mp3` | 말이 한 칸 뛸 때 (`footstep_wood_001`) | 〃 | CC0 |
| `sounds/capture.mp3` | 상대 말을 잡을 때 (`impactPunch_medium_000`) | 〃 | CC0 |
| `sounds/stack.mp3` | 내 말을 업을 때 (`chips-stack-1`) | [Kenney — Casino Audio](https://kenney.nl/assets/casino-audio) | CC0 |
| `sounds/home.mp3`, `bonus.mp3`, `turn.mp3`, `select.mp3`, `backdo.mp3` | 말이 남, 윷·모(한 번 더), 차례 바뀜, 결과 고르기, 빽도·버린 결과 (`confirmation_002`, `confirmation_003`, `bong_001`, `click_002`, `back_002`) | [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sounds/win.mp3`, `lose.mp3` | 승리·패배 (`jingles_STEEL02`, `jingles_SAX01`) | [Kenney — Music Jingles](https://kenney.nl/assets/music-jingles) | CC0 |

공용 에셋(`../../shared/assets/`)에서 가져다 쓰는 것:

| 경로 | 내용 |
| --- | --- |
| `hdri/warm_bar_1k.hdr` | 환경 조명 |
| `textures/dark_wood_*` | 윷가락의 둥근 면(등) |
| `textures/velour_velvet_*` | 윷을 던지는 담요 (노멀·러프니스) |

- 말 모델은 원본(1.1MB)에서 쓰는 애니메이션 3개(`Idle`, `Gallop`, `Idle_HitReact_Left`)만 남겨 크기를 줄였다.
  메시·재질은 그대로다.
- Poly Haven 텍스처는 1K JPG 를 512×512 로 줄였다. 러프니스 맵은 쓰지 않는다.
- 소리는 원본(OGG)을 어느 브라우저에서나 재생되도록 MP3(모노 64kbps)로 변환하고 이름만 바꿨다.
  `win`·`lose` 는 볼링(`bowling/assets/sounds/`)과 같은 파일이다. 윷가락이 공중에서 도는 휙 소리는 파일 없이
  Web Audio 로 잡음을 걸러 만든다(`js/sound.js`).
- 윷가락(반달 모양 막대)과 판·담요는 단순한 도형이라 코드로 만들고 위의 나무·천 텍스처를 입힌다.
  윷판의 줄과 자리, 빽도 가락의 ✕ 표시는 캔버스에 그린다.

렌더링은 [three.js](https://threejs.org/) (MIT) 를 사용한다.
