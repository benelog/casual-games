# 에셋 출처

이 게임이 쓰는 파일(카드, 칩, 테이블 텍스처, 딜러 캐릭터, 환경 조명)은 모두 포커와 같아서
[`shared/assets/`](../../shared/assets/) 에 두고, 출처는 [`shared/assets/CREDITS.md`](../../shared/assets/CREDITS.md) 에 적었다.

반달 테이블, 카드, 칩, 카드 슈, 칩 트레이의 형상 자체는 단순한 도형이라 코드로 만들고 공용 텍스처를 입혔다.
펠트에 인쇄된 문구와 베팅 원도 코드에서 캔버스로 그린다.
렌더링은 [three.js](https://threejs.org/) (MIT) 를 사용한다.
