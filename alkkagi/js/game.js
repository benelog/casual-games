// 알까기 규칙: 처음 돌 배치, 차례, 한 수가 끝난 뒤의 승패. 화면과 상관없는 순수 로직이다.
//
// - 흑(0)과 백(1)이 자기 돌을 같은 수만큼 판에 놓고 시작한다. 흑은 판 아래쪽(+z), 백은 위쪽(-z).
// - 차례마다 자기 돌 하나를 튕긴다. 판 밖으로 나간 돌은 자기 돌이든 상대 돌이든 빠진다.
// - 한 수가 끝나면(모든 돌이 멈추면) 차례가 상대에게 넘어간다.
// - 상대 돌을 모두 떨어뜨리면 이긴다. 내 돌이 모두 떨어지면 진다.
//   한 수에 양쪽 돌이 모두 떨어지면 튕긴 사람이 진다.

import { Board, makeStone, gridPoint } from './physics.js';

export const STONE_OPTIONS = [3, 5, 7];
export const TEAMS = [0, 1]; // 0 흑, 1 백

/** 돌 수마다 흑의 자리 [col, row] (바둑판 줄 번호, 천원이 0). 백은 위아래를 뒤집는다 */
const FORMATIONS = {
  3: [
    [-4, 6],
    [0, 6],
    [4, 6],
  ],
  5: [
    [-6, 6],
    [-3, 6],
    [0, 6],
    [3, 6],
    [6, 6],
  ],
  7: [
    [-6, 6],
    [-3, 6],
    [0, 6],
    [3, 6],
    [6, 6],
    [-3, 3],
    [3, 3],
  ],
};

/** 처음 배치한 돌들 (흑 먼저) */
export function initialStones(count) {
  const formation = FORMATIONS[count];
  if (!formation) throw new Error(`돌 수가 잘못됐습니다: ${count}`);
  const stones = [];
  for (const team of TEAMS) {
    for (const [col, row] of formation) {
      const p = gridPoint(team === 0 ? col : -col, team === 0 ? row : -row);
      stones.push(makeStone(team, p.x, p.z));
    }
  }
  return stones;
}

/** 한 판. mode: 'computer' (백이 컴퓨터) 또는 'versus' (2인) */
export class AlkkagiMatch {
  constructor({ stones = 5, mode = 'computer', starter = 0 } = {}) {
    this.stones = stones;
    this.mode = mode;
    this.starter = starter;
    this.current = starter;
    this.board = new Board(initialStones(stones));
    this.turns = 0; // 둔 수
    this.knocked = [0, 0]; // 편마다 떨어뜨린 상대 돌 수
    this.selfOut = [0, 0]; // 편마다 스스로 떨어진 돌 수
    this.over = false;
    this.winner = null;
    this.reason = null; // 'all' 상대 돌을 모두 떨어뜨림, 'self' 내 돌이 모두 떨어짐, 'both' 한 수에 양쪽이 모두 떨어짐
  }

  isHuman(team) {
    return this.mode === 'versus' || team === 0;
  }

  count(team) {
    return this.board.count(team);
  }

  /** team 이 지금 튕길 수 있는 돌인지 */
  canFlick(team, id) {
    const stone = this.board.byId(id);
    return !this.over && team === this.current && !!stone && stone.inPlay && stone.team === team;
  }

  /**
   * 한 수가 끝난 뒤(모든 돌이 멈춘 뒤) 부른다. outs 는 이번 수에 떨어진 돌들.
   * { knocked: 떨어뜨린 상대 돌 수, lost: 스스로 떨어진 돌 수, winner, over, next: 다음 차례 } 를 돌려준다.
   */
  finishShot(outs = []) {
    if (this.over) throw new Error('판이 끝났습니다');
    const team = this.current;
    const rival = 1 - team;
    const knocked = outs.filter((s) => s.team === rival).length;
    const lost = outs.filter((s) => s.team === team).length;
    this.knocked[team] += knocked;
    this.selfOut[team] += lost;
    this.turns++;
    const mine = this.count(team);
    const theirs = this.count(rival);
    if (theirs === 0 || mine === 0) {
      this.over = true;
      if (mine === 0 && theirs === 0) {
        this.winner = rival;
        this.reason = 'both';
      } else if (theirs === 0) {
        this.winner = team;
        this.reason = 'all';
      } else {
        this.winner = rival;
        this.reason = 'self';
      }
    } else {
      this.current = rival;
    }
    return { knocked, lost, winner: this.winner, over: this.over, next: this.current };
  }
}
