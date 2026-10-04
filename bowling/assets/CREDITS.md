# 에셋 출처

모두 CC0 라 출처 표기 의무는 없지만 기록해 둔다.

| 경로 | 내용 | 출처 | 라이선스 |
| --- | --- | --- | --- |
| `models/SM_Bowling_Pin.fbx` | 볼링 핀 | SkywolfGameStudios — [CC0Tree](https://github.com/SkywolfGameStudios/CC0Tree) (`Assets/SM_Bowling_Pin.fbx`, [itch.io](https://skywolfgamestudios.itch.io/cc0tree)) | CC0 |
| `models/SM_Bowling_Ball.fbx` | 볼링공 | SkywolfGameStudios — [CC0Tree](https://github.com/SkywolfGameStudios/CC0Tree) (`Assets/SM_Bowling_Ball.fbx`) | CC0 |
| `textures/laminate_floor_*` | 레인·어프로치 판재 | [Poly Haven — laminate_floor](https://polyhaven.com/a/laminate_floor) | CC0 |
| `sounds/release.mp3` | 공을 놓을 때, 공이 핏에 떨어질 때 (`impactSoft_heavy_000`) | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 |
| `sounds/pin-heavy.mp3` | 공이 핀을 칠 때 (`impactWood_heavy_001`) | 〃 | CC0 |
| `sounds/pin-1.mp3`, `pin-2.mp3`, `pin-3.mp3` | 핀끼리 부딪칠 때 (`impactWood_medium_000`, `_002`, `_004`) | 〃 | CC0 |
| `sounds/pin-light.mp3` | 핀이 바닥·벽에 부딪칠 때 (`impactWood_light_001`) | 〃 | CC0 |
| `sounds/gutter.mp3` | 공이 거터에 빠질 때 (`impactPlate_heavy_000`) | 〃 | CC0 |
| `sounds/turn.mp3` | 차례가 넘어갈 때 (`bong_001`) | [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sounds/strike.mp3`, `spare.mp3`, `lose.mp3` | 스트라이크·스페어·패배 (`jingles_SAX02`, `jingles_SAX10`, `jingles_SAX01`) | [Kenney — Music Jingles](https://kenney.nl/assets/music-jingles) | CC0 |
| `sounds/win.mp3` | 승리·2인 대전 끝 (`jingles_STEEL02`) | 〃 | CC0 |

CC0Tree 의 FBX 는 그라디언트 텍스처 파일을 가리키지만 저장소에 그 파일이 없어, 핀의 빨간 띠와 공의
손가락 구멍은 코드에서 면 색으로 칠한다(`js/scene.js`). 모델 파일 자체는 원본 그대로다.
거터·칸막이·마스킹 패널·화살표 같은 레인 주변 구조물은 단순한 도형이라 코드로 만든다.
효과음은 Kenney 원본 OGG 를 ffmpeg 로 모노 MP3 로 바꾸고 이름만 용도에 맞게 바꿨다. 공이 레인을 구르는 소리는
파일 없이 Web Audio 로 갈색 잡음을 낮게 걸러 만들고, 공 속도에 맞춰 크기를 바꾼다(`js/sound.js`).
렌더링은 [three.js](https://threejs.org/) (MIT), 물리는 [cannon-es](https://github.com/pmndrs/cannon-es) (MIT) 를 사용한다.

환경 조명(`warm_bar_1k.hdr`)처럼 여러 게임이 같이 쓰는 파일은 [`shared/assets/CREDITS.md`](../../shared/assets/CREDITS.md) 에 있다.
