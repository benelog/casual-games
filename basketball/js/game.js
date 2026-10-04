// 농구 자유투 규칙: 모드·던지는 자리(단계)·점수·차례. 화면과 물리 없이 계산하는 순수 로직이다.
//
// - time: 혼자서 60초 동안 최대한 많이. 3개 넣을 때마다 다음 자리로 옮긴다
// - shots: 혼자서 공 12개. 자리마다 2개씩
// - versus: 둘이 번갈아 12개씩. 자리마다 2개씩, 점수가 높은 사람이 이긴다
//
// 점수 = 자리 점수 + 연속 성공 보너스(3연속부터 +1, 6연속부터 +2, 9연속부터 +3) + 클린슛(림·백보드에 안 닿음) +1

export const MODES = ['time', 'shots', 'versus'];
export const TIME_LIMIT = 60;
export const SHOTS_PER_STAGE = 2; // shots·versus: 자리마다 던지는 공 (한 사람당)
export const MAKES_PER_STAGE = 3; // time: 이만큼 넣으면 다음 자리로
export const STREAK_STEP = 3;
export const STREAK_MAX = 3;
export const CLEAN_BONUS = 1;

/**
 * 던지는 자리. distance: 림 중심에서의 거리(m), angle: 정면에서 오른쪽(+)으로 돈 각도.
 * 뒤로 갈수록 멀어진다.
 */
export const STAGES = [
  { id: 'freeThrow', distance: 4.22, angle: 0, points: 1 },
  { id: 'elbowLeft', distance: 4.88, angle: -0.526, points: 2 },
  { id: 'elbowRight', distance: 4.88, angle: 0.526, points: 2 },
  { id: 'top3', distance: 6.75, angle: 0, points: 3 },
  { id: 'wing3Left', distance: 6.75, angle: -0.45, points: 3 },
  { id: 'wing3Right', distance: 6.75, angle: 0.45, points: 3 },
];

export const TOTAL_SHOTS = STAGES.length * SHOTS_PER_STAGE;

/** 연속 성공 streak 번째 공의 보너스 */
export const streakBonus = (streak) => Math.min(STREAK_MAX, Math.floor(streak / STREAK_STEP));

export class ShootoutGame {
  /** first: versus 에서 먼저 던지는 사람 */
  constructor({ mode = 'time', first = 0 } = {}) {
    if (!MODES.includes(mode)) throw new Error(`unknown mode ${mode}`);
    this.mode = mode;
    this.players = mode === 'versus' ? 2 : 1;
    this.first = this.players > 1 ? first : 0;
    this.current = this.first;
    this.scores = Array(this.players).fill(0);
    this.makes = Array(this.players).fill(0);
    this.shots = Array(this.players).fill(0);
    this.streak = Array(this.players).fill(0);
    this.bestStreak = Array(this.players).fill(0);
    this.cleans = Array(this.players).fill(0);
    this.timeLeft = mode === 'time' ? TIME_LIMIT : Infinity;
    this.pending = 0; // 던져서 아직 결과가 안 난 공 수
    this.elapsed = 0;
  }

  /** player 가 지금 던지는 자리 번호 */
  stageIndex(player = this.current) {
    const index =
      this.mode === 'time' ? Math.floor(this.makes[player] / MAKES_PER_STAGE) : Math.floor(this.shots[player] / SHOTS_PER_STAGE);
    return Math.min(STAGES.length - 1, index);
  }

  get stage() {
    return STAGES[this.stageIndex()];
  }

  /** player 에게 남은 공 (time 모드는 Infinity) */
  shotsLeft(player = this.current) {
    return this.mode === 'time' ? Infinity : TOTAL_SHOTS - this.shots[player];
  }

  /** 지금 공을 던질 수 있는지 */
  get canShoot() {
    if (this.pending > 0) return false;
    return this.mode === 'time' ? this.timeLeft > 0 : this.shotsLeft() > 0;
  }

  /** 공을 던졌다 */
  release() {
    if (!this.canShoot) return false;
    this.pending++;
    return true;
  }

  /** 시간을 보낸다 (time 모드의 남은 시간). 시간이 다 되었으면 true */
  tick(dt) {
    this.elapsed += dt;
    if (this.mode !== 'time' || this.timeLeft <= 0) return false;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    return this.timeLeft === 0;
  }

  /**
   * 던진 공의 결과. made: 들어갔는지, clean: 림·백보드에 안 닿았는지.
   * 얻은 점수와 그 내역, 다음 자리로 옮겼는지를 돌려준다. 차례는 바꾸지 않는다 (nextTurn).
   */
  record({ made, clean = false, bank = false }) {
    const p = this.current;
    const before = this.stageIndex(p);
    const stage = STAGES[before];
    this.pending = Math.max(0, this.pending - 1);
    this.shots[p]++;
    let points = 0;
    let bonus = 0;
    let cleanBonus = 0;
    if (made) {
      this.makes[p]++;
      this.streak[p]++;
      this.bestStreak[p] = Math.max(this.bestStreak[p], this.streak[p]);
      bonus = streakBonus(this.streak[p]);
      if (clean) {
        cleanBonus = CLEAN_BONUS;
        this.cleans[p]++;
      }
      points = stage.points + bonus + cleanBonus;
      this.scores[p] += points;
    } else {
      this.streak[p] = 0;
    }
    const after = this.stageIndex(p);
    return {
      player: p,
      made,
      clean: made && clean,
      bank: made && bank,
      points,
      base: made ? stage.points : 0,
      bonus,
      cleanBonus,
      streak: this.streak[p],
      stageUp: after !== before && !this.isDone(p),
      stage: after,
    };
  }

  /** player 가 공을 다 던졌는지 */
  isDone(player) {
    return this.mode !== 'time' && this.shotsLeft(player) <= 0;
  }

  /** versus: 다음 사람 차례로. 바뀌었으면 true */
  nextTurn() {
    if (this.players < 2 || this.over) return false;
    const other = 1 - this.current;
    if (this.isDone(other)) return false;
    this.current = other;
    return true;
  }

  get over() {
    if (this.pending > 0) return false;
    if (this.mode === 'time') return this.timeLeft <= 0;
    return this.scores.every((_, p) => this.isDone(p));
  }

  /** versus 의 승자 (비기면 -1). 혼자 하면 0 */
  get winner() {
    if (this.players < 2) return 0;
    if (this.scores[0] === this.scores[1]) return -1;
    return this.scores[0] > this.scores[1] ? 0 : 1;
  }

  /** 혼자 할 때의 결과 (기록용) */
  get result() {
    return {
      score: this.scores[0],
      makes: this.makes[0],
      shots: this.shots[0],
      streak: this.bestStreak[0],
    };
  }
}
