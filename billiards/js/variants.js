// 종목 정의. 규칙(game.js)과 화면은 이 정의만 보고 진행한다.
// 화면에 보이는 이름과 설명은 i18n.js 의 'variant.<id>' · 'variant.<id>.detail' 에 있다.
//
// 공 번호: 캐롬은 0 흰 공(1P 수구) · 1 노란 공(2P 수구) · 2 빨간 공 · 3 두 번째 빨간 공(4구만).
//          포켓볼은 0 수구 · 1~15 번호 공 (1~7 단색, 8 검정, 9~15 줄무늬).

import { caromTable, poolTable } from './table.js';

export const VARIANTS = {
  fourball: {
    id: 'fourball',
    kind: 'carom',
    // 우리나라 당구장에 흔한 중대 (공 지름 65.5mm)
    table: caromTable({ length: 2.448, width: 1.224, ballRadius: 0.03275 }),
    balls: 4,
    targets: [10, 15, 20, 30],
    defaultTarget: 10,
    maxSpeed: 5.5,
  },
  threecushion: {
    id: 'threecushion',
    kind: 'carom',
    // 국제 규격 대대 (공 지름 61.5mm)
    table: caromTable({ length: 2.84, width: 1.42, ballRadius: 0.03075 }),
    balls: 3,
    targets: [5, 10, 15],
    defaultTarget: 10,
    maxSpeed: 6.5,
  },
  eightball: {
    id: 'eightball',
    kind: 'pool',
    // 9피트 포켓볼 대 (공 지름 57.15mm)
    table: poolTable({ length: 2.54, width: 1.27, ballRadius: 0.028575 }),
    balls: 16,
    targets: [1, 2, 3], // 먼저 이 판 수를 이기면 끝
    defaultTarget: 2,
    maxSpeed: 8,
  },
};

export const VARIANT_IDS = Object.keys(VARIANTS);

/** 컴퓨터 실력 */
export const LEVEL_IDS = ['easy', 'normal', 'hard'];
