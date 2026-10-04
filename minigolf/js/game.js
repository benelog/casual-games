// 미니 골프 규칙: 홀마다 차례, 타수·벌타·최대 타수, 파 대비 점수. 화면과 상관없는 순수 로직이다.
//
// - 9홀을 차례로 돈다. 한 홀에서는 한 사람씩 홀아웃할 때까지 치고 다음 사람이 친다.
//   첫 홀은 1P 부터, 다음 홀부터는 앞 홀을 적은 타수로 마친 사람이 먼저 친다(오너). 같으면 앞 홀 순서를 따른다.
// - 물에 빠지면 1벌타를 더하고 친 자리로 돌아간다.
// - 한 홀에서 maxStrokes(파 + 4, 8타 넘지 않게) 를 채우고도 못 넣으면 그 타수로 홀을 마친다.

import { HOLES } from './course.js';

export const PLAYER_OPTIONS = [1, 2, 3, 4];
export const MAX_CAP = 8;

/** 홀의 최대 타수 */
export const maxStrokes = (par) => Math.min(par + 4, MAX_CAP);

/**
 * 타수의 이름 키 (i18n 의 `score.키`).
 * 1타는 파와 상관없이 홀인원, 그 밖에는 파 대비: -3 알바트로스, -2 이글, -1 버디, 0 파, +1 보기, +2 더블 보기, +3 트리플 보기
 */
export function scoreName(strokes, par) {
  if (strokes === 1) return 'ace';
  const diff = strokes - par;
  if (diff <= -3) return 'albatross';
  if (diff === -2) return 'eagle';
  if (diff === -1) return 'birdie';
  if (diff === 0) return 'par';
  if (diff === 1) return 'bogey';
  if (diff === 2) return 'double';
  if (diff === 3) return 'triple';
  return 'over';
}

/** 파 대비 표기: 0 → 'E', +2 → '+2', -1 → '-1' */
export const formatToPar = (diff) => (diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`);

/** 한 라운드. players 명이 holes 를 차례로 돈다 */
export class GolfRound {
  constructor({ players = 1, holes = HOLES } = {}) {
    if (!PLAYER_OPTIONS.includes(players)) throw new Error(`인원이 잘못됐습니다: ${players}`);
    this.holes = holes;
    this.players = players;
    this.scores = Array.from({ length: players }, () => Array(holes.length).fill(null));
    this.penalties = Array.from({ length: players }, () => Array(holes.length).fill(0));
    this.holeIndex = 0;
    this.order = [...Array(players).keys()];
    this.turn = 0; // order 안의 차례
    this.strokes = 0; // 지금 치는 사람의 이번 홀 타수 (벌타 포함)
    this.over = false;
  }

  get hole() {
    return this.holes[this.holeIndex];
  }

  get par() {
    return this.hole.par;
  }

  get max() {
    return maxStrokes(this.par);
  }

  get current() {
    return this.order[this.turn];
  }

  /** 한 번 친다. 최대 타수를 채운 뒤에는 칠 수 없다 */
  stroke() {
    if (this.over) throw new Error('라운드가 끝났습니다');
    if (this.strokes >= this.max) throw new Error('최대 타수를 채웠습니다');
    this.strokes++;
  }

  /**
   * 친 공이 멈춘(또는 들어간·빠진) 뒤 부른다. result 는 physics.js 의 Putt.result.
   * { done: 이 사람이 홀을 마쳤는지, holed, penalty: 벌타를 받았는지, picked: 최대 타수로 마쳤는지, strokes } 를 돌려준다.
   */
  shotResult(result) {
    const penalty = result === 'water';
    if (penalty) {
      this.strokes = Math.min(this.strokes + 1, this.max);
      this.penalties[this.current][this.holeIndex]++;
    }
    const holed = result === 'holed';
    const picked = !holed && this.strokes >= this.max;
    const done = holed || picked;
    const strokes = this.strokes;
    if (done) this.scores[this.current][this.holeIndex] = strokes;
    return { done, holed, penalty, picked, strokes };
  }

  /** 지금 사람이 홀을 마친 뒤 다음 사람으로. 모두 마쳤으면 { holeDone: true } */
  nextPlayer() {
    this.strokes = 0;
    if (this.turn + 1 < this.order.length) {
      this.turn++;
      return { holeDone: false };
    }
    return { holeDone: true };
  }

  /** 모두 홀을 마친 뒤 다음 홀로. 마지막 홀이었으면 라운드가 끝난다 */
  nextHole() {
    const prev = this.holeIndex;
    if (prev + 1 >= this.holes.length) {
      this.over = true;
      return { over: true };
    }
    // 오너: 앞 홀 타수가 적은 사람부터. 같으면 앞 홀 순서대로 (정렬은 안정적이다)
    this.order = [...this.order].sort((a, b) => this.scores[a][prev] - this.scores[b][prev]);
    this.holeIndex++;
    this.turn = 0;
    this.strokes = 0;
    return { over: false };
  }

  /** 한 사람의 지금까지 합계 */
  total(player) {
    return this.scores[player].reduce((sum, s) => sum + (s ?? 0), 0);
  }

  /** 한 사람의 마친 홀까지의 파 대비 */
  toPar(player) {
    return this.scores[player].reduce((sum, s, i) => sum + (s === null ? 0 : s - this.holes[i].par), 0);
  }

  /** 마친 홀 수 */
  played(player) {
    return this.scores[player].filter((s) => s !== null).length;
  }

  /** 합계가 가장 적은 사람들 (같으면 여럿) */
  leaders() {
    const totals = this.scores.map((_, p) => this.total(p));
    const best = Math.min(...totals);
    return totals.flatMap((t, p) => (t === best ? [p] : []));
  }

  /** 순위 (1부터, 같은 합계는 같은 순위) */
  ranks() {
    const totals = this.scores.map((_, p) => this.total(p));
    return totals.map((t) => 1 + totals.filter((o) => o < t).length);
  }
}
