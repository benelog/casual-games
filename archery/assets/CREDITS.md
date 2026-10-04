# 에셋 출처

모두 CC0 라 출처 표기 의무는 없지만 기록해 둔다.

| 경로 | 내용 | 출처 | 라이선스 |
| --- | --- | --- | --- |
| `hdri/orlando_stadium_1k.hdr` | 환경 조명 | [Poly Haven — orlando_stadium](https://polyhaven.com/a/orlando_stadium) | CC0 |
| `hdri/orlando_stadium_4k.jpg` | 경기장 배경 (같은 HDRI 의 톤매핑 JPG 를 4096×2048 로 줄임) | 〃 | CC0 |
| `textures/Grass005_*` | 잔디 (색·노멀·러프니스) | [ambientCG — Grass 005](https://ambientcg.com/view?id=Grass005) | CC0 |
| `models/Man.glb` | 사대의 빨간 선수, 시상대 금메달 | Quaternius — [Poly Pizza: Man](https://poly.pizza/m/HMnuH5geEG) | CC0 |
| `models/Man2.glb` | 사대의 파란 선수, 시상대 은메달 | Quaternius — [Poly Pizza: Man](https://poly.pizza/m/fjHyMd5Wxw) | CC0 |
| `models/ManLongSleeves.glb` | 시상대 동메달 | Quaternius — [Poly Pizza: Man in Long Sleeves](https://poly.pizza/m/DLptRuewTn) | CC0 |
| `sounds/draw.mp3` | 시위 당기기 (`creak2`) | [Kenney — RPG Audio](https://kenney.nl/assets/rpg-audio) | CC0 |
| `sounds/release.mp3`, `tick.mp3`, `set-win.mp3`, `turn.mp3` | 시위 놓기, 남은 시간 5초, 세트 승리, 차례 바뀜 (`pluck_001`, `tick_002`, `confirmation_002`, `bong_001`) | [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 |
| `sounds/hit.mp3`, `miss.mp3` | 과녁에 꽂힘, 빗나감 (`impactSoft_heavy_001`, `impactGeneric_light_000`) | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 |
| `sounds/win.mp3`, `lose.mp3` | 경기 승리·패배 (`jingles_STEEL02`, `jingles_SAX01`) | [Kenney — Music Jingles](https://kenney.nl/assets/music-jingles) | CC0 |
| `sounds/applause.mp3`, `ceremony-applause.mp3` | 10점일 때 짧은 박수, 시상식 박수 (원본의 1~5.5초, 22초~끝) | eXpl0it3r — [OpenGameArt: Applause in a large hall or church](https://opengameart.org/content/applause-in-a-large-hall-or-church) | CC0 |
| `sounds/fanfare.mp3` | 금메달 팡파르 | Zane Little Music — [OpenGameArt: Hyper-Ultra-Fanfare](https://opengameart.org/content/hyper-ultra-fanfare) | CC0 |

- 모델은 원본 GLB 를 그대로 쓰고, 선수 색에 맞춰 셔츠 색만 코드에서 바꾼다. 애니메이션(Idle·Clapping·Jump)도 원본에 들어 있다.
- 효과음은 원본(OGG·WAV)을 어느 브라우저에서나 재생되도록 MP3(모노 64kbps)로 변환하고 이름만 바꿨다. 박수는 잘라 내고 앞뒤를
  부드럽게 줄였다. `win`·`lose` 는 볼링(`bowling/assets/sounds/`)과 같은 파일이다. 화살이 날아가는 바람 소리는 파일 없이
  Web Audio 로 잡음을 걸러 만든다(`js/sound.js`).
- 과녁지·과녁 폼 블록·다리·바람 깃발·화살·활·시상대·메달·가림막은 맞는 오픈소스 모델을 찾지 못했거나 규격이 중요해
  코드에서 단순 도형과 캔버스로 만든다. 과녁지는 세계양궁 122cm 규격(고리 폭 6.1cm)대로 그린다.

렌더링은 [three.js](https://threejs.org/) (MIT) 를 사용한다.
