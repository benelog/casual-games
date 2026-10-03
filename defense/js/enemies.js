// 적 정의. hp 는 1웨이브 기준이고 웨이브마다 HP_GROWTH 배씩 늘어난다.
// speed 는 초당 타일, reward 는 처치 골드, damage 는 기지에 닿았을 때 잃는 목숨.

export const ENEMIES = {
  normal: { name: '일반', hp: 44, speed: 1.1, reward: 4, damage: 1 },
  fast: { name: '빠른 적', hp: 22, speed: 1.98, reward: 3, damage: 1 }, // 일반의 1.8배 속도
  heavy: { name: '중장갑', hp: 176, speed: 0.66, reward: 10, damage: 1 }, // 일반의 4배 체력
  boss: { name: '보스', hp: 1000, speed: 0.55, reward: 60, damage: 5 },
};

export const ENEMY_TYPES = Object.keys(ENEMIES);
export const HP_GROWTH = 1.16;

/** wave 웨이브(1부터)에 나오는 type 적의 체력 */
export function enemyHp(type, wave) {
  return Math.round(ENEMIES[type].hp * HP_GROWTH ** (wave - 1));
}
