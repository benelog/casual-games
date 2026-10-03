// 포커 종목 정의. 엔진(game.js)은 이 정의만 보고 진행한다.
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
    name: '텍사스 홀덤',
    summary: '내 카드 2장과 공용 카드 5장 중 가장 좋은 5장으로 겨룹니다. 노리밋.',
    forced: 'blinds',
    streets: [{ hole: down(2) }, { board: 3 }, { board: 1 }, { board: 1 }],
    evaluate: (hole, board) => evaluateBest([...hole, ...board]),
  },
  omaha: {
    id: 'omaha',
    name: '오마하',
    summary: '내 카드 4장 중 정확히 2장과 공용 카드 3장을 조합합니다. 팟 리밋.',
    forced: 'blinds',
    potLimit: true,
    streets: [{ hole: down(4) }, { board: 3 }, { board: 1 }, { board: 1 }],
    evaluate: evaluateOmaha,
  },
  draw: {
    id: 'draw',
    name: '파이브 카드 드로우',
    summary: '5장을 받고 한 번 원하는 만큼 카드를 바꾼 뒤 겨룹니다. 노리밋.',
    forced: 'blinds',
    streets: [{ hole: down(5) }, { draw: true }],
    evaluate: (hole) => evaluateBest(hole),
  },
  stud: {
    id: 'stud',
    name: '세븐 카드 스터드',
    summary: '7장 중 4장은 공개됩니다. 공개된 패가 높은 쪽이 먼저 베팅합니다. 앤티 방식.',
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
