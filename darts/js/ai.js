// 컴퓨터 플레이어: 남은 점수에 맞는 구역을 겨냥하고, 손 떨림만큼 빗나간다.

import { targetPoint } from './board.js';

/** 남은 점수에서 겨냥할 구역 { number, multiplier } */
export function chooseTarget(remaining) {
  if (remaining > 60) return { number: 20, multiplier: 3 };
  if (remaining === 50) return { number: 25, multiplier: 2 };
  if (remaining === 25) return { number: 25, multiplier: 1 };
  // 한 번에 끝낼 수 있으면 가장 넓은 구역부터
  if (remaining <= 20) return { number: remaining, multiplier: 1 };
  if (remaining <= 40 && remaining % 2 === 0) return { number: remaining / 2, multiplier: 2 };
  if (remaining % 3 === 0) return { number: remaining / 3, multiplier: 3 };
  // 아니면 넘치지 않는 선에서 싱글로 깎는다
  return { number: Math.min(20, remaining - 1), multiplier: 1 };
}

function gaussian(rng) {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 컴퓨터가 던진 다트가 꽂히는 좌표 (mm). spread 는 빗나가는 정도의 표준편차 */
export function computerThrow(remaining, rng = Math.random, spread = 17) {
  const target = chooseTarget(remaining);
  const aim = targetPoint(target.number, target.multiplier);
  return { x: aim.x + gaussian(rng) * spread, y: aim.y + gaussian(rng) * spread };
}
