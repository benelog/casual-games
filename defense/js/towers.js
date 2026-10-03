// 타워 정의. 레벨은 1~3 이고 levels[레벨 - 1] 이 그 레벨의 성능이다.
// 사거리·착탄 반경은 타일 단위, rate 는 초당 발사 횟수, 발사체 speed 는 초당 타일.

export const TOWERS = {
  archer: {
    name: '궁수탑',
    cost: 50,
    upgrade: [40, 40], // 1→2, 2→3
    projectile: 9,
    levels: [
      { damage: 10, rate: 2, range: 2.5 },
      { damage: 17, rate: 2.2, range: 2.75 },
      { damage: 27, rate: 2.5, range: 3 },
    ],
  },
  cannon: {
    name: '대포',
    cost: 100,
    upgrade: [80, 80],
    projectile: 5,
    levels: [
      { damage: 30, rate: 0.6, range: 2.2, splash: 1 },
      { damage: 52, rate: 0.65, range: 2.4, splash: 1.1 },
      { damage: 85, rate: 0.7, range: 2.6, splash: 1.2 },
    ],
  },
  frost: {
    name: '빙결탑',
    cost: 80,
    upgrade: [64, 64],
    projectile: 7,
    levels: [
      { damage: 4, rate: 1, range: 2, slow: 0.5, slowTime: 2 },
      { damage: 8, rate: 1.1, range: 2.3, slow: 0.5, slowTime: 2.5 },
      { damage: 14, rate: 1.2, range: 2.6, slow: 0.5, slowTime: 3 },
    ],
  },
};

export const TOWER_TYPES = Object.keys(TOWERS);
export const MAX_LEVEL = 3;
export const SELL_RATE = 0.7;

export function towerStats(type, level) {
  return TOWERS[type].levels[level - 1];
}

/** 다음 레벨로 올리는 비용. 최고 레벨이면 null */
export function upgradeCost(type, level) {
  return level < MAX_LEVEL ? TOWERS[type].upgrade[level - 1] : null;
}

/** 지금까지 들인 골드의 70% (내림) */
export function sellValue(invested) {
  return Math.floor(invested * SELL_RATE);
}
