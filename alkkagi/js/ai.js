// 컴퓨터: 내 돌마다 상대 돌을 어느 쪽으로 밀어낼지 후보를 만들고(정면으로 맞히기, 가까운 가장자리 쪽으로 비껴 맞히기),
// 그 쪽으로 판 밖까지 밀어낼 만한 세기를 어림잡은 뒤, 같은 물리로 미리 튕겨 보고 결과가 가장 좋은 수를 고른다.
// 실제로 튕길 때는 실력에 따라 방향과 세기가 조금씩 빗나간다. 결과는 사람의 수와 같은 { angle, speed } 이다.

import {
  Board,
  STONE_RADIUS,
  DECEL,
  RESTITUTION,
  SPEED_MAX,
  STEP,
  HALF_X,
  HALF_Z,
  angleOf,
  edgeDistance,
  distanceToEdge,
  clamp,
} from './physics.js';
import { createRng } from '../../shared/util.js';

/**
 * 실력. angle·speed: 손 떨림 (방향 라디안, 속도 비율의 표준편차), top: 좋은 수 몇 개 중에서 고르는지,
 * cuts: 비껴 맞혀 가장자리 쪽으로 미는 수를 생각하는지, probes: 떨림에 덜 민감한 수를 고르려고 흔들어 보는 횟수
 */
export const LEVELS = {
  easy: { angle: 0.05, speed: 0.14, top: 4, cuts: false, probes: 0 },
  normal: { angle: 0.022, speed: 0.07, top: 2, cuts: true, probes: 1 },
  hard: { angle: 0.008, speed: 0.035, top: 1, cuts: true, probes: 2 },
};
export const LEVEL_IDS = Object.keys(LEVELS);

const SIM_STEP = STEP * 2; // 미리 튕겨 볼 때는 조금 거칠게 계산한다
const MAX_CUT = 1.2; // 이보다 크게 비껴 맞혀야 하는 방향(라디안)은 생각하지 않는다
const SAFE = 0.05; // 가장자리에서 이만큼 떨어져 있으면 안전하다고 본다 (m)
const WIN = 1000;

export function gaussian(rng) {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const unit = (x, z) => {
  const d = Math.hypot(x, z) || 1;
  return { x: x / d, z: z / d };
};

/** 돌 o 에서 가장 가까운 가장자리 쪽 단위 벡터 */
function nearestEdgeDir(o) {
  const dx = HALF_X - Math.abs(o.x);
  const dz = HALF_Z - Math.abs(o.z);
  return dx < dz ? { x: Math.sign(o.x) || 1, z: 0 } : { x: 0, z: Math.sign(o.z) || 1 };
}

/**
 * 한 수를 둔 뒤의 판이 me 에게 얼마나 좋은지. 떨어뜨린 상대 돌, 잃은 내 돌이 중심이고,
 * 내 돌은 가장자리에서 멀수록, 상대 돌은 가장자리에 가까울수록 조금 더 쳐 준다.
 */
export function evaluate(before, after, me) {
  const rival = 1 - me;
  const mine = after.filter((s) => s.inPlay !== false && s.team === me);
  const theirs = after.filter((s) => s.inPlay !== false && s.team === rival);
  if (mine.length === 0) return -WIN; // 양쪽이 다 떨어져도 튕긴 쪽이 진다
  if (theirs.length === 0) return WIN;
  const count = (list, team) => list.filter((s) => s.inPlay !== false && s.team === team).length;
  let value = (count(before, rival) - theirs.length) * 10 - (count(before, me) - mine.length) * 13;
  for (const s of mine) value += (clamp(edgeDistance(s), 0, SAFE) / SAFE) * 1.2;
  for (const s of theirs) value -= (clamp(edgeDistance(s), 0, SAFE) / SAFE) * 0.8;
  return value;
}

/** 판 위의 돌을 보고 생각해 볼 수 후보 [{ stoneId, targetId, shot: { angle, speed } }] */
export function candidates(stones, me, level = LEVELS.normal) {
  const live = stones.filter((s) => s.inPlay !== false);
  const list = [];
  const share = (1 + RESTITUTION) / 2;
  for (const s of live) {
    if (s.team !== me) continue;
    for (const o of live) {
      if (o.team === me) continue;
      const straight = unit(o.x - s.x, o.z - s.z);
      const pushes = [straight];
      if (level.cuts) {
        const edge = nearestEdgeDir(o);
        pushes.push(edge, unit(straight.x + edge.x, straight.z + edge.z));
      }
      for (const u of pushes) {
        // 돌 o 를 u 쪽으로 밀려면 맞는 순간 내 돌 중심이 o 에서 u 반대쪽으로 지름만큼 떨어진 자리에 있어야 한다
        const gx = o.x - u.x * 2 * STONE_RADIUS;
        const gz = o.z - u.z * 2 * STONE_RADIUS;
        const travel = Math.hypot(gx - s.x, gz - s.z);
        if (travel < 1e-4) continue;
        const t = unit(gx - s.x, gz - s.z);
        const cut = Math.acos(clamp(t.x * u.x + t.z * u.z, -1, 1));
        if (cut > MAX_CUT) continue;
        // 맞은 돌이 가장자리를 넘을 만큼의 속도 → 맞는 순간 내 돌의 속도 → 처음 속도
        const reach = distanceToEdge(o.x, o.z, angleOf(u.x, u.z)) + STONE_RADIUS;
        const hitSpeed = Math.sqrt(2 * DECEL * reach) / (share * Math.max(0.35, Math.cos(cut)));
        const start = Math.sqrt(hitSpeed * hitSpeed + 2 * DECEL * travel);
        const angle = angleOf(t.x, t.z);
        for (const k of [1.05, 1.3]) {
          const speed = clamp(start * k, 0.1, SPEED_MAX);
          list.push({ stoneId: s.id, targetId: o.id, shot: { angle, speed } });
        }
      }
    }
  }
  return list;
}

/** 판 위의 돌에 stoneId 를 shot 으로 튕겨 본 결과의 돌들 */
export function simulate(stones, stoneId, shot) {
  const board = new Board(stones.filter((s) => s.inPlay !== false));
  board.flick(stoneId, shot);
  board.run({ step: SIM_STEP });
  return board.stones;
}

/** shot 에 손 떨림을 더한다 */
export function jitter(shot, level, rng) {
  return {
    angle: shot.angle + gaussian(rng) * level.angle,
    speed: clamp(shot.speed * (1 + gaussian(rng) * level.speed), 0.05, SPEED_MAX),
  };
}

/**
 * 컴퓨터의 다음 수. { stoneId, shot: 실제로 튕길 값(떨림 포함), plan: 노린 값, targetId, value } 를 돌려준다.
 */
export function chooseShot(stones, team, levelId = 'normal', rng = Math.random) {
  const level = LEVELS[levelId];
  if (!level) throw new Error(`알 수 없는 실력: ${levelId}`);
  const live = stones.filter((s) => s.inPlay !== false);
  const probe = LEVELS.normal;
  const probeRng = createRng(live.length * 7919 + Math.round(live[0]?.x * 1e5 || 0)); // 같은 판이면 같은 판단
  const scored = candidates(live, team, level).map((c) => {
    let value = evaluate(live, simulate(live, c.stoneId, c.shot), team);
    for (let i = 0; i < level.probes; i++) {
      value += evaluate(live, simulate(live, c.stoneId, jitter(c.shot, probe, probeRng)), team);
    }
    return { ...c, value: value / (1 + level.probes) };
  });
  scored.sort((a, b) => b.value - a.value);
  // 이기는 수가 있으면 실력과 상관없이 그것을 노린다
  const best = scored[0];
  const pool = best && best.value >= WIN ? [best] : scored.slice(0, Math.max(1, level.top));
  let pick = pool[Math.floor(rng() * pool.length)];
  if (!pick) {
    // 후보가 없으면(이론상 없지만) 첫 돌을 가운데로 살짝 민다
    const s = live.find((x) => x.team === team);
    pick = { stoneId: s.id, targetId: null, shot: { angle: angleOf(-s.x, -s.z), speed: 0.3 }, value: 0 };
  }
  return { stoneId: pick.stoneId, targetId: pick.targetId, plan: pick.shot, shot: jitter(pick.shot, level, rng), value: pick.value };
}
