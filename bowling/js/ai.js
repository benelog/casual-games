// 컴퓨터 플레이어: 서 있는 핀을 보고 겨냥할 곳을 정하고, 사람처럼 조금씩 빗나가게 던진다.
// 결과는 사람의 투구와 같은 { startX, angle, speed, spin } 이고 같은 물리로 굴러간다.

import { PIN_SPOTS, START_LIMIT, ANGLE_LIMIT, SPEED_MIN, SPEED_MAX, angleToward, clamp } from './lane.js';

// 오른손잡이의 포켓: 1번과 3번 핀 사이
export const POCKET_X = 0.07;

function gaussian(rng) {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * 겨냥할 곳 { startX, targetX, speed, spin }. standing 은 서 있는 핀 번호(1~10) 목록.
 * 핀이 다 서 있으면 오른쪽에서 출발해 왼쪽으로 휘는 훅으로 포켓을 노린다.
 * 스페어는 곧게 던지고, 남은 핀 중 가장 앞 핀과 남은 핀 가운데의 중간을 노린다.
 */
export function chooseAim(standing) {
  if (standing.length === 0) throw new Error('서 있는 핀이 없습니다');
  if (standing.length === 10) return { startX: 0.2, targetX: POCKET_X, speed: 7.8, spin: -0.6 };
  const spots = PIN_SPOTS.filter((s) => standing.includes(s.number));
  const front = spots.reduce((a, b) => (b.z > a.z ? b : a));
  const center = spots.reduce((sum, s) => sum + s.x, 0) / spots.length;
  const targetX = (front.x + center) / 2;
  // 대각선으로 레인을 가로지르면 핀을 맞힐 폭이 넓어진다
  const startX = clamp(-targetX * 0.6, -START_LIMIT, START_LIMIT);
  return { startX, targetX, speed: 7.2, spin: 0 };
}

/**
 * 컴퓨터의 투구. error 는 손 떨림의 배율 (0 이면 겨냥한 그대로 던진다)
 */
export function computerThrow(standing, rng = Math.random, error = 1) {
  const aim = chooseAim(standing);
  const startX = clamp(aim.startX + gaussian(rng) * 0.03 * error, -START_LIMIT, START_LIMIT);
  const speed = clamp(aim.speed + gaussian(rng) * 0.35 * error, SPEED_MIN, SPEED_MAX);
  const spin = aim.spin;
  // 겨냥은 의도한 출발점·속도 기준으로 하지만, 실제로는 손에서 어긋난 만큼 빗나간다
  const angle = angleToward(aim.startX, aim.targetX, aim.speed, spin) + gaussian(rng) * 0.0028 * error;
  return { startX, angle: clamp(angle, -ANGLE_LIMIT, ANGLE_LIMIT), speed, spin };
}
