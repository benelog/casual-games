# 에셋 출처

모두 CC0 라 출처 표기 의무는 없지만 기록해 둔다.

| 경로 | 내용 | 출처 | 라이선스 |
| --- | --- | --- | --- |
| `models/hoop.glb` | 림·그물·공 (`ring`, `net`, `Sphere`) | Armory_3D — [Poly Pizza: Basket ball and hoop](https://poly.pizza/m/i3LLacyQP4) | CC0 |
| `hdri/school_hall_1k.hdr` | 환경 조명·흐린 배경 (체육관 분위기) | [Poly Haven — School Hall](https://polyhaven.com/a/school_hall) | CC0 |
| `textures/wood_floor_*` | 코트 마루 (색·노멀·러프니스) | [Poly Haven — Wood Floor](https://polyhaven.com/a/wood_floor) | CC0 |
| `sounds/bounce-1.mp3`, `bounce-2.mp3` | 공이 바닥에 튈 때 (`impactPunch_heavy_000`, `_002`) | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 |
| `sounds/rim-1.mp3`, `rim-2.mp3`, `rim-hard.mp3` | 림에 맞을 때 (`impactMetal_medium_000`, `_003`, `impactMetal_heavy_001`) | 〃 | CC0 |
| `sounds/board.mp3` | 백보드에 맞을 때 (`impactPlate_medium_001`) | 〃 | CC0 |
| `sounds/release.mp3` | 공을 던질 때 (`impactSoft_medium_002`) | 〃 | CC0 |
| `sounds/score.mp3` | 득점 (`confirmation_003`) | [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sounds/turn.mp3`, `tick.mp3` | 차례 바뀜, 남은 시간 5초 (`bong_001`, `tick_002`) | 〃 | CC0 |
| `sounds/win.mp3`, `lose.mp3` | 기록 경신·끝 (`jingles_STEEL02`, `jingles_SAX01`) | [Kenney — Music Jingles](https://kenney.nl/assets/music-jingles) | CC0 |
| `sounds/cheer.mp3` | 연속 성공·새 기록일 때 관중 박수 (`Well Done CCBY3.ogg`, 2024-10-05 에 CC0 로 바뀜) | qubodup — [OpenGameArt: Well Done](https://opengameart.org/content/well-done) | CC0 |

- 모델은 받은 그대로 두고 코드에서 다듬는다(`js/scene.js`): 림은 안쪽 반지름 22.86cm(규격)에 맞추고 쇠막대를 가늘게 줄이며,
  그물은 위쪽을 림 안쪽에 맞추고 길이를 40cm 로 늘여 흔들 때 정점을 옮긴다. 공은 지름 24cm 로 줄이고 법선을 구의 바깥 방향으로 바꿔
  매끈하게 보이게 한다.
- 마루 텍스처는 1K 원본의 색은 다시 압축하고, 노멀·러프니스는 512px 로 줄였다(러프니스는 흑백).
- `bounce`·`rim`·`board`·`release` 는 원본 OGG 를 ffmpeg 로 모노 MP3(64kbps) 로 바꾸고 이름만 바꿨다.
  `cheer`·`turn`·`win`·`lose` 는 컬링(`curling/assets/sounds/`), `score` 는 메모리 카드(`memory/assets/sounds/match.mp3`),
  `tick` 은 양궁(`archery/assets/sounds/`)과 같은 파일이다.
- 백보드·기둥·브래킷, 코트 선과 페인트 존(캔버스에 그린 텍스처)은 단순한 도형이라 코드로 만든다.
  그물을 스치는 소리와 경기 끝 버저는 파일 없이 Web Audio 로 만든다(`js/sound.js`).

렌더링은 [three.js](https://threejs.org/) (MIT) 를 사용한다.
