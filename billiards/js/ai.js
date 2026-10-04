// 컴퓨터 상대. 칠 수 있는 샷 후보(방향·세기·회전)를 만들어 물리 엔진으로 하나씩 쳐 보고,
// 규칙(rules.js)으로 결과를 매겨 가장 좋은 것을 고른 뒤, 실력만큼 손이 흔들려 조금씩 빗나가게 친다.
// 많은 샷을 쳐 보느라 시간이 걸리므로 think 는 제너레이터로 만들어 화면이 끊기지 않게 프레임마다 조금씩 돌린다.

import { simulate, DT } from './physics.js';
import { judgeFourBall, judgeThreeCushion, judgeEightBall, legalFirst, groupOf } from './rules.js';

const SEARCH_DT = 1 / 400; // 후보를 훑을 때는 간격을 넓혀 빨리 돌린다 (충돌 시각은 정확히 되돌려 처리한다)
const DEG = Math.PI / 180;

// aim: 방향 오차(도, 표준편차), speed: 세기 오차(비율), spin: 회전 오차, fractions: 공을 맞힐 두께를 몇 갈래로 볼지,
// banks: 쿠션 먼저 칠 방향 수, verify: 고른 후보를 몇 개까지 정밀하게 다시 쳐 볼지, trials: 손 떨림을 넣어 몇 번 쳐 볼지,
// pick: 상위 몇 개 중에서 고를지 (1 이면 가장 좋은 것), think: 생각하는 척 기다리는 최소 시간(초)
export const LEVELS = {
  easy: { aim: 1.5, speed: 0.12, spin: 0.25, fractions: 7, banks: 24, verify: 2, trials: 0, pick: 4, think: 0.9 },
  normal: { aim: 0.55, speed: 0.06, spin: 0.12, fractions: 13, banks: 72, verify: 4, trials: 0, pick: 1, think: 0.8 },
  hard: { aim: 0.18, speed: 0.025, spin: 0.05, fractions: 21, banks: 144, verify: 6, trials: 6, pick: 1, think: 0.6 },
};

export function gaussian(rng) {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 실력만큼 흔들린 실제 샷 */
export function perturb(shot, level, rng, maxSpeed = 8) {
  return {
    angle: shot.angle + gaussian(rng) * level.aim * DEG,
    speed: clamp(shot.speed * (1 + gaussian(rng) * level.speed), 0.2, maxSpeed),
    side: clamp(shot.side + gaussian(rng) * level.spin, -1, 1),
    vert: clamp(shot.vert + gaussian(rng) * level.spin, -1, 1),
  };
}

/** 공 target 을 cue 에서 두께 f(-1 ~ 1, 0 이면 정면)로 맞히는 방향 */
function cutAngle(cue, target, f, R) {
  const dx = target.x - cue.x;
  const dy = target.y - cue.y;
  const d = Math.hypot(dx, dy);
  const offset = clamp((f * 2 * R) / d, -0.999, 0.999);
  return Math.atan2(dy, dx) + Math.asin(offset);
}

/** 선분 a→b 를 지름 2R 짜리 공이 지나갈 때 막는 공이 없는지 (skip 에 든 공은 본다) */
function clearPath(balls, a, b, R, skip) {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const len2 = ex * ex + ey * ey || 1;
  for (const ball of balls) {
    if (!ball.on || skip.includes(ball.id)) continue;
    let k = ((ball.x - a.x) * ex + (ball.y - a.y) * ey) / len2;
    if (k <= 0 || k >= 1) continue;
    const d = Math.hypot(a.x + ex * k - ball.x, a.y + ey * k - ball.y);
    if (d < 2 * R) return false;
  }
  return true;
}

/** 포켓 안쪽의 노릴 점 */
function pocketAim(pocket) {
  return { x: pocket.x + pocket.ax * 0.02, y: pocket.y + pocket.ay * 0.02 };
}

/** 수구 cue 에서 공 target 을 포켓 pocket 에 넣는 똑바른 샷이 보이면 { angle, cut, dist } */
export function potLine(balls, cueId, targetId, pocket, R) {
  const cue = balls[cueId];
  const target = balls[targetId];
  const aim = pocketAim(pocket);
  const ux = aim.x - target.x;
  const uy = aim.y - target.y;
  const toPocket = Math.hypot(ux, uy);
  // 포켓 입구 바깥쪽 각도에서 들어가는 공은 턱에 걸린다
  if ((ux * pocket.ax + uy * pocket.ay) / toPocket < (pocket.corner ? 0.35 : 0.55)) return null;
  const ghost = { x: target.x - (ux / toPocket) * 2 * R, y: target.y - (uy / toPocket) * 2 * R };
  const gx = ghost.x - cue.x;
  const gy = ghost.y - cue.y;
  const toGhost = Math.hypot(gx, gy);
  if (toGhost < 1e-6) return null;
  const cos = (gx * ux + gy * uy) / (toGhost * toPocket);
  if (cos < Math.cos(75 * DEG)) return null; // 너무 얇다
  if (!clearPath(balls, cue, ghost, R, [cueId, targetId])) return null;
  if (!clearPath(balls, target, aim, R, [cueId, targetId])) return null;
  return { angle: Math.atan2(gy, gx), cut: Math.acos(clamp(cos, -1, 1)), dist: toGhost + toPocket };
}

// ---------- 평가 ----------

/** 캐롬 결과의 값. 득점이면 100 근처, 4구 파울은 크게 깎는다 */
function caromValue(variant, events, cue) {
  if (variant.id === 'fourball') {
    const j = judgeFourBall(events, cue);
    if (j.foul) return -60;
    return j.scored ? 100 : j.reds * 8;
  }
  const j = judgeThreeCushion(events, cue);
  if (j.scored) return 100;
  return j.objects * 6 + Math.min(j.cushions, 3) * 3;
}

/** 캐롬은 득점 여부가 정해지면 더 돌리지 않는다 */
function caromUntil(variant, cue) {
  const opponent = 1 - cue;
  return (sim) => {
    const e = sim.events[sim.events.length - 1];
    if (e.type !== 'hit' || (e.a !== cue && e.b !== cue)) return false;
    const touched = new Set();
    for (const ev of sim.events) {
      if (ev.type !== 'hit') continue;
      if (ev.a === cue) touched.add(ev.b);
      else if (ev.b === cue) touched.add(ev.a);
    }
    if (variant.id === 'fourball') return touched.has(opponent) || (touched.has(2) && touched.has(3));
    return touched.size >= 2;
  };
}

/** 포켓볼 결과의 값: 이기면 아주 크게, 파울은 크게 깎고, 계속 치면 다음 샷이 쉬울수록 더 준다 */
function poolValue(game, events, after, player) {
  const j = judgeEightBall(
    { player, groups: game.groups, isBreak: game.isBreak, onTable: game.onTable() },
    events,
  );
  if (j.winner === player) return 10000;
  if (j.winner !== null) return -10000;
  const R = game.table.ballRadius;
  if (j.foul) return j.foul === 'scratch' ? -400 : -300;
  const own = j.groups[player];
  const mine = after.filter((b) => b.on && b.id !== 0 && (own ? groupOf(b.id) === own : b.id !== 8));
  if (j.keepTurn) {
    // 다음에 넣을 수 있는 공이 많을수록 좋다
    const targets = mine.length ? mine : after.filter((b) => b.on && b.id === 8);
    let open = 0;
    for (const t of targets) {
      if (game.table.pockets.some((p) => potLine(after, 0, t.id, p, R))) open++;
    }
    return 200 + 20 * Math.min(open, 3) + 10 * j.pocketed.length;
  }
  // 차례를 넘길 때는 상대에게 쉬운 공을 덜 남길수록 좋다
  const theirs = own ? after.filter((b) => b.on && groupOf(b.id) === (own === 'solid' ? 'stripe' : 'solid')) : [];
  let easy = 0;
  for (const t of theirs) {
    if (game.table.pockets.some((p) => potLine(after, 0, t.id, p, R))) easy++;
  }
  const opponentPotted = own ? j.pocketed.filter((n) => groupOf(n) !== own).length : 0;
  return -8 * Math.min(easy, 4) - 15 * opponentPotted;
}

// ---------- 후보 ----------

function caromCandidates(game, level, balls = game.balls) {
  const { table, variant } = game;
  const R = table.ballRadius;
  const cue = balls[game.cue];
  const objects = variant.id === 'fourball' ? [2, 3] : [2, 1 - game.cue];
  const speeds = variant.id === 'fourball' ? [1.5, 2.3, 3.3] : [2.6, 3.6, 4.8];
  const spins = [
    { side: 0, vert: 0.3 },
    { side: 0.8, vert: 0.3 },
    { side: -0.8, vert: 0.3 },
    { side: 0, vert: -0.6 },
  ];
  const out = [];
  for (const id of objects) {
    const n = level.fractions;
    for (let i = 0; i < n; i++) {
      const f = -0.92 + (1.84 * i) / (n - 1);
      const angle = cutAngle(cue, balls[id], f, R);
      for (const speed of speeds) for (const spin of spins) out.push({ angle, speed, ...spin });
    }
  }
  // 쿠션 먼저 (3쿠션에서는 이쪽이 많다)
  const banks = variant.id === 'fourball' ? Math.round(level.banks / 2) : level.banks;
  for (let i = 0; i < banks; i++) {
    const angle = (i / banks) * Math.PI * 2;
    for (const speed of speeds.slice(1)) {
      for (const spin of variant.id === 'fourball' ? spins.slice(0, 1) : spins.slice(0, 3)) out.push({ angle, speed, ...spin });
    }
  }
  return out;
}

function poolCandidates(game, level, balls = game.balls) {
  const { table } = game;
  const R = table.ballRadius;
  const player = game.current;
  const group = game.groups[player];
  const onTable = balls.filter((b) => b.on && b.id !== 0).map((b) => b.id);
  const legal = onTable.filter((n) => legalFirst(n, { group, isBreak: false, onTable }));
  const out = [];
  const spins = [
    { side: 0, vert: 0 },
    { side: 0, vert: 0.5 },
    { side: 0, vert: -0.6 },
  ];
  for (const id of legal) {
    for (const pocket of table.pockets) {
      const line = potLine(balls, 0, id, pocket, R);
      if (!line) continue;
      const base = clamp(0.9 + line.dist * 0.75 + line.cut * 0.8, 1, 5.5);
      for (const speed of [base * 0.8, base, base * 1.45]) {
        for (const spin of spins) out.push({ angle: line.angle, speed, ...spin });
      }
    }
    // 넣을 길이 없으면 안전하게 맞히기만 하는 샷
    for (const f of [-0.5, 0, 0.5]) {
      for (const speed of [0.9, 1.6]) out.push({ angle: cutAngle(balls[0], balls[id], f, R), speed, side: 0, vert: 0 });
    }
  }
  if (!out.length || level.banks > 24) {
    // 맞힐 길이 막혔을 때를 위한 쿠션 먼저 치는 샷
    const banks = Math.min(level.banks, 48);
    for (let i = 0; i < banks; i++) out.push({ angle: (i / banks) * Math.PI * 2, speed: 2.4, side: 0, vert: 0 });
  }
  return out;
}

/** 볼 인 핸드일 때 수구를 놓을 자리 후보: 넣기 쉬운 공 뒤에 똑바로 */
function placements(game) {
  const { table } = game;
  const R = table.ballRadius;
  const player = game.current;
  const group = game.groups[player];
  const onTable = game.onTable();
  const legal = onTable.filter((n) => legalFirst(n, { group, isBreak: false, onTable }));
  const spots = [];
  for (const id of legal) {
    const t = game.balls[id];
    for (const pocket of table.pockets) {
      const aim = pocketAim(pocket);
      const ux = aim.x - t.x;
      const uy = aim.y - t.y;
      const d = Math.hypot(ux, uy);
      if ((ux * pocket.ax + uy * pocket.ay) / d < 0.55) continue;
      for (const back of [0.28, 0.45]) {
        const x = t.x - (ux / d) * (2 * R + back);
        const y = t.y - (uy / d) * (2 * R + back);
        if (!game.canPlace(x, y)) continue;
        spots.push({ x, y, score: d + back });
      }
    }
  }
  spots.sort((a, b) => a.score - b.score);
  return spots.slice(0, 4);
}

// ---------- 생각 ----------

/**
 * 컴퓨터의 수. yield 로 잠깐씩 멈추며, 끝나면 { shot, place } 를 돌려준다.
 * shot 은 손 떨림을 넣기 전의 겨냥이다(실제로 칠 때 perturb 로 흔든다). place 는 볼 인 핸드일 때 수구 자리.
 */
export function* think(game, level, rng = Math.random) {
  const { variant, table } = game;
  if (game.pool && game.isBreak) {
    // 브레이크: 헤드 스트링 뒤에서 꼭짓점 공을 세게
    const y = (rng() - 0.5) * 0.3;
    const place = game.nearestPlace(-table.length / 4 - 0.08, y);
    const apex = game.balls.filter((b) => b.on && b.id !== 0).reduce((a, b) => (b.x < a.x ? b : a));
    yield;
    return { place, shot: { angle: Math.atan2(apex.y - place.y, apex.x - place.x), speed: variant.maxSpeed * 0.95, side: 0, vert: 0.1 } };
  }

  const player = game.current;
  const cue = game.cue;
  let options = [{ place: null, balls: game.layout() }];
  if (game.pool && game.ballInHand) {
    options = placements(game).map((p) => {
      const balls = game.layout();
      Object.assign(balls[0], { x: p.x, y: p.y, on: true });
      return { place: { x: p.x, y: p.y }, balls };
    });
    if (!options.length) {
      const balls = game.layout();
      options = [{ place: { x: balls[0].x, y: balls[0].y }, balls }];
    }
  }

  const value = (balls, shot, dt) => {
    if (game.pool) {
      const r = simulate(table, balls, 0, shot, { dt });
      return poolValue(game, r.events, r.balls, player);
    }
    const r = simulate(table, balls, cue, shot, { dt, until: caromUntil(variant, cue) });
    return caromValue(variant, r.events, cue);
  };

  // 1. 훑기
  const scored = [];
  let count = 0;
  for (const option of options) {
    const candidates = game.pool ? poolCandidates(game, level, option.balls) : caromCandidates(game, level, option.balls);
    for (const shot of candidates) {
      scored.push({ option, shot, value: value(option.balls, shot, SEARCH_DT) });
      if (++count % 12 === 0) yield;
    }
  }
  scored.sort((a, b) => b.value - a.value);

  // 2. 정밀하게 다시 쳐 보기 (손 떨림을 넣어 여러 번 쳐 보면 쉬운 샷을 고르게 된다)
  const top = scored.slice(0, Math.max(level.verify, level.pick));
  for (const entry of top) {
    let total = value(entry.option.balls, entry.shot, DT);
    for (let i = 0; i < level.trials; i++) {
      total += value(entry.option.balls, perturb(entry.shot, level, rng, variant.maxSpeed), DT);
      yield;
    }
    entry.final = total / (1 + level.trials);
    yield;
  }
  top.sort((a, b) => b.final - a.final);
  const pool = top.slice(0, level.pick).filter((e) => e.final >= top[0].final - 60);
  const chosen = pool[Math.floor(rng() * pool.length)] ?? top[0];
  return { shot: chosen.shot, place: chosen.option.place, value: chosen.final };
}

/** think 를 끝까지 돌려 바로 답을 얻는다 (테스트용) */
export function choose(game, level, rng) {
  const thinking = think(game, level, rng);
  for (;;) {
    const { done, value } = thinking.next();
    if (done) return value;
  }
}
