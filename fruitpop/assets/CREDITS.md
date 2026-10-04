# 에셋 출처

모두 CC0 라 출처 표기 의무는 없지만 기록해 둔다.

| 경로 | 내용 | 출처 | 라이선스 |
| --- | --- | --- | --- |
| `models/apple.glb`, `lemon.glb`, `pear.glb`, `grapes.glb`, `donut-sprinkles.glb` | 터뜨리는 과일 다섯 가지 (다섯째는 도넛) | [Kenney — Food Kit](https://kenney.nl/assets/food-kit) (2.0) | CC0 |
| `models/coconut.glb` | 상대가 보내는 방해 블록(코코넛) | 〃 | CC0 |
| `models/Textures/colormap.png` | 위 모델이 함께 쓰는 색상표 텍스처 | 〃 | CC0 |
| `sounds/rotate.mp3` | 돌리기 (`pluck_002`) | [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sounds/move.mp3`, `pop.mp3`, `allclear.mp3` | 옮기기·터뜨리기·판 비우기 (`drop_002`, `confirmation_002`, `confirmation_004`) | 〃 | CC0 |
| `sounds/lock.mp3` | 짝이 굳을 때, 코코넛이 떨어질 때 (`impactPlank_medium_000`) | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 |
| `sounds/drop.mp3` | 바로 떨어뜨리기 (`impactMetal_light_002`) | 〃 | CC0 |
| `sounds/win.mp3`, `lose.mp3` | 승리·패배 (`jingles_STEEL02`, `jingles_SAX01`) | [Kenney — Music Jingles](https://kenney.nl/assets/music-jingles) | CC0 |

- 모델은 원본 GLB 를 그대로 쓰고, 크기와 기울기는 코드에서 칸에 맞춘다(`js/scene.js` 의 `MODELS`).
- 효과음은 3D 블록(`blocks3d/assets/sounds/`)과 볼링(`bowling/assets/sounds/`)에서 MP3 로 변환해 둔 Kenney 원본을
  이름만 바꿔 그대로 쓴다. 연쇄가 이어질수록 `pop.mp3` 를 높은 음으로 튼다.
- 판·받침·떨어질 자리 표시·터지는 효과는 격자에 딱 맞아야 하는 단순 도형이라 코드에서 만든다.
  조명 반사는 three.js 의 `RoomEnvironment` 로 만든다.

렌더링은 [three.js](https://threejs.org/) (MIT) 를 사용한다.
