# 에셋 출처

모두 CC0 라 출처 표기 의무는 없지만 기록해 둔다.

| 경로 | 내용 | 출처 | 라이선스 |
| --- | --- | --- | --- |
| `models/tile*.glb` | 풀밭·경로·스폰·끝 타일, 나무·바위·수정·언덕 장식 타일 | [Kenney — Tower Defense Kit](https://kenney.nl/assets/tower-defense-kit) (2.1) | CC0 |
| `models/tower-*.glb` | 타워 블록(궁수탑·빙결탑은 둥근 탑, 대포와 기지는 네모 탑), 빙결탑 수정 꼭대기 | 〃 | CC0 |
| `models/weapon-*.glb` | 발리스타·대포, 화살·대포알 발사체 | 〃 | CC0 |
| `models/enemy-ufo-{a,b,c,d}.glb` | 적 (일반·빠른 적·중장갑·보스) | 〃 | CC0 |
| `models/detail-*.glb`, `spawn-round.glb`, `selection-a.glb` | 맵 둘레 나무·바위, 스폰 포털, 선택 표시 | 〃 | CC0 |
| `models/Textures/colormap.png` | 위 모델이 함께 쓰는 색상표 텍스처 | 〃 | CC0 |
| `sounds/arrow.mp3` | 궁수탑 발사 (`pluck_002`) | [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sounds/leak.mp3`, `upgrade.mp3`, `sell.mp3`, `wave-clear.mp3`, `win.mp3`, `lose.mp3` | 누수·업그레이드·판매·웨이브 클리어·승리·패배 (`error_004`, `confirmation_001`, `drop_002`, `confirmation_002`, `confirmation_004`, `error_006`) | 〃 | CC0 |
| `sounds/cannon.mp3`, `wave-start.mp3` | 대포 발사, 웨이브 시작 (`explosionCrunch_000`, `forceField_000`) | [Kenney — Sci-fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | CC0 |
| `sounds/frost.mp3`, `kill.mp3`, `build.mp3` | 빙결탑 발사, 처치, 건설 (`impactGlass_light_000`, `impactMetal_light_002`, `impactPlank_medium_000`) | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 |

- 모델은 원본 GLB 를 그대로 쓴다. 빙결탑 꼭대기는 `tower-round-crystals.glb` 의 수정을 코드에서 얼음색으로 바꿔 칠한다.
- 효과음은 원본 OGG 를 어느 브라우저에서나 재생되도록 MP3(모노 64kbps)로 변환하고 파일 이름만 바꿨다.
- 빙결탑 발사체, 사거리 원, 체력바, 폭발·명중 효과는 코드에서 단순 도형으로 만든다.

렌더링은 [three.js](https://threejs.org/) (MIT) 를 사용한다.
