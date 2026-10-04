# 에셋 출처

모두 CC0 라 출처 표기 의무는 없지만 기록해 둔다.

| 경로 | 내용 | 출처 | 라이선스 |
| --- | --- | --- | --- |
| `hdri/events_hall_interior_1k.hdr` | 환경 조명·흐린 배경 (실내 경기장 분위기) | [Poly Haven — Events Hall Interior](https://polyhaven.com/a/events_hall_interior) | CC0 |
| `textures/granite002a_*` | 스톤 화강암 (색·노멀·러프니스) | [ambientCG — Granite002A](https://ambientcg.com/view?id=Granite002A) | CC0 |
| `textures/snow014_*` | 얼음 표면의 페블 느낌 (노멀·러프니스만) | [ambientCG — Snow014](https://ambientcg.com/view?id=Snow014) | CC0 |
| `sounds/release.mp3` | 스톤을 놓을 때 (`impactSoft_heavy_000`) | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 |
| `sounds/hit-1.mp3`, `hit-2.mp3`, `hit-3.mp3` | 스톤끼리 부딪칠 때 (`impactMining_000`, `_002`, `_004`) | 〃 | CC0 |
| `sounds/board.mp3` | 스톤이 시트 밖으로 나가 보드에 부딪칠 때 (`impactWood_heavy_001`) | 〃 | CC0 |
| `sounds/turn.mp3` | 2인 대전에서 차례가 넘어갈 때 (`bong_001`) | [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sounds/win.mp3`, `lose.mp3` | 승리·패배 (`jingles_STEEL02`, `jingles_SAX01`) | [Kenney — Music Jingles](https://kenney.nl/assets/music-jingles) | CC0 |
| `sounds/cheer.mp3` | 점수를 냈을 때 관중 박수 (`Well Done CCBY3.ogg`, 2024-10-05 에 CC0 로 바뀜) | qubodup — [OpenGameArt: Well Done](https://opengameart.org/content/well-done) | CC0 |

텍스처는 1K 원본을 줄이거나(화강암 512px) 다시 압축했고, 러프니스는 흑백으로 바꿨다. 효과음은 원본 OGG 를
ffmpeg 로 모노 MP3 로 바꾸고 이름만 용도에 맞게 바꿨다.

CC0 컬링 스톤 모델을 찾지 못해(Poly Pizza·Sketchfab 의 것은 CC-BY 또는 비상업 라이선스) 스톤은 코드에서
옆모습을 돌려 만든 몸통(`LatheGeometry`)에 위의 화강암 텍스처를 입히고, 손잡이는 단순한 도형으로 만든다.
얼음 위의 하우스 원과 선, 시트 사이 범퍼, 스킵 브룸 표시, 스위핑 브러시도 단순한 도형이라 코드로 만든다
(`js/scene.js`). 스톤이 미끄러지는 소리와 스위핑 소리는 파일 없이 Web Audio 로 잡음을 걸러 만든다(`js/sound.js`).
렌더링은 [three.js](https://threejs.org/) (MIT) 를 사용한다.
