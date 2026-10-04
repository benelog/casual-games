// 당구 한 경기의 진행. 공 배치·점수·차례를 들고, 물리가 끝낸 샷의 결과를 규칙(rules.js)으로 판정한다.
// 화면·소리와 분리된 순수 로직이라 node 에서 그대로 테스트한다.
//
// 캐롬(4구·3쿠션): 1P 는 흰 공(0), 2P 는 노란 공(1)이 수구다. 득점하면 계속 치고, 못 하면 차례가 넘어간다.
//                  목표 점수에 먼저 닿으면 이긴다.
// 포켓볼(8볼): 수구는 0. 한 판(랙)을 이기면 1승, 목표 판 수를 먼저 이기면 경기가 끝난다. 판마다 브레이크를 번갈아 한다.

import { VARIANTS } from './variants.js';
import { judgeFourBall, judgeThreeCushion, judgeEightBall, groupOf } from './rules.js';
import { insideTable } from './table.js';
import { cloneBalls } from './physics.js';
import { createRng, shuffle } from '../../shared/util.js';

export { createRng };

const GAP = 0.0002; // 랙에서 공 사이에 두는 틈 (m)

/** 캐롬 첫 배치. shooter 가 먼저 치는 사람(0/1) */
export function caromLayout(variant, shooter = 0) {
  const { length: L, width: W } = variant.table;
  const balls = [];
  const put = (id, x, y) => (balls[id] = { id, x, y, on: true });
  const me = shooter;
  const other = 1 - shooter;
  if (variant.id === 'threecushion') {
    // 빨간 공은 풋 스폿, 상대 수구는 헤드 스폿, 내 수구는 헤드 스폿 옆 15.24cm
    put(2, L / 4, 0);
    put(other, -L / 4, 0);
    put(me, -L / 4, -0.1524);
  } else {
    // 빨간 공은 풋 스폿과 한가운데, 두 수구는 헤드 스트링 위 양쪽
    put(2, L / 4, 0);
    put(3, 0, 0);
    put(me, -L / 4, -W / 8);
    put(other, -L / 4, W / 4);
  }
  return balls;
}

/** 8볼 랙. 꼭짓점이 풋 스폿, 8번은 셋째 줄 가운데, 뒷줄 양 끝은 단색 하나·줄무늬 하나 */
export function poolRack(variant, rng = Math.random) {
  const { length: L } = variant.table;
  const R = variant.table.ballRadius;
  const solids = shuffle([1, 2, 3, 4, 5, 6, 7], rng);
  const stripes = shuffle([9, 10, 11, 12, 13, 14, 15], rng);
  // 뒷줄 양 끝: 단색 하나와 줄무늬 하나 (어느 쪽인지는 무작위)
  const cornerA = solids.pop();
  const cornerB = stripes.pop();
  const rest = shuffle([...solids, ...stripes], rng);
  const slots = [];
  for (let row = 0; row < 5; row++) for (let i = 0; i <= row; i++) slots.push([row, i]);
  const order = new Map();
  order.set('2,1', 8);
  const flip = rng() < 0.5;
  order.set('4,0', flip ? cornerB : cornerA);
  order.set('4,4', flip ? cornerA : cornerB);
  const balls = [{ id: 0, x: -L / 4 - 0.12, y: 0, on: true }];
  const dx = (2 * R + GAP) * Math.cos(Math.PI / 6);
  for (const [row, i] of slots) {
    const key = `${row},${i}`;
    const n = order.get(key) ?? rest.pop();
    // 아주 작게 흔들어 브레이크가 매번 조금씩 다르게 퍼지게 한다
    const jx = (rng() - 0.5) * GAP;
    const jy = (rng() - 0.5) * GAP;
    balls[n] = { id: n, x: L / 4 + row * dx + jx, y: (i - row / 2) * (2 * R + GAP) + jy, on: true };
  }
  return balls;
}

export class BilliardsGame {
  /**
   * variant: 'fourball' | 'threecushion' | 'eightball', target: 목표 점수(캐롬) 또는 이길 판 수(포켓볼),
   * first: 먼저 치는 사람
   */
  constructor({ variant = 'fourball', target, first = 0, rng = Math.random } = {}) {
    this.variant = VARIANTS[variant];
    if (!this.variant) throw new Error(`알 수 없는 종목: ${variant}`);
    this.table = this.variant.table;
    this.target = target ?? this.variant.defaultTarget;
    this.rng = rng;
    this.scores = [0, 0]; // 캐롬 점수, 포켓볼은 이긴 판 수
    this.runs = [0, 0]; // 지금 이어가는 연속 득점
    this.bestRuns = [0, 0]; // 경기 중 가장 긴 연속 득점 (하이런)
    this.innings = [0, 0]; // 차례를 받은 횟수
    this.over = false;
    this.winner = -1;
    this.shots = 0;
    this.breaker = first;
    this.startRack(first);
  }

  get pool() {
    return this.variant.kind === 'pool';
  }

  /** 새 판을 놓는다 (캐롬은 경기 시작 때 한 번) */
  startRack(shooter) {
    this.current = shooter;
    this.innings[shooter]++;
    if (this.pool) {
      this.balls = poolRack(this.variant, this.rng);
      this.groups = [null, null];
      this.isBreak = true;
      this.ballInHand = true; // 브레이크는 헤드 스트링 뒤에서 수구를 옮겨 칠 수 있다
    } else {
      this.balls = caromLayout(this.variant, shooter);
      this.ballInHand = false;
      this.isBreak = false;
    }
  }

  /** 지금 칠 사람의 수구 번호 */
  get cue() {
    return this.pool ? 0 : this.current;
  }

  /** 대 위에 있는 번호 공 */
  onTable() {
    return this.balls.filter((b) => b.on && b.id !== 0).map((b) => b.id);
  }

  /** 포켓볼에서 player 가 아직 넣어야 하는 공 (무리가 없으면 null) */
  remaining(player) {
    const group = this.groups?.[player];
    if (!group) return null;
    return this.onTable().filter((n) => groupOf(n) === group);
  }

  /** 포켓볼에서 player 가 8번을 노릴 차례인지 */
  onEight(player) {
    const left = this.remaining(player);
    return !!left && left.length === 0;
  }

  /** 수구를 (x, y) 에 놓을 수 있는가. 브레이크는 헤드 스트링 뒤(x ≤ -L/4)만 */
  canPlace(x, y) {
    const R = this.table.ballRadius;
    if (!insideTable(this.table, x, y)) return false;
    if (this.isBreak && x > -this.table.length / 4) return false;
    return this.balls.every((b) => b.id === this.cue || !b.on || Math.hypot(b.x - x, b.y - y) >= 2 * R + 0.0005);
  }

  /** 수구를 옮긴다. 놓을 수 없으면 false */
  placeCue(x, y) {
    if (!this.ballInHand || !this.canPlace(x, y)) return false;
    const cue = this.balls[this.cue];
    Object.assign(cue, { x, y, on: true });
    return true;
  }

  /** (x, y) 에서 가장 가까운, 수구를 놓을 수 있는 자리 */
  nearestPlace(x, y) {
    if (this.canPlace(x, y)) return { x, y };
    const R = this.table.ballRadius;
    for (let r = R; r < this.table.length; r += R / 2) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        if (this.canPlace(px, py)) return { x: px, y: py };
      }
    }
    return { x, y };
  }

  /** 공 배치 복사본 (물리에 넘긴다) */
  layout() {
    return cloneBalls(this.balls);
  }

  /**
   * 물리가 끝낸 샷 { events, balls } 를 반영한다.
   * 돌려주는 값: { scored, foul, reason, points, keepTurn, next, rackOver, rackWinner, over, winner, ... }
   */
  applyShot({ events, balls }) {
    if (this.over) throw new Error('경기가 끝났습니다');
    this.shots++;
    const player = this.current;
    const outcome = this.pool ? this.applyPool(events, balls) : this.applyCarom(events, balls);
    if (outcome.scored) {
      this.runs[player]++;
      this.bestRuns[player] = Math.max(this.bestRuns[player], this.runs[player]);
    }
    if (!this.over && !outcome.rackOver) {
      if (!outcome.keepTurn) this.passTurn();
    }
    outcome.player = player;
    outcome.next = this.current;
    outcome.over = this.over;
    outcome.winner = this.winner;
    return outcome;
  }

  passTurn() {
    this.runs[this.current] = 0;
    this.current = 1 - this.current;
    this.innings[this.current]++;
  }

  applyCarom(events, balls) {
    const player = this.current;
    this.balls = cloneBalls(balls);
    const fourball = this.variant.id === 'fourball';
    const judged = fourball ? judgeFourBall(events, player) : judgeThreeCushion(events, player);
    let points = 0;
    if (judged.scored) points = 1;
    else if (judged.foul) points = this.scores[player] > 0 ? -1 : 0;
    this.scores[player] += points;
    if (this.scores[player] >= this.target) {
      this.over = true;
      this.winner = player;
    }
    let reason = judged.scored ? 'score' : 'miss';
    if (judged.foul) reason = 'foulTouch';
    return { ...judged, reason, points, keepTurn: judged.scored, foul: judged.foul ? reason : null };
  }

  applyPool(events, balls) {
    const player = this.current;
    const judged = judgeEightBall(
      { player, groups: this.groups, isBreak: this.isBreak, onTable: this.onTable() },
      events,
    );
    this.balls = cloneBalls(balls);
    this.groups = judged.groups;
    if (judged.respotEight) this.respot(8);
    const wasBreak = this.isBreak;
    this.isBreak = false;
    const outcome = { ...judged, wasBreak, scored: judged.keepTurn, reason: judged.foul ?? (judged.keepTurn ? 'pot' : 'miss') };

    if (judged.winner !== null) {
      const w = judged.winner;
      this.scores[w]++;
      outcome.rackOver = true;
      outcome.rackWinner = w;
      outcome.reason = judged.lostOnEight ? 'lostEight' : 'winEight';
      if (this.scores[w] >= this.target) {
        this.over = true;
        this.winner = w;
      }
      return outcome;
    }

    this.ballInHand = !!judged.foul;
    if (judged.foul) {
      // 스크래치면 수구를 대 위로 돌려놓는다 (다음 사람이 옮겨 놓는다)
      const cue = this.balls[0];
      if (!cue.on) {
        const spot = this.nearestPlace(-this.table.length / 4, 0);
        Object.assign(cue, { ...spot, on: true });
      }
    }
    return outcome;
  }

  /** 다음 판을 놓는다 (포켓볼). 브레이크는 번갈아 한다 */
  nextRack() {
    this.breaker = 1 - this.breaker;
    this.runs = [0, 0];
    this.startRack(this.breaker);
  }

  /** 빠진 공을 풋 스폿에 (막혀 있으면 그 뒤쪽 빈자리에) 다시 놓는다 */
  respot(id) {
    const { length: L } = this.table;
    const R = this.table.ballRadius;
    const ball = this.balls[id];
    const free = (x, y) => this.balls.every((b) => b.id === id || !b.on || Math.hypot(b.x - x, b.y - y) >= 2 * R + 0.0005);
    let x = L / 4;
    while (x < L / 2 - R && !free(x, 0)) x += R / 4;
    if (!free(x, 0)) {
      x = L / 4;
      while (x > -L / 2 + R && !free(x, 0)) x -= R / 4;
    }
    Object.assign(ball, { x, y: 0, on: true });
  }
}
