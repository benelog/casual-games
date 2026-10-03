# 에셋 출처

모두 CC0 라 출처 표기 의무는 없지만 기록해 둔다.

| 경로 | 내용 | 출처 | 라이선스 |
| --- | --- | --- | --- |
| `models/SM_Bowling_Pin.fbx` | 볼링 핀 | SkywolfGameStudios — [CC0Tree](https://github.com/SkywolfGameStudios/CC0Tree) (`Assets/SM_Bowling_Pin.fbx`, [itch.io](https://skywolfgamestudios.itch.io/cc0tree)) | CC0 |
| `models/SM_Bowling_Ball.fbx` | 볼링공 | SkywolfGameStudios — [CC0Tree](https://github.com/SkywolfGameStudios/CC0Tree) (`Assets/SM_Bowling_Ball.fbx`) | CC0 |
| `textures/laminate_floor_*` | 레인·어프로치 판재 | [Poly Haven — laminate_floor](https://polyhaven.com/a/laminate_floor) | CC0 |
| `hdri/warm_bar_1k.hdr` | 환경 조명 | [Poly Haven — warm_bar](https://polyhaven.com/a/warm_bar) | CC0 |

CC0Tree 의 FBX 는 그라디언트 텍스처 파일을 가리키지만 저장소에 그 파일이 없어, 핀의 빨간 띠와 공의
손가락 구멍은 코드에서 면 색으로 칠한다(`js/scene.js`). 모델 파일 자체는 원본 그대로다.
거터·칸막이·마스킹 패널·화살표 같은 레인 주변 구조물은 단순한 도형이라 코드로 만든다.
렌더링은 [three.js](https://threejs.org/) (MIT), 물리는 [cannon-es](https://github.com/pmndrs/cannon-es) (MIT) 를 사용한다.
