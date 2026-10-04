# 에셋 출처

모두 CC0 라 출처 표기 의무는 없지만 기록해 둔다. 새로 받은 파일은 없고, 저장소의 다른 게임이 이미 쓰는 CC0 파일을 복사해 쓴다.

| 경로 | 내용 | 출처 | 라이선스 |
| --- | --- | --- | --- |
| `hdri/orlando_stadium_1k.hdr` | 환경 조명 (야외 햇빛, 공·물의 반사) | [Poly Haven — orlando_stadium](https://polyhaven.com/a/orlando_stadium) | CC0 |
| `textures/grass005_*_512.jpg` | 코스 바깥 잔디밭 (색·노멀·러프니스) | [ambientCG — Grass 005](https://ambientcg.com/view?id=Grass005) | CC0 |
| `sounds/putt.mp3` | 공을 치는 소리 (`impactWood_light_001`) | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 |
| `sounds/wall.mp3` | 벽·기둥에 맞는 소리 (`impactSoft_medium_000`) | 〃 | CC0 |
| `sounds/cup.mp3` | 컵에 들어가는 소리 (`impactPlank_medium_000`) | 〃 | CC0 |
| `sounds/thud.mp3` | 움직이는 블록·풍차 날개에 맞는 소리 (`impactWood_heavy_001`) | 〃 | CC0 |
| `sounds/lip.mp3` | 컵 가장자리에 걸려 튕겨 나가는 소리 (`impactMetal_medium_000`) | 〃 | CC0 |
| `sounds/birdie.mp3`, `turn.mp3` | 버디 이하, 여럿이 할 때 차례 바뀜 (`confirmation_003`, `bong_001`) | [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sounds/win.mp3`, `lose.mp3` | 라운드를 마쳤을 때 (`jingles_STEEL02`, `jingles_SAX01`) | [Kenney — Music Jingles](https://kenney.nl/assets/music-jingles) | CC0 |
| `sounds/cheer.mp3` | 홀인원·이글, 최고 기록일 때 박수 (`Well Done CCBY3.ogg`, 2024-10-05 에 CC0 로 바뀜) | qubodup — [OpenGameArt: Well Done](https://opengameart.org/content/well-done) | CC0 |

- HDRI 는 양궁(`archery/assets/hdri/`)과 같은 파일이다. 잔디 텍스처는 양궁(`archery/assets/textures/Grass005_*`)의 1K 파일을
  512×512 로 줄였다.
- 소리는 `putt`·`wall`·`cup` 이 당구(`billiards/assets/sounds/`의 `cue`·`cushion`·`pocket`), `thud` 가 컬링(`board`),
  `lip`·`birdie`·`cheer` 가 농구 자유투(`basketball/assets/sounds/`의 `rim-1`·`score`·`cheer`),
  `turn`·`win`·`lose` 가 알까기(`alkkagi/assets/sounds/`)와 같은 파일이고 이름만 용도에 맞게 바꿨다.
- 공이 굴러가는 소리(잔디·모래)와 물에 빠지는 소리는 파일 없이 Web Audio 로 잡음을 걸러 만든다(`js/sound.js`).

공용 에셋(`../../shared/assets/`)에서 가져다 쓰는 것:

| 경로 | 내용 |
| --- | --- |
| `textures/velour_velvet_nor_gl_1k.jpg` | 인조 잔디(퍼팅 카펫)의 결, 물결 |
| `textures/dark_wood_nor_gl_1k.jpg` | 흰 칠을 한 나무 벽의 결 |

- 코스(지형을 따라 올린 잔디 격자, 벽), 모래·물, 기둥, 움직이는 블록, 풍차(탑·지붕·날개), 컵, 깃발, 티 매트는 단순한 도형이라
  코드로 만든다(`js/scene.js`). 모래 무늬와 공의 점무늬는 캔버스에 그린다. 코스 규격이 물리와 정확히 맞아야 해서 모델은 쓰지 않는다.

렌더링은 [three.js](https://threejs.org/) (MIT) 를 사용한다. 물리는 직접 만든 것이다(`js/physics.js`).
