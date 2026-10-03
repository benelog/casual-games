# 에셋 출처

모두 CC0 또는 퍼블릭 도메인이라 출처 표기 의무는 없지만 기록해 둔다.
`poker/` 가 쓰는 파일을 그대로 복사해 왔다 (게임 디렉토리마다 독립적으로 동작하도록).

| 경로 | 내용 | 출처 | 라이선스 |
| --- | --- | --- | --- |
| `models/BusinessMan.glb` | 딜러 캐릭터 (애니메이션 포함) | Quaternius — [Poly Pizza: Business Man](https://poly.pizza/m/JFrLIKqvCH) | CC0 |
| `textures/velour_velvet_*` | 테이블 펠트 (노멀·러프니스) | [Poly Haven — velour_velvet](https://polyhaven.com/a/velour_velvet) | CC0 |
| `textures/brown_leather_*` | 테이블 레일 가죽 | [Poly Haven — brown_leather](https://polyhaven.com/a/brown_leather) | CC0 |
| `textures/dark_wood_*` | 테이블 목재, 카드 슈, 칩 트레이, 바닥 | [Poly Haven — dark_wood](https://polyhaven.com/a/dark_wood) | CC0 |
| `hdri/warm_bar_1k.hdr` | 환경 조명 | [Poly Haven — warm_bar](https://polyhaven.com/a/warm_bar) | CC0 |
| `cards/` | 카드 앞면·뒷면 무늬 | [hayeah/playing-cards-assets](https://github.com/hayeah/playing-cards-assets) (Byron Knoll 의 Vector Playing Cards 기반) | 퍼블릭 도메인 |
| `chips/` | 칩 윗면 | [Kenney — Boardgame Pack](https://kenney.nl/assets/boardgame-pack) | CC0 |

반달 테이블, 카드, 칩, 카드 슈, 칩 트레이의 형상 자체는 단순한 도형이라 코드로 만들고 위 텍스처를 입혔다.
펠트에 인쇄된 문구와 베팅 원도 코드에서 캔버스로 그린다.
렌더링은 [three.js](https://threejs.org/) (MIT) 를 사용한다.
