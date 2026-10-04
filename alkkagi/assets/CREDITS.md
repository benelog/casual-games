# 에셋 출처

모두 CC0 라 출처 표기 의무는 없지만 기록해 둔다. 새로 받은 파일은 없고, 저장소의 다른 게임이 이미 쓰는 CC0 파일을 복사해 쓴다.

| 경로 | 내용 | 출처 | 라이선스 |
| --- | --- | --- | --- |
| `textures/okoume_veneer_*` | 바둑판 나뭇결 (색·노멀). 윗면은 노란빛을 더하고 19줄·화점을 그려 쓴다 | [Poly Haven — okoume_veneer](https://polyhaven.com/a/okoume_veneer) | CC0 |
| `sounds/flick.mp3` | 돌을 튕기는 소리 (`impactWood_light_001`) | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 |
| `sounds/land.mp3` | 떨어진 돌이 마루에 닿는 소리 (`impactWood_medium_001`) | 〃 | CC0 |
| `sounds/hit-1.mp3`, `hit-2.mp3`, `hit-3.mp3` | 돌끼리 부딪치는 소리 (`chips-collide-1` ~ `3`) | [Kenney — Casino Audio](https://kenney.nl/assets/casino-audio) | CC0 |
| `sounds/turn.mp3` | 2인 대전에서 차례가 넘어갈 때 (`bong_001`) | [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sounds/win.mp3`, `lose.mp3` | 승리·패배 (`jingles_STEEL02`, `jingles_SAX01`) | [Kenney — Music Jingles](https://kenney.nl/assets/music-jingles) | CC0 |

- 텍스처는 윷놀이(`yut/assets/textures/`)의 512×512 파일과 같다.
- 소리는 `flick`·`hit-*` 가 당구(`billiards/assets/sounds/`의 `cue`·`clack-*`), `land`·`turn`·`win`·`lose` 가 윷놀이
  (`yut/assets/sounds/`)와 같은 파일이다. 돌이 판 위를 미끄러지는 사각 소리는 파일 없이 Web Audio 로 잡음을 걸러 만든다(`js/sound.js`).

공용 에셋(`../../shared/assets/`)에서 가져다 쓰는 것:

| 경로 | 내용 |
| --- | --- |
| `hdri/warm_bar_1k.hdr` | 환경 조명 (돌의 윤기) |
| `textures/dark_wood_*` | 바둑판을 놓은 마루 |

- 바둑돌은 위아래가 볼록한 납작한 타원체(구를 납작하게 줄인 것)라 따로 모델을 쓰지 않고 코드로 만든다.
  바둑판(다리 달린 두꺼운 판), 조준 화살표·조준선도 단순한 도형이라 코드로 만든다(`js/scene.js`).

렌더링은 [three.js](https://threejs.org/) (MIT) 를 사용한다. 물리는 직접 만든 것이다(`js/physics.js`).
