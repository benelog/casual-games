# 에셋 출처

모두 CC0 라 출처 표기 의무는 없지만 기록해 둔다.

| 경로 | 내용 | 출처 | 라이선스 |
| --- | --- | --- | --- |
| `sounds/rotate.mp3` | 회전 (`pluck_002`) | [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sounds/move.mp3`, `level.mp3`, `clear.mp3`, `perfect.mp3`, `over.mp3` | 이동·레벨 업·층 지우기·우물 비우기·게임 끝 (`drop_002`, `confirmation_001`, `confirmation_002`, `confirmation_004`, `error_006`) | 〃 | CC0 |
| `sounds/lock.mp3` | 조각이 굳을 때 (`impactPlank_medium_000`) | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 |
| `sounds/drop.mp3` | 바로 떨어뜨리기 (`impactMetal_light_002`) | 〃 | CC0 |

- 효과음은 타워 디펜스(`defense/assets/sounds/`)에서 MP3 로 변환해 둔 Kenney 원본을 이름만 바꿔 그대로 쓴다.
- 블록·우물·효과는 정육면체와 격자라 코드에서 단순 도형(three.js `RoundedBoxGeometry` 등)으로 만든다.
  조명 반사는 three.js 의 `RoomEnvironment` 로 만든다.

렌더링은 [three.js](https://threejs.org/) (MIT) 를 사용한다.
