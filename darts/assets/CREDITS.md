# 에셋 출처

모두 CC0 라 출처 표기 의무는 없지만 기록해 둔다.

| 경로 | 내용 | 출처 | 라이선스 |
| --- | --- | --- | --- |
| `models/dartboard/` | 다트보드 | [Poly Haven — dartboard](https://polyhaven.com/a/dartboard) | CC0 |
| `textures/wood_plank_wall_*` | 벽 | [Poly Haven — wood_plank_wall](https://polyhaven.com/a/wood_plank_wall) | CC0 |
| `sounds/throw.mp3` | 다트 던지기 (`cloth3`) | [Kenney — RPG Audio](https://kenney.nl/assets/rpg-audio) | CC0 |
| `sounds/hit.mp3`, `miss.mp3` | 보드에 꽂힘, 벽에 꽂힘 (`impactWood_light_000`, `impactPlank_medium_001`) | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 |
| `sounds/great.mp3`, `turn.mp3` | 불스아이·높은 점수, 차례 바뀜 (`confirmation_003`, `maximize_003`) | [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sounds/bust.mp3`, `win.mp3`, `lose.mp3` | 버스트·승리·패배 (`error_004`, `confirmation_004`, `error_006`) | 〃 | CC0 |

효과음은 원본 OGG 를 어느 브라우저에서나 재생되도록 MP3(모노 64kbps)로 변환하고 파일 이름만 바꿨다.
`bust`·`win`·`lose` 는 타워 디펜스(`defense/assets/sounds/`의 `leak`·`win`·`lose`)와 같은 파일이다.

다트는 쓸 만한 오픈소스 모델을 찾지 못해 코드에서 단순 도형으로 만든다.
렌더링은 [three.js](https://threejs.org/) (MIT) 를 사용한다.

환경 조명(`warm_bar_1k.hdr`)처럼 여러 게임이 같이 쓰는 파일은 [`shared/assets/CREDITS.md`](../../shared/assets/CREDITS.md) 에 있다.
