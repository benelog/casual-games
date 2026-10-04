# 에셋 출처

모두 CC0 라 출처 표기 의무는 없지만 기록해 둔다.

| 경로 | 내용 | 출처 | 라이선스 |
| --- | --- | --- | --- |
| `models/sedan.glb` | 내 차 (빨간 세단). 바퀴가 따로 된 노드라 앞바퀴를 꺾고 굴린다 | [Kenney — Car Kit](https://kenney.nl/assets/car-kit) (3.1) | CC0 |
| `models/suv.glb`, `taxi.glb`, `van.glb`, `hatchback-sports.glb` | 주차된 차 | 〃 | CC0 |
| `models/cone.glb` | 라바콘 | 〃 | CC0 |
| `models/Textures/colormap.png` | 위 모델이 함께 쓰는 색상표 텍스처 | 〃 | CC0 |
| `textures/clean_asphalt_*_512.jpg` | 바깥 주차장·도로 바닥 (색·노멀) | [Poly Haven — Clean Asphalt](https://polyhaven.com/a/clean_asphalt) | CC0 |
| `textures/hangar_concrete_floor_diff_512.jpg` | 지하주차장 바닥 (색, 코드에서 밝게) | [Poly Haven — Hangar Concrete Floor](https://polyhaven.com/a/hangar_concrete_floor) | CC0 |
| `sounds/bump-1.mp3`, `bump-2.mp3` | 부딪힘 (`impactMetal_medium_000`, `_002`) | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 |
| `sounds/crash.mp3` | 세게 부딪힌 사고 (`impactPlate_heavy_001`) | 〃 | CC0 |
| `sounds/tap.mp3` | 살짝 닿음 (`impactGeneric_light_001`) | 〃 | CC0 |
| `sounds/gear.mp3`, `select.mp3`, `parked.mp3`, `win.mp3` | 기어 바꾸기·단계 고르기·주차 완료 (`switch_001`, `click_001`, `confirmation_001`, `confirmation_004`) | [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sounds/lose.mp3` | 실패 (`jingles_SAX01`) | [Kenney — Music Jingles](https://kenney.nl/assets/music-jingles) | CC0 |

- Car Kit 의 GLB 는 원본 그대로이고, 필요한 6개만 골랐다. 모델은 앞뒤·좌우 배율을 따로 줘서
  `js/physics.js` 의 `CAR`·`VEHICLES` 크기(예: 내 차 4.3×1.85m)에 맞춰 늘인다. 바퀴가 동그랗게 남도록 높이는 길이와 같은 배율이다.
  그래서 화면에 보이는 차체와 충돌 사각형이 같다. 빨간 세단은 내 차라 주차된 차로는 쓰지 않는다.
- 텍스처는 1K 원본을 512px 로 줄여 다시 압축했다.
- 효과음 `gear`·`select`·`parked`·`win` 은 3D 소코반(`sokoban/assets/sounds/`의 `restart`·`select`·`goal`·`win`),
  `lose` 는 알까기(`alkkagi/assets/sounds/`)와 같은 파일이다. 나머지는 Kenney Impact Sounds 의 OGG 를 ffmpeg 로 모노 MP3(64kbps)로 바꿨다.
- 엔진 소리(톱니파 두 개를 걸러 회전수에 따라 높이를 바꿈)와 주차 감지기 삐삐 소리는 파일 없이 Web Audio 로 만든다(`js/sound.js`).
- 주차선·연석·벽·건물·기둥(아래쪽 노랑·검정 빗금)·목표 칸 표시(P 글자와 방향 화살표)·칸 위의 표지·예상 궤적·생울타리는
  단순한 도형이라 코드로 만든다(`js/scene.js`). 단계(`js/levels.js`)는 이 게임을 위해 직접 만든 것이다.

렌더링은 [three.js](https://threejs.org/) (MIT) 를 사용한다. 차량 운동(자전거 모델)과 충돌(OBB)은 직접 만든 것이다(`js/physics.js`).
