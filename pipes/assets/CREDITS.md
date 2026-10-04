# 에셋 출처

모두 CC0 라 출처 표기 의무는 없지만 기록해 둔다.

| 경로 | 내용 | 출처 | 라이선스 |
| --- | --- | --- | --- |
| `textures/Metal032_*` | 파이프·물탱크의 금속 (색·러프니스) | [ambientCG — Metal 032](https://ambientcg.com/view?id=Metal032) | CC0 |
| `textures/Concrete034_*` | 바닥 타일 (색·노멀) | [ambientCG — Concrete 034](https://ambientcg.com/view?id=Concrete034) | CC0 |
| `sounds/rotate.mp3` | 조각 회전 (`pluck_002`) | [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sounds/connect.mp3`, `shuffle.mp3` | 물길이 늘어날 때, 새 퍼즐·다시 섞기 (`drop_003`, `maximize_006`) | 〃 | CC0 |
| `sounds/win.mp3` | 완성 (`jingles_STEEL02`) | [Kenney — Music Jingles](https://kenney.nl/assets/music-jingles) | CC0 |

- 텍스처는 1K JPG 원본을 512×512 로 줄였다. 금속 색 텍스처에 코드에서 구리색(마른 관)·파란색(물이 찬 관)을 곱한다.
- `rotate.mp3` 는 3D 블록(`blocks3d/assets/sounds/`), `win.mp3` 는 볼링(`bowling/assets/sounds/`)과 같은 파일이다.
  `connect`·`shuffle` 은 원본(OGG)을 어느 브라우저에서나 재생되도록 MP3(모노 64kbps)로 변환하고 이름만 바꿨다.
  완성했을 때 물이 흐르는 소리는 파일 없이 Web Audio 로 잡음을 걸러 만든다(`js/sound.js`).
- 파이프 조각(관·꺾임·이음매 테)·물탱크·타일은 격자에 딱 맞아야 해서 코드에서 단순 도형(three.js 의 원통·도넛·구,
  `RoundedBoxGeometry`)으로 만든다. 조명 반사는 three.js 의 `RoomEnvironment` 로 만든다.

렌더링은 [three.js](https://threejs.org/) (MIT) 를 사용한다.
