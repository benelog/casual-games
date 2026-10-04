# 에셋 출처

모두 CC0 라 출처 표기 의무는 없지만 기록해 둔다. 새로 받은 파일은 없고, 저장소의 다른 게임이 이미 쓰는 CC0 파일을 복사해 쓴다.

| 경로 | 내용 | 출처 | 라이선스 |
| --- | --- | --- | --- |
| `textures/okoume_veneer_*` | 바둑판 나뭇결 (색·노멀). 윗면은 노란빛을 더하고 19줄·화점을 그려 쓴다 | [Poly Haven — okoume_veneer](https://polyhaven.com/a/okoume_veneer) | CC0 |
| `sounds/place-1.mp3`, `place-2.mp3`, `place-3.mp3` | 돌이 판에 놓이는 소리 (`impactWood_light_000`, `_002`, `_004`) | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 |
| `sounds/click.mp3` | 돌이 놓일 때 살짝 겹치는 딸깍 소리 (`chips-collide-1`) | [Kenney — Casino Audio](https://kenney.nl/assets/casino-audio) | CC0 |
| `sounds/select.mp3`, `undo.mp3`, `turn.mp3` | 키보드로 자리 옮기기, 무르기, 2인 대전에서 차례가 넘어갈 때 (`click_002`, `back_002`, `bong_001`) | [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sounds/win.mp3`, `lose.mp3` | 승리·패배 (`jingles_STEEL02`, `jingles_SAX01`) | [Kenney — Music Jingles](https://kenney.nl/assets/music-jingles) | CC0 |

- 텍스처는 알까기(`alkkagi/assets/textures/`)와 같은 파일이다.
- 소리는 `place-*` 가 윷놀이(`yut/assets/sounds/`의 `clack-*`), `select`·`undo` 가 윷놀이의 `select`·`backdo`,
  `click` 이 알까기의 `hit-1`, `turn`·`win`·`lose` 가 알까기(`alkkagi/assets/sounds/`)와 같은 파일이다.

공용 에셋(`../../shared/assets/`)에서 가져다 쓰는 것:

| 경로 | 내용 |
| --- | --- |
| `hdri/warm_bar_1k.hdr` | 환경 조명 (돌의 윤기) |
| `textures/dark_wood_*` | 바둑판을 놓은 마루 |

- 바둑돌은 위아래가 볼록한 납작한 타원체(구를 납작하게 줄인 것)라 따로 모델을 쓰지 않고 코드로 만든다.
  바둑판(다리 달린 두꺼운 판)과 미리보기·마지막 수·이긴 줄 표시도 단순한 도형이라 코드로 만든다(`js/scene.js`).

렌더링은 [three.js](https://threejs.org/) (MIT) 를 사용한다. 규칙과 컴퓨터는 직접 만든 것이다(`js/game.js`, `js/ai.js`).
