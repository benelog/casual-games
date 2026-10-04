// 301 게임 규칙. 한 턴에 다트 3개를 던져 남은 점수를 정확히 0 으로 만들면 이긴다.
// 남은 점수보다 많이 맞히면 버스트: 그 턴의 점수는 무효가 되고 차례가 넘어간다.
// mode 'computer' 는 나 대 컴퓨터, 'versus' 는 한 기기에서 번갈아 던지는 2인 대전이다.

export const DARTS_PER_TURN = 3;
export const MODES = ['computer', 'versus'];

// 선수 이름은 화면 언어에 따라 바뀌므로 규칙에는 키(id)만 둔다
const LINEUPS = {
  computer: [
    { id: 'me', human: true },
    { id: 'computer', human: false },
  ],
  versus: [
    { id: 'p1', human: true },
    { id: 'p2', human: true },
  ],
};

export class DartsGame {
  constructor({ start = 301, mode = 'computer' } = {}) {
    if (!MODES.includes(mode)) throw new Error(`알 수 없는 모드: ${mode}`);
    this.mode = mode;
    this.players = LINEUPS[mode].map((p) => ({ ...p, remaining: start }));
    this.current = 0;
    this.darts = []; // 이번 턴에 던진 다트의 scoreAt 결과
    this.turnStart = start;
    this.winner = null;
  }

  get over() {
    return this.winner !== null;
  }

  get player() {
    return this.players[this.current];
  }

  get turnTotal() {
    return this.darts.reduce((sum, d) => sum + d.score, 0);
  }

  /** hit: board.js 의 scoreAt 결과 */
  throwDart(hit) {
    if (this.over) throw new Error('게임이 끝났습니다');
    if (this.darts.length >= DARTS_PER_TURN) throw new Error('차례를 넘겨야 합니다');
    const player = this.player;
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
    this.turnStart = this.player.remaining;
  }
}
