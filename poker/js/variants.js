// 포커 종목 정의. 엔진(game.js)은 이 정의만 보고 진행한다.
// 화면에 보이는 이름과 설명은 i18n.js 의 'variant.<id>.name' / 'variant.<id>.summary' 에 있다.
//
// streets 의 각 항목은 한 번의 베팅 라운드이며, 라운드 전에 일어나는 일을 적는다.
//   hole:  각자에게 나눠 주는 카드. true 는 상대에게 공개되는 카드
//   board: 공용 카드 장수
//   draw:  카드 교환

import { evaluateBest, evaluateOmaha } from './hand.js';

const down = (n) => Array(n).fill(false);

export const VARIANTS = {
  holdem: {
    id: 'holdem',
    forced: 'blinds',
    streets: [{ hole: down(2) }, { board: 3 }, { board: 1 }, { board: 1 }],
    evaluate: (hole, board) => evaluateBest([...hole, ...board]),
  },
  omaha: {
    id: 'omaha',
    forced: 'blinds',
    potLimit: true,
    streets: [{ hole: down(4) }, { board: 3 }, { board: 1 }, { board: 1 }],
    evaluate: evaluateOmaha,
  },
  draw: {
    id: 'draw',
    forced: 'blinds',
    streets: [{ hole: down(5) }, { draw: true }],
    evaluate: (hole) => evaluateBest(hole),
  },
  stud: {
    id: 'stud',
    forced: 'ante',
    firstToAct: 'showing',
    streets: [{ hole: [false, false, true] }, { hole: [true] }, { hole: [true] }, { hole: [true] }, { hole: [false] }],
    evaluate: (hole) => evaluateBest(hole),
  },
};

for (const variant of Object.values(VARIANTS)) {
  // 핸드가 끝까지 갔을 때 각자 갖게 되는 카드 수
  variant.totalHole = variant.streets.reduce((n, street) => n + (street.hole?.length ?? 0), 0);
  variant.hasBoard = variant.streets.some((street) => street.board);
}
