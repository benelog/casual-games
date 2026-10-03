// 헤드리스 시뮬레이션으로 난이도를 확인한다. 수치를 바꾸면 이 테스트로 밸런스를 다시 맞춘다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DefenseGame, START_LIVES, STEP } from '../js/game.js';
import { MAP, positionAt } from '../js/map.js';
import { TOWERS, towerStats, upgradeCost } from '../js/towers.js';

// ---------- 헤드리스 플레이어 ----------

/** 건설 칸마다 사거리 안에 들어오는 경로 길이(타일)를 센다 */
function coverage(map, range) {
  const samples = [];
  for (let d = 0; d <= map.length; d += 0.25) samples.push(positionAt(map, d));
  const spots = [];
  for (let row = 0; row < map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      if (map.tiles[row][col] !== 'build') continue;
      const inside = samples.filter((p) => Math.hypot(p.x - col, p.y - row) <= range).length * 0.25;
      spots.push({ col, row, inside });
    }
  }
  return spots.sort((a, b) => b.inside - a.inside || a.row - b.row || a.col - b.col);
}

/**
 * 단순하지만 합리적인 전략: 경로를 많이 덮는 굽이 근처에 궁수탑 위주로 짓고
 * (몇 번째마다 대포·빙결탑을 섞는다), 일정 수 이상이면 남는 골드로 업그레이드한다.
 * plan 은 지을 타워 종류의 순서, minTowers(wave) 는 업그레이드보다 건설을 먼저 할 타워 수.
 */
function autoBuild(game, { plan, minTowers, upgrades = true }) {
  const spots = coverage(game.map, towerStats('archer', 1).range);
  for (;;) {
    const nextType = plan[Math.min(game.towers.length, plan.length - 1)];
    const free = spots.find((s) => !game.towerAt(s.col, s.row));
    const wantBuild = game.towers.length < minTowers(game.wave + 1) || !upgrades;
    if (wantBuild && free && game.gold >= TOWERS[nextType].cost) {
      game.build(nextType, free.col, free.row);
      continue;
    }
    if (wantBuild) break; // 지을 돈이 모일 때까지 아낀다
    // 덮는 경로가 많은 타워부터 업그레이드
    const upgradable = game.towers
      .filter((t) => upgradeCost(t.type, t.level) !== null)
      .sort((a, b) => a.level - b.level || game.towers.indexOf(a) - game.towers.indexOf(b));
    const target = upgradable[0];
    if (target && game.gold >= upgradeCost(target.type, target.level)) {
      game.upgrade(target.id);
      continue;
    }
    if (!target && free && game.gold >= TOWERS[nextType].cost) {
      game.build(nextType, free.col, free.row);
      continue;
    }
    break;
  }
}

/** 게임을 끝까지 돌린다. 매 건설 단계에서 strategy(game) 를 부른다 */
function playOut(game, strategy = () => {}) {
  const log = [];
  while (!game.over) {
    strategy(game);
    const before = game.lives;
    game.startWave();
    let guard = 0;
    while (game.phase === 'combat') {
      game.step(STEP);
      if (++guard > 60 * 60 * 10) throw new Error('웨이브가 끝나지 않습니다');
    }
    game.drainEvents();
    log.push({ wave: game.wave, lost: before - game.lives, lives: game.lives, gold: game.gold, towers: game.towers.length });
  }
  return log;
}

const ARCHER_PLAN = ['archer', 'archer', 'archer', 'cannon', 'archer', 'frost', 'archer', 'cannon', 'archer'];

function standardStrategy(game) {
  autoBuild(game, { plan: ARCHER_PLAN, minTowers: (wave) => Math.min(3 + Math.floor(wave / 2), 12) });
}

// ---------- 테스트 ----------

test('굽이 근처 자리가 경로를 가장 많이 덮는다', () => {
  const best = coverage(MAP, 2.5)[0];
  // 세로 경로 두 줄 사이 (5열 또는 9열)
  assert.ok(best.col === 5 || best.col === 9, JSON.stringify(best));
  assert.ok(best.inside >= 9);
});

test('타워를 하나도 짓지 않으면 패배한다', () => {
  const game = new DefenseGame();
  playOut(game);
  assert.equal(game.phase, 'lost');
  assert.ok(game.wave <= 3, `${game.wave} 웨이브까지 버팀`);
});

test('궁수탑 위주 자동 전략으로 20웨이브를 클리어하지만 목숨이 꽤 깎인다', () => {
  const game = new DefenseGame();
  const log = playOut(game, standardStrategy);
  const lost = START_LIVES - game.lives;
  assert.equal(game.phase, 'won', JSON.stringify(log.at(-1)));
  assert.equal(game.wave, 20);
  assert.ok(lost >= 6, `잃은 목숨 ${lost}`);
  assert.ok(game.lives >= 3, `남은 목숨 ${game.lives}`);
});

test('업그레이드 없이 궁수탑만 늘리면 끝까지 버티지 못한다', () => {
  const game = new DefenseGame();
  playOut(game, (g) => autoBuild(g, { plan: ['archer'], minTowers: () => Infinity, upgrades: false }));
  assert.equal(game.phase, 'lost');
  assert.ok(game.wave >= 10, `${game.wave} 웨이브에서 패배`); // 그래도 중반까지는 간다
});
