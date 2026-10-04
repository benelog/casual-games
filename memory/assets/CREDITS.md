# 에셋 출처

모두 CC0 라 출처 표기 의무는 없지만 기록해 둔다.

| 경로 | 내용 | 출처 | 라이선스 |
| --- | --- | --- | --- |
| `animals/*.png` | 카드 앞면의 동물 30종 (`PNG/Round`) | [Kenney — Animal Pack Redux](https://opengameart.org/content/animal-pack-redux) | CC0 |
| `cards/back.png` | 카드 뒷면 (`cardBack_red3`) | [Kenney — Boardgame Pack](https://kenney.nl/assets/boardgame-pack) | CC0 |
| `textures/velour_velvet_normal.jpg` | 펠트 (노멀) | [Poly Haven — velour_velvet](https://polyhaven.com/a/velour_velvet) | CC0 |
| `sounds/flip.mp3`, `hide.mp3`, `shuffle.mp3` | 카드 뒤집기, 다시 덮기, 섞기 (`card-place-2`, `card-slide-1`, `card-shuffle`) | [Kenney — Casino Audio](https://kenney.nl/assets/casino-audio) | CC0 |
| `sounds/match.mp3`, `turn.mp3` | 짝 맞춤, 차례 바뀜 (`confirmation_003`, `maximize_003`) | [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sounds/win.mp3` | 다 맞춤 (`jingles_STEEL02`) | [Kenney — Music Jingles](https://kenney.nl/assets/music-jingles) | CC0 |

- 동물 그림은 원본 그대로 두고, 코드에서 흰 카드 바탕(캔버스)에 얹어 앞면 텍스처를 만든다.
- 카드 뒷면은 모서리의 투명한 부분을 흰색으로 채우고 280×380 으로 키웠다.
- 펠트 노멀 맵은 포커(`poker/assets/textures/`)의 1K 파일을 512×512 로 줄였다.
- `flip`·`hide`·`shuffle` 은 원본(OGG)을 어느 브라우저에서나 재생되도록 MP3(모노 64kbps)로 변환하고 이름만 바꿨다.
  `match`·`turn` 은 다트(`darts/assets/sounds/`의 `great`·`turn`), `win` 은 파이프 연결(`pipes/assets/sounds/`)과 같은 파일이다.
- 카드(둥근 사각형)와 펠트 판은 단순한 도형이라 코드로 만든다. 조명 반사는 three.js 의 `RoomEnvironment` 로 만든다.

렌더링은 [three.js](https://threejs.org/) (MIT) 를 사용한다.
