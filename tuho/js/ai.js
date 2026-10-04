// 컴퓨터: 입 가운데(가끔은 귀)를 정확히 겨눈 세기·방향을 구한 뒤, 실력만큼 손이 떨려 빗나간다.
// 결과는 사람의 던지기와 같은 { power, yaw, pitch } 이고, 같은 물리(physics.js)로 날아간다.

import { aimFor, TARGETS, clamp, YAW_LIMIT } from './physics.js';

/**
 * 실력. power·yaw: 손 떨림 (세기, 방향 라디안의 표준편차), pitch: 촉을 드는 각도의 떨림,
 * ear: 아무 때나 귀를 노려 보는 확률, chase: 뒤질 때 마지막 몇 발에서 귀를 노리는지
 */
export const LEVELS = {
  easy: { power: 0.16, yaw: 0.04, pitch: 0.06, ear: 0, chase: false },
  normal: { power: 0.1, yaw: 0.024, pitch: 0.04, ear: 0.05, chase: false },
  hard: { power: 0.062, yaw: 0.014, pitch: 0.025, ear: 0.12, chase: true },
};
export const LEVEL_IDS = Object.keys(LEVELS);

export function gaussian(rng) {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * 어디를 노릴지: 'mouth' | 'earLeft' | 'earRight'.
 * behind: 으뜸 점수에 뒤진 점수, left: 이번 화살을 빼고 남은 화살 수
 */
export function chooseTarget(levelId, { behind = 0, left = 10 } = {}, rng = Math.random) {
  const level = LEVELS[levelId] ?? LEVELS.normal;
  const ear = rng() < 0.5 ? 'earLeft' : 'earRight';
  // 남은 화살을 모두 입에 넣어도 따라잡지 못할 만큼 뒤지면 귀(5점)를 노린다
  if (level.chase && behind > 0 && behind >= (left + 1) * 2 - 1) return ear;
  return rng() < level.ear ? ear : 'mouth';
}

/** 줄 distance 에서 levelId 의 컴퓨터가 던지는 화살 */
export function chooseShot(distance, levelId, context = {}, rng = Math.random) {
  const level = LEVELS[levelId] ?? LEVELS.normal;
  const target = chooseTarget(levelId, context, rng);
  const aim = aimFor(distance, TARGETS[target]);
  return {
    target,
    power: clamp(aim.power + gaussian(rng) * level.power, 0, 1),
    yaw: clamp(aim.yaw + gaussian(rng) * level.yaw, -YAW_LIMIT, YAW_LIMIT),
    pitch: gaussian(rng) * level.pitch,
  };
}
