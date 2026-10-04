// 투호 규칙: 차례·던지는 줄(거리)·점수·연장. 화면과 물리 없이 계산하는 순수 로직이다.
//
// - 혼자서(players 1): 화살 10개로 최대한 많은 점수
// - 컴퓨터와 1:1, 여럿이(2~4명): 한 사람이 한 발씩 번갈아 화살 N개씩 던지고, 합계 점수가 높은 사람이 이긴다.
//   으뜸 점수가 같은 사람이 둘 이상이면 그 사람들만 연장으로 한 발씩 더 던진다. 한 바퀴를 돌고도 같으면 또 한다.
//
// 점수: 입(가운데) 2점, 귀 5점, 입이나 귀에 비스듬히 걸침(의간) 1점, 빗나감 0점.
// 화살을 던질수록 줄이 뒤로 물러난다 (가까운 줄 → 가운데 줄 → 먼 줄). 연장은 가운데 줄에서 던진다.

export const POINTS = { mouth: 2, ear: 5, lean: 1, miss: 0 };
export const RESULTS = Object.keys(POINTS);
export const SOLO_ARROWS = 10;
export const ARROW_OPTIONS = [5, 10]; // 대결에서 한 사람당 화살 수
export const PLAYER_COUNTS = [2, 3, 4];
export const MAX_EXTRA = 5; // 연장을 이만큼 돌고도 같으면 비긴다

/** 던지는 줄. distance: 항아리 가운데에서 줄까지 (m) */
export const LINES = [
  { id: 'near', distance: 2.5 },
  { id: 'middle', distance: 3 },
  { id: 'far', distance: 3.5 },
];
export const EXTRA_LINE = 1;

/** 화살 arrows 개 중 index 번째(0 부터)를 던지는 줄 번호 */
export const lineIndex = (index, arrows) => Math.min(LINES.length - 1, Math.floor((index * LINES.length) / arrows));

const emptyCounts = () => ({ mouth: 0, ear: 0, lean: 0, miss: 0 });

export class TuhoGame {
  /** players: 사람 수(1~4), arrows: 한 사람당 화살 수, first: 먼저 던지는 사람 */
  constructor({ players = 1, arrows = players > 1 ? 10 : SOLO_ARROWS, first = 0 } = {}) {
    if (!(players >= 1 && players <= 4)) throw new Error(`bad players ${players}`);
    this.players = players;
    this.arrows = arrows;
    this.first = players > 1 ? first % players : 0;
    this.scores = Array(players).fill(0);
    this.thrown = Array(players).fill(0); // 본 경기에서 던진 화살
    this.counts = Array.from({ length: players }, emptyCounts);
    this.history = Array.from({ length: players }, () => []); // 화살마다의 결과
    this.turn = 0; // 본 경기에서 지금까지 던진 화살 (모두 합쳐)
    this.extra = null; // 연장 중이면 { round, contenders, index, points[] }
    this.current = this.first;
    this.finished = false;
  }

  /** 본 경기에서 던지는 차례: first 부터 한 발씩 돌아간다 */
  orderAt(turn) {
    return (this.first + turn) % this.players;
  }

  get inExtra() {
    return !!this.extra;
  }

  /** 지금 던지는 사람의 줄 */
  get line() {
    if (this.extra) return LINES[EXTRA_LINE];
    return LINES[lineIndex(this.thrown[this.current], this.arrows)];
  }

  /** player 에게 남은 본 경기 화살 */
  arrowsLeft(player = this.current) {
    return this.arrows - this.thrown[player];
  }

  /** 들어간 화살 (입 + 귀) */
  hits(player) {
    const c = this.counts[player];
    return c.mouth + c.ear;
  }

  get over() {
    return this.finished;
  }

  /**
   * 던진 화살의 결과('mouth' | 'ear' | 'lean' | 'miss')를 적고 다음 차례로 넘긴다.
   * 얻은 점수, 다음 줄로 물러났는지, 연장이 시작되었는지 등을 돌려준다.
   */
  record(result) {
    if (this.finished) throw new Error('game over');
    if (!(result in POINTS)) throw new Error(`bad result ${result}`);
    const player = this.current;
    const points = POINTS[result];
    this.scores[player] += points;
    this.counts[player][result]++;
    this.history[player].push(result);
    const info = { player, result, points, extra: !!this.extra, extraStarted: false, lineUp: false, done: false };

    if (this.extra) {
      const ex = this.extra;
      ex.points[ex.index] += points;
      ex.index++;
      if (ex.index >= ex.contenders.length) this.closeExtraRound(info);
      else this.current = ex.contenders[ex.index];
      return info;
    }

    const before = lineIndex(this.thrown[player], this.arrows);
    this.thrown[player]++;
    this.turn++;
    if (this.turn >= this.players * this.arrows) {
      this.closeMain(info);
      return info;
    }
    this.current = this.orderAt(this.turn);
    // 다음에 이 사람이 던질 줄이 물러났는지 (한 바퀴 돌아 같은 사람에게 오기 전이라도 알려 준다)
    info.lineUp = this.thrown[player] < this.arrows && lineIndex(this.thrown[player], this.arrows) !== before;
    return info;
  }

  /** 본 경기가 끝났다: 으뜸이 여럿이면 연장, 아니면 끝 */
  closeMain(info) {
    const tied = this.leaders();
    if (this.players > 1 && tied.length > 1) {
      this.startExtra(tied, 1);
      info.extraStarted = true;
    } else {
      this.finished = true;
      info.done = true;
    }
  }

  startExtra(contenders, round) {
    // 연장도 본 경기의 차례 순서를 따른다
    const order = contenders.slice().sort((a, b) => ((a - this.first + this.players) % this.players) - ((b - this.first + this.players) % this.players));
    this.extra = { round, contenders: order, index: 0, points: order.map(() => 0) };
    this.current = order[0];
  }

  /** 연장 한 바퀴가 끝났다: 그 바퀴의 점수가 가장 높은 사람만 남긴다 */
  closeExtraRound(info) {
    const ex = this.extra;
    const best = Math.max(...ex.points);
    const still = ex.contenders.filter((_, i) => ex.points[i] === best);
    if (still.length === 1 || ex.round >= MAX_EXTRA) {
      this.finished = true;
      info.done = true;
      this.extra = { ...ex, index: ex.contenders.length };
      this.extraWinners = still;
      return;
    }
    this.startExtra(still, ex.round + 1);
    info.extraStarted = true;
  }

  /** 합계 점수가 가장 높은 사람들 */
  leaders() {
    const best = Math.max(...this.scores);
    return this.scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0);
  }

  /** 이긴 사람. 비기면 -1, 혼자 하면 0. 끝나기 전이면 null */
  get winner() {
    if (!this.finished) return null;
    if (this.players < 2) return 0;
    const leaders = this.extraWinners ?? this.leaders();
    return leaders.length === 1 ? leaders[0] : -1;
  }

  /** 순위대로 늘어선 사람 번호 (점수가 같으면 연장에서 이긴 사람이 앞) */
  get ranking() {
    const won = this.winner;
    return [...Array(this.players).keys()].sort((a, b) => {
      if (a === won) return -1;
      if (b === won) return 1;
      return this.scores[b] - this.scores[a] || a - b;
    });
  }

  /** 혼자 할 때의 결과 (기록용) */
  get result() {
    return { score: this.scores[0], hits: this.hits(0), ears: this.counts[0].ear };
  }
}
