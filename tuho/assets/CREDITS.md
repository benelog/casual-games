# 에셋 출처

모두 CC0 라 출처 표기 의무는 없지만 기록해 둔다.

| 경로 | 내용 | 출처 | 라이선스 |
| --- | --- | --- | --- |
| `hdri/chinese_garden_1k.hdr` | 환경 조명·배경 (정자와 연못이 있는 동양식 정원) | Andreas Mischok — [Poly Haven: Chinese Garden](https://polyhaven.com/a/chinese_garden) | CC0 |
| `textures/dirt_floor_*` | 흙 마당 (색·노멀) | eye-candy.xyz — [Poly Haven: Dirt Floor](https://polyhaven.com/a/dirt_floor) | CC0 |
| `textures/tatami_mat_*` | 항아리 밑에 깐 둥근 멍석 | [Poly Haven — tatami_mat](https://polyhaven.com/a/tatami_mat) | CC0 |
| `textures/okoume_veneer_diff.jpg` | 화살대와 던지는 줄 막대의 나뭇결 | [Poly Haven — okoume_veneer](https://polyhaven.com/a/okoume_veneer) | CC0 |
| `sounds/rim-1.mp3`, `rim-2.mp3`, `rim-hard.mp3` | 화살이 놋쇠 항아리에 부딪힐 때 (`impactMetal_medium_000`, `_003`, `impactMetal_heavy_001`) | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 |
| `sounds/clack-1.mp3`, `clack-2.mp3`, `land.mp3` | 화살이 땅·멍석에 떨어질 때 (`impactWood_light_000`, `_002`, `impactWood_medium_001`) | 〃 | CC0 |
| `sounds/release.mp3` | 화살을 놓을 때 (`impactSoft_medium_002`) | 〃 | CC0 |
| `sounds/score.mp3` | 들어감 (`confirmation_003`) | [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sounds/turn.mp3` | 차례 바뀜·연장 (`bong_001`) | 〃 | CC0 |
| `sounds/win.mp3`, `lose.mp3` | 승리·기록 경신, 패배 (`jingles_STEEL02`, `jingles_SAX01`) | [Kenney — Music Jingles](https://kenney.nl/assets/music-jingles) | CC0 |
| `sounds/cheer.mp3` | 귀에 넣었을 때·승리 박수 (`Well Done CCBY3.ogg`, 2024-10-05 에 CC0 로 바뀜) | qubodup — [OpenGameArt: Well Done](https://opengameart.org/content/well-done) | CC0 |

- HDRI 는 Poly Haven 의 1K 원본 그대로다. 흙 텍스처는 1K JPG 를 512×512 로 줄였다(러프니스 맵은 쓰지 않는다).
- 멍석·나뭇결 텍스처는 윷놀이(`yut/assets/textures/`)의 512×512 파일과 같다.
- 소리는 `rim-*`·`release`·`score`·`turn`·`win`·`lose`·`cheer` 가 농구 자유투(`basketball/assets/sounds/`),
  `clack-*`·`land` 가 윷놀이(`yut/assets/sounds/`)와 같은 파일이다. 화살이 공기를 가르는 휙 소리와 놋쇠 항아리가
  울리는 '댕' 소리는 파일 없이 Web Audio 로 만든다(`js/sound.js`).
- 투호 항아리(몸통·목·벌어진 입·양옆 귀)는 회전체라 `js/physics.js` 의 벽 중심선을 두께만큼 벌려 LatheGeometry 로
  돌려 만든다. 보이는 모양과 부딪히는 모양이 같다. 화살(원기둥 대·붉은 촉·깃 셋), 멍석·줄 막대·조준선도
  단순한 도형이라 코드로 만든다(`js/scene.js`).

렌더링은 [three.js](https://threejs.org/) (MIT) 를 사용한다. 물리는 직접 만든 것이다(`js/physics.js`).
