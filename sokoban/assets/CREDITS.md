# 에셋 출처

모두 CC0 라 출처 표기 의무는 없지만 기록해 둔다.

| 경로 | 내용 | 출처 | 라이선스 |
| --- | --- | --- | --- |
| `models/mini-dungeon/floor.glb`, `wall.glb` | 창고 바닥 타일, 벽 | [Kenney — Mini Dungeon](https://kenney.nl/assets/mini-dungeon) (2.0) | CC0 |
| `models/mini-dungeon/character-human.glb` | 창고지기 (걷기·서 있기·끄덕이기 애니메이션 포함) | 〃 | CC0 |
| `models/mini-dungeon/Textures/colormap.png` | 위 모델이 함께 쓰는 색상표 텍스처 | 〃 | CC0 |
| `models/platformer-kit/crate.glb`, `crate-item.glb` | 상자, 목표에 놓인 상자(금빛) | [Kenney — Platformer Kit](https://kenney.nl/assets/platformer-kit) (4.1) | CC0 |
| `models/platformer-kit/Textures/colormap.png` | 위 모델이 함께 쓰는 색상표 텍스처 | 〃 | CC0 |
| `sounds/step.mp3`, `push.mp3`, `blocked.mp3` | 걸음·상자 밀기·막힘 (`footstep_concrete_000`, `impactWood_medium_000`, `impactSoft_medium_000`) | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds) (1.0) | CC0 |
| `sounds/goal.mp3`, `win.mp3`, `undo.mp3`, `restart.mp3`, `select.mp3` | 상자가 목표에 놓임·레벨 클리어·되돌리기·다시 시작·레벨 고르기 (`confirmation_001`, `confirmation_004`, `back_001`, `switch_001`, `click_001`) | [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds) (1.0) | CC0 |

- 모델은 원본 GLB 를 그대로 쓴다. 두 팩의 색상표 텍스처가 이름이 같아(`Textures/colormap.png`) 팩마다 디렉토리를 나눴다.
  크기는 코드에서 칸에 맞춰 조절한다(벽은 뒤 칸을 가리지 않게 높이를 낮추고, 속이 빈 벽 모델 안은 어두운 상자로 채운다).
- 효과음은 원본 OGG 를 어느 브라우저에서나 재생되도록 MP3(모노 64kbps)로 변환하고 파일 이름만 바꿨다.
- 목표 표시(바닥의 금색 네모)와 클리어 색종이는 맞는 에셋이 없는 단순 도형이라 코드에서 만든다.
- 레벨(`js/levels.js`)은 이 게임을 위해 직접 만든 것이다. 다른 레벨 세트에서 가져온 것은 없다.

렌더링은 [three.js](https://threejs.org/) (MIT) 를 사용한다.
