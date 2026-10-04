// 컴퓨터 팀: 놓인 스톤을 보고 드로·가드·테이크아웃 후보를 만든 뒤, 같은 물리로 미리 던져 보고
// 결과가 가장 좋은 수를 고른다. 실제로 던질 때는 실력에 따라 각도와 세기가 조금씩 빗나간다.
// 결과는 사람의 투구와 같은 { angle, speed, spin } 이다.

import {
  Sheet,
  HOUSE_RADIUS,
  HOG_Z,
  STONE_RADIUS,
  ANGLE_LIMIT,
  SPEED_MAX,
  inHouse,
  distanceToButton,
  solveDraw,
  solveHit,
  broomX,
  clamp,
} from './physics.js';
import { scoreEnd } from './game.js';
import { createRng } from '../../shared/util.js';

/**
 * 실력. angle·speed: 손 떨림 (각도 라디안, 속도 비율의 표준편차), top: 좋은 수 몇 개 중에서 고르는지,
 * hits: 테이크아웃을 생각하는지
 */
export const LEVELS = {
  easy: { angle: 0.0055, speed: 0.024, top: 3, hits: false },
  normal: { angle: 0.0032, speed: 0.013, top: 2, hits: true },
  hard: { angle: 0.0017, speed: 0.007, top: 1, hits: true },
};
export const LEVEL_IDS = Object.keys(LEVELS);

export const TAKEOUT_SPEED = 3.0;
const TAP_SPEED = 2.45;
const SPINS = [1, -1];

export function gaussian(rng) {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 하우스 앞(호그 라인과 하우스 사이)에 있어 길을 막는 스톤인지 */
const isGuard = (s) => s.z > HOUSE_RADIUS && s.z < HOG_Z && Math.abs(s.x) < 1.6;

/**
 * 던진 뒤의 스톤으로 me 팀에게 얼마나 좋은지 매긴다. 엔드가 지금 끝난다면 얻는 점수가 중심이고,
 * 하우스 안 스톤 수와, 하우스 안의 내 1번 스톤을 가려 주는 가드를 조금 더 쳐 준다.
 */
export function evaluate(stones, me, { last = false } = {}) {
  const live = stones.filter((s) => s.inPlay !== false);
  const result = scoreEnd(live);
  let value = result.team === me ? result.points : result.team >= 0 ? -result.points : 0;
  if (last) return value;
  for (const s of live) {
    if (!inHouse(s)) continue;
    // 버튼에 가까울수록 조금 더
    const w = 0.2 + 0.15 * (1 - distanceToButton(s) / (HOUSE_RADIUS + STONE_RADIUS));
    value += s.team === me ? w : -w;
  }
  if (result.team === me) {
    const shot = result.counting[0];
    const covered = live.some((g) => g.team === me && isGuard(g) && Math.abs(g.x - shot.x) < 0.4);
    if (covered) value += 0.35;
  }
  return value;
}

/** 놓인 스톤을 보고 생각해 볼 수 후보 [{ type, target, shot }] */
export function candidates(stones, me, level = LEVELS.normal) {
  const list = [];
  const live = stones.filter((s) => s.inPlay !== false);
  const add = (type, target, shot) => {
    if (Math.abs(shot.angle) >= ANGLE_LIMIT) return;
    list.push({ type, target, shot });
  };
  // 드로: 버튼과 그 둘레
  const draws = [
    [0, 0],
    [0.45, 0.25],
    [-0.45, 0.25],
    [0, -0.55],
  ];
  // 상대 1번 스톤 바로 앞(그 스톤을 가리는 자리)과 내 1번 스톤 옆
  const shot = scoreEnd(live).counting[0];
  if (shot) draws.push([shot.x * 0.6, shot.z + (shot.team === me ? 0.45 : 0.6)]);
  for (const [x, z] of draws) for (const spin of SPINS) add('draw', { x, z }, solveDraw(x, z, spin));
  // 가드: 가운데와 양쪽 코너, 내 1번 스톤을 가리는 자리
  const guards = [
    [0, 3.4],
    [0.9, 3.1],
    [-0.9, 3.1],
  ];
  if (shot && shot.team === me) guards.push([shot.x, Math.min(HOG_Z - 1.2, shot.z + 3)]);
  for (const [x, z] of guards) for (const spin of SPINS) add('guard', { x, z }, solveDraw(x, z, spin));
  // 테이크아웃: 하우스 안이나 가드 자리의 상대 스톤
  if (level.hits) {
    for (const s of live) {
      if (s.team === me || !(inHouse(s) || isGuard(s))) continue;
      for (const spin of SPINS) {
        add('takeout', { x: s.x, z: s.z }, solveHit(s.x, s.z, spin, TAKEOUT_SPEED));
        if (inHouse(s)) add('tap', { x: s.x, z: s.z }, solveHit(s.x, s.z, spin, TAP_SPEED));
      }
    }
  }
  return list;
}

/** 놓인 스톤 위에 shot 을 던져 본 결과의 스톤들 */
export function simulate(stones, team, shot) {
  const sheet = new Sheet(stones.filter((s) => s.inPlay !== false));
  sheet.deliver(team, shot);
  sheet.run();
  return sheet.stones;
}

/** shot 에 손 떨림을 더한다 */
export function jitter(shot, level, rng) {
  return {
    angle: clamp(shot.angle + gaussian(rng) * level.angle, -ANGLE_LIMIT, ANGLE_LIMIT),
    speed: clamp(shot.speed * (1 + gaussian(rng) * level.speed), 0.5, SPEED_MAX),
    spin: shot.spin,
  };
}

/**
 * 컴퓨터의 다음 투구.
 * state: { team, last: 이번 엔드 마지막 스톤인지 }
 * { shot: 실제로 던질 값(떨림 포함), plan: 노린 값, type, target, broom: 스킵이 브룸을 대는 x } 를 돌려준다.
 */
export function chooseShot(stones, { team, last = false }, levelId = 'normal', rng = Math.random) {
  const level = LEVELS[levelId];
  if (!level) throw new Error(`알 수 없는 실력: ${levelId}`);
  // 결과가 떨림에 너무 민감한 수는 피하도록 조금 흔든 결과도 같이 본다
  const probe = LEVELS.normal;
  const probeRng = createRng(stones.length * 7919 + 17); // 같은 판이면 같은 판단
  const scored = candidates(stones, team, level).map((c) => {
    let value = evaluate(simulate(stones, team, c.shot), team, { last });
    for (let i = 0; i < 2; i++) value += evaluate(simulate(stones, team, jitter(c.shot, probe, probeRng)), team, { last });
    return { ...c, value: value / 3 };
  });
  scored.sort((a, b) => b.value - a.value);
  const pool = scored.slice(0, Math.max(1, level.top));
  const pick = pool[Math.floor(rng() * pool.length)] ?? { type: 'draw', target: { x: 0, z: 0 }, shot: solveDraw(0, 0, 1) };
  return {
    shot: jitter(pick.shot, level, rng),
    plan: pick.shot,
    type: pick.type,
    target: pick.target,
    value: pick.value,
    broom: broomX(pick.shot.angle),
  };
}
