# 에셋 출처

모두 CC0 라 출처 표기 의무는 없지만 기록해 둔다.

| 경로 | 내용 | 출처 | 라이선스 |
| --- | --- | --- | --- |
| `models/sedan-sports.glb` | 빨간 내 차 (스포츠 세단) | [Kenney — Car Kit](https://kenney.nl/assets/car-kit) (3.1) | CC0 |
| `models/taxi.glb`, `van.glb`, `police.glb`, `hatchback-sports.glb`, `suv.glb`, `suv-luxury.glb` | 길이 2 차: 택시·밴·경찰차·해치백·SUV 두 가지 | 〃 | CC0 |
| `models/delivery.glb`, `garbage-truck.glb`, `ambulance.glb` | 길이 3 차: 탑차·쓰레기차·구급차 | 〃 | CC0 |
| `models/cone.glb` | 출구 양옆의 고깔 | 〃 | CC0 |
| `textures/Concrete034_*` | 주차장 바닥 (색·노멀) | [ambientCG — Concrete 034](https://ambientcg.com/view?id=Concrete034) | CC0 |
| `sounds/move.mp3` | 차가 미끄러져 멈출 때 (`impactSoft_medium_002`) | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 |
| `sounds/bump.mp3` | 막힌 곳에 닿을 때 (`impactSoft_medium_000`) | 〃 | CC0 |
| `sounds/select.mp3`, `undo.mp3`, `restart.mp3`, `hint.mp3` | 차·단계 고르기, 되돌리기, 다시 시작, 힌트 (`click_001`, `back_001`, `switch_001`, `confirmation_001`) | [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sounds/win.mp3` | 클리어 (`jingles_STEEL02`) | [Kenney — Music Jingles](https://kenney.nl/assets/music-jingles) | CC0 |

- Car Kit 은 원본 GLB 가운데 쓰는 11개만 골라, [glTF Transform](https://gltf-transform.dev/) 으로 같은 바퀴 메시를 합치고(`dedup`·`weld`·`prune`)
  쓰지 않는 TANGENT 속성을 빼 가볍게 했다(11개 1.9MB → 0.8MB). 팩이 같이 쓰는 색상표 텍스처(`Textures/colormap.png`, 12KB)는
  모델마다 GLB 안에 넣었다. 모양·색은 원본 그대로이고, 칸에 맞추는 크기 조절(옆으로 조금 좁히고 키를 누름)은 코드에서 한다.
- 텍스처는 파이프 연결(`pipes/assets/textures/`)의 512×512 파일과 같다. 주차장 바닥은 밝게, 바깥 바닥은 어둡게 색을 곱해 쓴다.
- 소리는 `move` 가 농구 자유투(`basketball/assets/sounds/release.mp3`), `bump`·`select`·`undo`·`restart`·`hint` 가 3D 소코반
  (`sokoban/assets/sounds/`의 `blocked`·`select`·`undo`·`restart`·`goal`), `win` 이 파이프 연결과 같은 파일이다.
  클리어 때 내 차가 출구로 달려 나가는 엔진 소리는 파일 없이 Web Audio 로 톱니파를 걸러 만든다(`js/sound.js`).
- 주차선·둘레 벽·출구 길(화살표와 글자를 그린 캔버스 텍스처)·선택 표시·색종이는 단순 도형이라 코드로 만든다(`js/scene.js`).
  조명 반사는 three.js 의 `RoomEnvironment` 로 만든다.
- 단계(`js/levels.js`)는 `tools/generate.js` 가 무작위 배치와 풀이기로 만든 것이다. 다른 퍼즐 세트에서 가져온 것은 없다.

렌더링은 [three.js](https://threejs.org/) (MIT) 를 사용한다.
