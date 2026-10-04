// 컴퓨터 선수: 바람을 읽어 반대쪽으로 겨누지만 바람 계산이 조금씩 틀리고, 실력만큼 화살이 퍼진다.

import { windDrift } from './wind.js';

function gaussian(rng) {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 바람을 보고 겨눌 곳 (과녁 면 좌표, m). windRead 만큼 바람 계산이 틀린다 */
export function computerAim(wind, { windRead }, rng = Math.random) {
  const drift = windDrift(wind);
  const misread = 1 + gaussian(rng) * windRead;
  return { x: -drift.x * misread, y: -drift.y * misread };
}

/** 겨눈 곳에서 화살이 실제로 날아가 꽂히는 곳: 바람에 밀리고 spread 만큼 퍼진다 */
export function computerShot(aim, wind, { spread }, rng = Math.random) {
  const drift = windDrift(wind);
  return {
    x: aim.x + drift.x + gaussian(rng) * spread,
    y: aim.y + drift.y + gaussian(rng) * spread,
  };
}
