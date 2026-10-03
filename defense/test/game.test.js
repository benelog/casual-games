import test from 'node:test';
import assert from 'node:assert/strict';
import { DefenseGame, START_GOLD, START_LIVES, STEP, createRng } from '../js/game.js';
import { MAP, parseMap } from '../js/map.js';
import { TOWERS, sellValue, upgradeCost, towerStats } from '../js/towers.js';
import { ENEMIES, enemyHp } from '../js/enemies.js';
import { WAVES, spawnSchedule, waveBonus } from '../js/waves.js';

// 일직선 경로: (0,1) 에서 (10,1) 까지 길이 10. 위아래 줄은 모두 건설 가능
const LINE = parseMap(['...........', 'S#########B', '...........']);

/** 원하는 적을 경로의 dist 위치에 바로 놓는다 */
function addEnemy(game, type, dist, hp = 100) {
  const enemy = {
    id: game.nextId++,
    type,
    hp,
    maxHp: hp,
    speed: ENEMIES[type].speed,
    reward: ENEMIES[type].reward,
    damage: ENEMIES[type].damage,
    dist,
    slowTime: 0,
    slowFactor: 1,
    alive: true,
    lane: 0,
  };
  game.place(enemy);
  game.enemies.push(enemy);
  return enemy;
}

/** 스폰 없이 전투 단계만 흉내 낸다 */
function combat(game) {
  game.phase = 'combat';
  game.wave = 1;
  game.schedule = [];
  game.spawnIndex = 0;
  return game;
}

function runUntil(game, predicate, maxSeconds = 30) {
  for (let i = 0; i < maxSeconds * 60 && !predicate(); i++) game.step(STEP);
}

test('시작 상태', () => {
  const game = new DefenseGame();
  assert.equal(game.gold, START_GOLD);
  assert.equal(game.lives, START_LIVES);
  assert.equal(START_GOLD, 200);
  assert.equal(START_LIVES, 20);
  assert.equal(game.phase, 'build');
  assert.equal(game.wave, 0);
  assert.equal(game.totalWaves, 20);
});

test('건설하면 비용만큼 골드가 준다', () => {
  const game = new DefenseGame();
  const result = game.build('archer', 5, 3);
  assert.equal(result.ok, true);
  assert.equal(game.gold, 200 - TOWERS.archer.cost);
  assert.equal(game.towerAt(5, 3).type, 'archer');
  assert.equal(result.tower.invested, 50);
});

test('건설 거부: 건설 불가 타일, 중복, 골드 부족', () => {
  const game = new DefenseGame();
  assert.equal(game.build('archer', 0, 1).reason, 'tile'); // 경로
  assert.equal(game.build('archer', 0, 0).reason, 'tile'); // 장식
  assert.equal(game.build('archer', 20, 20).reason, 'tile'); // 맵 밖
  game.build('cannon', 5, 3);
  assert.equal(game.build('archer', 5, 3).reason, 'occupied');
  game.build('cannon', 5, 5);
  assert.equal(game.gold, 0);
  assert.equal(game.build('archer', 9, 3).reason, 'gold');
  assert.equal(game.towers.length, 2);
  assert.throws(() => game.build('laser', 9, 3));
});

test('업그레이드와 판매', () => {
  const game = new DefenseGame({ gold: 1000 });
  const { tower } = game.build('archer', 5, 3);
  assert.equal(game.upgrade(tower.id).ok, true);
  assert.equal(tower.level, 2);
  assert.equal(game.gold, 1000 - 50 - 40);
  assert.equal(game.upgrade(tower.id).ok, true);
  assert.equal(tower.level, 3);
  assert.equal(tower.invested, 130);
  assert.equal(game.upgrade(tower.id).reason, 'maxLevel');
  assert.ok(towerStats('archer', 3).damage > towerStats('archer', 1).damage);
  assert.ok(towerStats('archer', 3).range > towerStats('archer', 1).range);

  const before = game.gold;
  const sold = game.sell(tower.id);
  assert.equal(sold.refund, 91); // 130 의 70%
  assert.equal(game.gold, before + 91);
  assert.equal(game.towerAt(5, 3), null);
  assert.equal(game.sell(tower.id).ok, false);
});

test('업그레이드 비용은 기본 비용의 약 80%, 골드가 모자라면 거부', () => {
  for (const type of Object.keys(TOWERS)) {
    assert.equal(upgradeCost(type, 1), Math.round(TOWERS[type].cost * 0.8));
    assert.equal(upgradeCost(type, 3), null);
  }
  const game = new DefenseGame({ gold: 120 });
  const { tower } = game.build('cannon', 5, 3);
  assert.equal(game.upgrade(tower.id).reason, 'gold');
  assert.equal(tower.level, 1);
  assert.equal(game.gold, 20);
  assert.equal(sellValue(100), 70);
});

test('사거리 밖의 적은 쏘지 않는다', () => {
  const game = combat(new DefenseGame({ map: LINE, gold: 1000 }));
  const { tower } = game.build('archer', 2, 0); // 사거리 2.5
  const far = addEnemy(game, 'normal', 6); // (6,1): 거리 √17 ≈ 4.1
  game.step();
  assert.equal(game.projectiles.length, 0);
  assert.equal(tower.targetId, null);
  far.dist = 3.5; // (3.5,1): 거리 ≈ 1.8
  game.place(far);
  game.step();
  assert.equal(game.projectiles.length, 1);
});

test('사거리 안에서 경로를 가장 많이 진행한 적을 노린다', () => {
  const game = combat(new DefenseGame({ map: LINE, gold: 1000 }));
  const { tower } = game.build('archer', 4, 0);
  const behind = addEnemy(game, 'normal', 3);
  const ahead = addEnemy(game, 'normal', 5.5);
  addEnemy(game, 'normal', 8); // 가장 앞이지만 사거리 밖
  assert.equal(game.findTarget(tower), ahead);
  ahead.alive = false;
  assert.equal(game.findTarget(tower), behind);
});

test('발사체는 대상을 따라가 맞히고, 처치하면 보상 골드', () => {
  const game = combat(new DefenseGame({ map: LINE, gold: 1000 }));
  game.build('archer', 3, 0);
  const gold = game.gold;
  const enemy = addEnemy(game, 'normal', 3, 15);
  enemy.speed = 0;
  runUntil(game, () => !enemy.alive, 5);
  assert.equal(enemy.alive, false);
  assert.equal(game.gold, gold + ENEMIES.normal.reward + waveBonus(1));
  const events = game.drainEvents().map((e) => e.type);
  assert.ok(events.includes('fire'));
  assert.ok(events.includes('hit'));
  assert.ok(events.includes('kill'));
});

test('대포는 착탄 반경 안의 적 모두에게 피해를 준다', () => {
  const game = combat(new DefenseGame({ map: LINE, gold: 1000 }));
  const center = addEnemy(game, 'normal', 5);
  const near = addEnemy(game, 'normal', 5.8); // 0.8 떨어짐: 반경 1.0 안
  const far = addEnemy(game, 'normal', 6.5); // 1.5 떨어짐
  for (const e of [center, near, far]) e.speed = 0;
  const p = { id: 99, towerType: 'cannon', targetId: center.id, x: 5, y: 1, tx: 5, ty: 1, damage: 30, splash: 1, slow: 0, slowTime: 0, speed: 5 };
  game.impact(p, center);
  assert.equal(center.hp, 70);
  assert.equal(near.hp, 70);
  assert.equal(far.hp, 100);
  assert.equal(towerStats('cannon', 1).splash, 1);
});

test('빙결탑의 둔화는 겹치지 않고 시간만 갱신된다', () => {
  const game = combat(new DefenseGame({ map: LINE, gold: 1000 }));
  const enemy = addEnemy(game, 'normal', 1, 1000);
  const frost = { id: 1, towerType: 'frost', targetId: enemy.id, x: 1, y: 1, tx: 1, ty: 1, damage: 4, splash: 0, slow: 0.5, slowTime: 2, speed: 7 };
  game.impact(frost, enemy);
  assert.equal(game.currentSpeed(enemy), ENEMIES.normal.speed * 0.5);
  for (let i = 0; i < 60; i++) game.step(); // 1초 지남
  assert.ok(Math.abs(enemy.slowTime - 1) < 1e-9);
  game.impact(frost, enemy); // 다시 맞으면 2초로 갱신, 속도는 그대로 50%
  assert.equal(enemy.slowTime, 2);
  assert.equal(game.currentSpeed(enemy), ENEMIES.normal.speed * 0.5);
  for (let i = 0; i < 121; i++) game.step();
  assert.equal(enemy.slowTime, 0);
  assert.equal(game.currentSpeed(enemy), ENEMIES.normal.speed);
});

test('둔화된 적은 절반 속도로 걷는다', () => {
  const game = combat(new DefenseGame({ map: LINE }));
  const slowed = addEnemy(game, 'normal', 0);
  const free = addEnemy(game, 'normal', 0);
  slowed.slowFactor = 0.5;
  slowed.slowTime = 10;
  for (let i = 0; i < 60; i++) game.step();
  assert.ok(Math.abs(free.dist - ENEMIES.normal.speed) < 1e-9);
  assert.ok(Math.abs(slowed.dist - ENEMIES.normal.speed / 2) < 1e-9);
});

test('기지에 닿으면 목숨이 준다: 일반 1, 보스 5', () => {
  const game = combat(new DefenseGame({ map: LINE }));
  addEnemy(game, 'normal', 9.99);
  addEnemy(game, 'boss', 9.999);
  game.step();
  assert.equal(game.lives, START_LIVES - 6);
  const leaks = game.drainEvents().filter((e) => e.type === 'leak');
  assert.deepEqual(
    leaks.map((e) => e.damage),
    [1, 5],
  );
  assert.equal(game.enemies.length, 0);
});

test('목숨이 0 이 되면 패배', () => {
  const game = combat(new DefenseGame({ map: LINE, lives: 3 }));
  addEnemy(game, 'boss', 9.999);
  addEnemy(game, 'normal', 1);
  game.step();
  assert.equal(game.lives, 0);
  assert.equal(game.phase, 'lost');
  assert.equal(game.over, true);
  assert.ok(game.drainEvents().some((e) => e.type === 'lose'));
  assert.equal(game.startWave(), false);
  assert.equal(game.build('archer', 2, 0).reason, 'over');
});

test('웨이브 진행: 시작 → 스폰 → 클리어 보너스 → 건설 단계', () => {
  const waves = [[{ type: 'normal', count: 2, interval: 1 }], [{ type: 'fast', count: 1, interval: 1 }]];
  const game = new DefenseGame({ map: LINE, waves, gold: 1000 });
  game.build('archer', 2, 0);
  game.build('archer', 6, 2);
  assert.equal(game.startWave(), true);
  assert.equal(game.startWave(), false); // 전투 중에는 다시 못 누른다
  assert.equal(game.phase, 'combat');
  assert.equal(game.wave, 1);
  const gold = game.gold;
  runUntil(game, () => game.phase !== 'combat');
  assert.equal(game.phase, 'build');
  assert.equal(game.gold, gold + 2 * ENEMIES.normal.reward + waveBonus(1));
  const types = game.drainEvents().map((e) => e.type);
  assert.deepEqual(
    types.filter((t) => t === 'spawn' || t === 'waveStart' || t === 'waveEnd'),
    ['waveStart', 'spawn', 'spawn', 'waveEnd'],
  );

  game.startWave();
  runUntil(game, () => game.phase !== 'combat');
  assert.equal(game.phase, 'won');
  assert.equal(game.wave, 2);
  assert.ok(game.drainEvents().some((e) => e.type === 'win'));
});

test('전투 중에도 건설·업그레이드·판매가 된다', () => {
  const game = new DefenseGame({ gold: 1000 });
  game.startWave();
  const { tower } = game.build('archer', 5, 3);
  assert.ok(tower);
  assert.equal(game.upgrade(tower.id).ok, true);
  assert.equal(game.sell(tower.id).ok, true);
});

test('적 체력은 웨이브마다 지수적으로 늘고, 웨이브 데이터는 올바르다', () => {
  assert.equal(enemyHp('normal', 1), ENEMIES.normal.hp);
  const ratio = enemyHp('normal', 11) / enemyHp('normal', 10);
  assert.ok(ratio >= 1.14 && ratio <= 1.21, `${ratio}`);
  assert.equal(enemyHp('heavy', 1), ENEMIES.normal.hp * 4);
  assert.ok(Math.abs(ENEMIES.fast.speed / ENEMIES.normal.speed - 1.8) < 1e-9);
  assert.equal(WAVES.length, 20);
  WAVES.forEach((groups, i) => {
    const hasBoss = groups.some((g) => g.type === 'boss');
    assert.equal(hasBoss, (i + 1) % 5 === 0, `${i + 1} 웨이브 보스`);
    for (const g of groups) {
      assert.ok(ENEMIES[g.type], g.type);
      assert.ok(g.count > 0 && g.interval > 0);
    }
  });
  const schedule = spawnSchedule([
    { type: 'normal', count: 2, interval: 1 },
    { type: 'fast', count: 1, interval: 1 },
  ]);
  assert.deepEqual(
    schedule.map((s) => s.time),
    [0, 1, 3],
  );
});

test('같은 시드면 같은 결과', () => {
  const a = createRng(42);
  const b = createRng(42);
  const c = createRng(7);
  const seqA = [a(), a(), a()];
  assert.deepEqual(seqA, [b(), b(), b()]);
  assert.notDeepEqual(seqA, [c(), c(), c()]);
  assert.ok(seqA.every((v) => v >= 0 && v < 1));
});

test('기본 맵에서 스폰된 적은 경로 시작점에 나타난다', () => {
  const game = new DefenseGame();
  game.startWave();
  game.step();
  assert.equal(game.enemies.length, 1);
  const enemy = game.enemies[0];
  assert.equal(enemy.y, MAP.spawn.row);
  assert.ok(enemy.x > 0 && enemy.x < 0.1);
});
