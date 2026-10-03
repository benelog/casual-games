// 301 게임 규칙. 한 턴에 다트 3개를 던져 남은 점수를 정확히 0 으로 만들면 이긴다.
// 남은 점수보다 많이 맞히면 버스트: 그 턴의 점수는 무효가 되고 차례가 넘어간다.

export const DARTS_PER_TURN = 3;

export class DartsGame {
  constructor({ start = 301 } = {}) {
    this.players = ['나', '컴퓨터'].map((name) => ({ name, remaining: start }));
    this.current = 0;
    this.darts = []; // 이번 턴에 던진 다트의 scoreAt 결과
    this.turnStart = start;
    this.winner = null;
  }

  get over() {
    return this.winner !== null;
  }

  /** hit: board.js 의 scoreAt 결과 */
  throwDart(hit) {
    if (this.over) throw new Error('게임이 끝났습니다');
    if (this.darts.length >= DARTS_PER_TURN) throw new Error('차례를 넘겨야 합니다');
    const player = this.players[this.current];
    this.darts.push(hit);

    const left = player.remaining - hit.score;
    const bust = left < 0;
    const win = left === 0;
    player.remaining = bust ? this.turnStart : left;
    if (win) this.winner = this.current;
    return { hit, bust, win, turnOver: bust || win || this.darts.length === DARTS_PER_TURN };
  }

  nextTurn() {
    if (this.over) throw new Error('게임이 끝났습니다');
    this.current = 1 - this.current;
    this.darts = [];
    this.turnStart = this.players[this.current].remaining;
  }
}
