# 에셋 출처

모두 CC0 라 출처 표기 의무는 없지만 기록해 둔다.

| 경로 | 내용 | 출처 | 라이선스 |
| --- | --- | --- | --- |
| `hdri/billiard_hall_1k.hdr` | 환경 조명과 배경 (당구장) | [Poly Haven — billiard_hall](https://polyhaven.com/a/billiard_hall) | CC0 |
| `textures/herringbone_parquet_*_512.jpg` | 바닥 (색·노멀) | [Poly Haven — herringbone_parquet](https://polyhaven.com/a/herringbone_parquet) | CC0 |
| `textures/ash_veneer_diff_512.jpg` | 큐 샤프트 나뭇결 | [Poly Haven — ash_veneer](https://polyhaven.com/a/ash_veneer) | CC0 |
| `sounds/clack-1.mp3` ~ `clack-4.mp3` | 공끼리 부딪치는 소리 (`chips-collide-1` ~ `4`) | [Kenney — Casino Audio](https://kenney.nl/assets/casino-audio) | CC0 |
| `sounds/cue.mp3` | 큐로 치는 소리 (`impactWood_light_001`) | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 |
| `sounds/cushion.mp3` | 쿠션에 닿는 소리 (`impactSoft_medium_000`) | 〃 | CC0 |
| `sounds/pocket.mp3` | 포켓에 떨어지는 소리 (`impactPlank_medium_000`) | 〃 | CC0 |
| `sounds/score.mp3`, `turn.mp3` | 득점, 차례 바뀜 (`confirmation_003`, `bong_001`) | [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sounds/foul.mp3`, `win.mp3`, `lose.mp3` | 파울, 승리, 패배 (`error_004`, `confirmation_004`, `error_006`) | 〃 | CC0 |

- 효과음은 Kenney 원본 OGG 를 ffmpeg 로 앞의 무음을 잘라 모노 MP3(64kbps)로 바꾸고 이름만 용도에 맞게 바꿨다.
  `score` 는 메모리 카드(`memory/assets/sounds/match.mp3`), `turn` 은 볼링(`bowling/assets/sounds/turn.mp3`),
  `foul`·`win`·`lose` 는 다트(`darts/assets/sounds/`의 `bust`·`win`·`lose`)와 같은 파일이다.
- 텍스처는 Poly Haven 의 1K JPG 를 512×512 로 줄였다.
- 펠트(`velour_velvet`), 레일 목재(`dark_wood`), 포켓 가죽(`brown_leather`)은 여러 게임이 같이 쓰는
  [`shared/assets/`](../../shared/assets/CREDITS.md) 의 Poly Haven 텍스처를 그대로 쓴다.
- 당구대·포켓볼 공·큐는 CC0 모델을 찾지 못했다(Poly Pizza 의 당구대·공 모델은 CC-BY 이고, 규격도 물리와 맞지 않는다).
  당구대는 물리(`js/table.js`)와 같은 규격으로 코드에서 만들고, 공은 구에 캔버스로 그린 무늬(번호·줄무늬·점)를 입히며,
  큐는 원기둥 토막에 위 나뭇결 텍스처를 입혀 만든다.

렌더링은 [three.js](https://threejs.org/) (MIT) 를 사용한다. 물리 엔진은 직접 만든 것이다(`js/physics.js`).
