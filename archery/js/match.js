// 올림픽 개인전 세트제 경기 규칙.
// - 한 세트에 두 선수가 화살 3발씩 번갈아 쏜다. 합계가 높으면 세트 점수 2점, 같으면 1점씩.
// - 세트 점수 6점을 먼저 얻으면 이긴다. 5세트를 마치고 5:5 면 한 발씩 슛오프를 하고,
//   점수가 같으면 중심에 더 가까운 화살이 이긴다. 거리마저 같으면 슛오프를 다시 한다.
// - 다음 세트는 세트 점수가 낮은 선수가 먼저 쏜다. 같으면 1세트에 먼저 쏜 선수가 먼저 쏜다.
// mode 'computer' 는 나 대 컴퓨터, 'versus' 는 한 기기에서 번갈아 쏘는 2인 대전이다.

export const ARROWS_PER_SET = 3;
export const WIN_POINTS = 6;
export const MAX_SETS = 5;
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

const total = (arrows) => arrows.reduce((sum, hit) => sum + hit.score, 0);

export class ArcheryMatch {
  constructor({ mode = 'computer', first = 0 } = {}) {
    if (!MODES.includes(mode)) throw new Error(`알 수 없는 모드: ${mode}`);
    this.mode = mode;
    this.players = LINEUPS[mode].map((p) => ({ ...p }));
    this.points = [0, 0];
    this.matchFirst = first; // 1세트에 먼저 쏜 선수
    this.sets = []; // 끝난 세트: { arrows: [[], []], totals, points: [a, b] }
    this.shootOff = null; // 슛오프 중이면 { arrows: [[], []] }
    this.winner = null;
    this.pendingNext = false; // 세트가 끝나 nextSet() 을 기다리는 중
    this.startSet(first);
  }

  get over() {
    return this.winner !== null;
  }

  get player() {
    return this.players[this.current];
  }

  /** 1부터 세는 지금 세트 번호. 슛오프 중이면 MAX_SETS + 1 */
  get setNumber() {
    return this.sets.length + 1;
  }

  get inShootOff() {
    return this.shootOff !== null;
  }

  /** 지금 쏘고 있는 세트(또는 슛오프)의 화살 */
  get arrows() {
    return this.inShootOff ? this.shootOff.arrows : this.round.arrows;
  }

  get totals() {
    return this.arrows.map(total);
  }

  /** 한 사람이 이번 세트(슛오프)에 쏠 화살 수 */
  get arrowsPerPlayer() {
    return this.inShootOff ? 1 : ARROWS_PER_SET;
  }

  startSet(first) {
    this.round = { arrows: [[], []], first };
    this.current = first;
  }

  /**
   * 지금 차례인 선수의 화살 하나. hit 은 target.js 의 scoreAt 결과.
   * 반환: { player, hit, setOver, setWinner(0 | 1 | null 무승부), over, winner }
   */
  shoot(hit) {
    if (this.over) throw new Error('경기가 끝났습니다');
    if (this.pendingNext) throw new Error('다음 세트로 넘겨야 합니다');
    const player = this.current;
    const arrows = this.arrows;
    arrows[player].push(hit);
    const result = { player, hit, setOver: false, setWinner: null, over: false, winner: null };

    if (arrows[0].length < this.arrowsPerPlayer || arrows[1].length < this.arrowsPerPlayer) {
      this.current = 1 - player; // 번갈아 쏜다
      return result;
    }

    result.setOver = true;
    if (this.inShootOff) {
      result.setWinner = this.shootOffWinner();
      if (result.setWinner !== null) {
        this.points[result.setWinner] += 1;
        this.winner = result.setWinner;
      }
    } else {
      const totals = this.totals;
      const gained = totals[0] > totals[1] ? [2, 0] : totals[0] < totals[1] ? [0, 2] : [1, 1];
      result.setWinner = gained[0] > gained[1] ? 0 : gained[1] > gained[0] ? 1 : null;
      this.points = this.points.map((p, i) => p + gained[i]);
      this.sets.push({ arrows: this.round.arrows, totals, points: gained });
      const leader = this.points[0] >= WIN_POINTS ? 0 : this.points[1] >= WIN_POINTS ? 1 : null;
      if (leader !== null && this.points[0] !== this.points[1]) this.winner = leader;
    }
    result.over = this.over;
    result.winner = this.winner;
    this.pendingNext = !this.over;
    return result;
  }

  /** 슛오프: 점수 → 중심 거리 순으로 비교. 완전히 같으면 null */
  shootOffWinner() {
    const [a, b] = this.shootOff.arrows.map((arrows) => arrows[0]);
    if (a.score !== b.score) return a.score > b.score ? 0 : 1;
    if (a.distance !== b.distance) return a.distance < b.distance ? 0 : 1;
    return null;
  }

  /** 끝난 세트를 치우고 다음 세트(또는 슛오프)를 시작한다 */
  nextSet() {
    if (this.over) throw new Error('경기가 끝났습니다');
    if (!this.pendingNext) throw new Error('세트가 아직 끝나지 않았습니다');
    this.pendingNext = false;
    const [a, b] = this.points;
    if (this.sets.length >= MAX_SETS) {
      // 5:5 → 슛오프. 다시 쏠 때도 1세트에 먼저 쏜 선수부터
      this.shootOff = { arrows: [[], []] };
      this.current = this.matchFirst;
      return;
    }
    this.startSet(a === b ? this.matchFirst : a < b ? 0 : 1);
  }
}
