# 에셋 출처

모두 CC0 라 출처 표기 의무는 없지만 기록해 둔다. 새로 받은 파일은 없고, 저장소의 다른 게임이 이미 쓰는 CC0 파일을 복사해 쓴다.

| 경로 | 내용 | 출처 | 라이선스 |
| --- | --- | --- | --- |
| `textures/okoume_veneer_*` | 판의 나무 틀 (색·노멀). 윗면에는 a~h·1~8 좌표를 그려 쓴다 | [Poly Haven — okoume_veneer](https://polyhaven.com/a/okoume_veneer) | CC0 |
| `sounds/place-1.mp3`, `place-2.mp3`, `place-3.mp3` | 돌을 판에 놓는 소리 (`impactWood_light_000`, `_002`, `_004`) | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 |
| `sounds/flip-1.mp3`, `flip-2.mp3`, `flip-3.mp3` | 돌이 뒤집혀 내려앉는 소리 (`chips-collide-1` ~ `3`) | [Kenney — Casino Audio](https://kenney.nl/assets/casino-audio) | CC0 |
| `sounds/pass.mp3`, `undo.mp3`, `turn.mp3` | 둘 곳이 없어 넘김, 무르기, 2인 대전에서 차례가 넘어갈 때 (`back_002`, `back_001`, `bong_001`) | [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sounds/win.mp3`, `lose.mp3` | 승리(무승부 포함)·패배 (`jingles_STEEL02`, `jingles_SAX01`) | [Kenney — Music Jingles](https://kenney.nl/assets/music-jingles) | CC0 |

- 텍스처는 알까기(`alkkagi/assets/textures/`)·윷놀이의 512×512 파일과 같다.
- 소리는 `place-*` 가 윷놀이(`yut/assets/sounds/`의 `clack-*`), `flip-*` 가 알까기(`alkkagi/assets/sounds/`의 `hit-*`),
  `pass` 가 윷놀이의 `backdo`, `undo` 가 소코반(`sokoban/assets/sounds/undo.mp3`), `turn`·`win`·`lose` 가 알까기와 같은 파일이다.

공용 에셋(`../../shared/assets/`)에서 가져다 쓰는 것:

| 경로 | 내용 |
| --- | --- |
| `hdri/warm_bar_1k.hdr` | 환경 조명 (돌의 윤기) |
| `textures/velour_velvet_*` | 판에 깐 초록 천 (노멀·러프니스) |
| `textures/dark_wood_*` | 판을 놓은 탁자 |

- 오델로 돌은 가장자리가 둥근 납작한 원판(위 흑, 아래 백 반쪽)이라 따로 모델을 쓰지 않고 회전체로 코드로 만든다.
  판(나무 틀·턱·천), 놓을 곳 점·커서·마지막 수 표시도 단순한 도형이라 코드로 만들고, 천의 8×8 줄과 틀의 좌표는 캔버스에 그린다(`js/scene.js`).

렌더링은 [three.js](https://threejs.org/) (MIT) 를 사용한다.
