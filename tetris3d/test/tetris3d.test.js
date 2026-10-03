import test from 'node:test';
import assert from 'node:assert/strict';
import { PIECES, PIECE_SETS, rotateCell, rotateCells, bounds, spawnCells } from '../js/pieces.js';
import {
  Tetris3D,
  LOCK_DELAY,
  CUBES_PER_LEVEL,
  PIT_SIZES,
  clearScore,
  perfectBonus,
  gravityInterval,
  createRng,
} from '../js/game.js';
import { viewAxes, moveVector, rotation } from '../js/controls.js';
import { SaveStore, BEST_KEY, SETTINGS_KEY, DEFAULT_SETTINGS } from '../js/save.js';

const AXES = ['x', 'y', 'z'];

/** 평행 이동을 무시한 모양 비교용 키 */
function shapeKey(cells) {
  const { min } = bounds(cells);
  return cells
    .map((c) => c.map((v, i) => v - min[i]).join(','))
    .sort()
    .join(';');
}

/** 회전으로 만들 수 있는 모든 방향(최대 24가지)의 모양 키 */
function orientations(cells) {
  const seen = new Set([shapeKey(cells)]);
  const queue = [cells];
  while (queue.length) {
    const current = queue.pop();
    for (const axis of AXES) {
      const next = rotateCells(current, axis, 1);
      const key = shapeKey(next);
      if (!seen.has(key)) {
        seen.add(key);
        queue.push(next);
      }
    }
  }
  return seen;
}

function connected(cells) {
  const keys = new Set(cells.map((c) => c.join(',')));
  const seen = new Set([cells[0].join(',')]);
  const stack = [cells[0]];
  while (stack.length) {
    const [x, y, z] = stack.pop();
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const key = `${x + dx},${y + dy},${z + dz}`;
      if (keys.has(key) && !seen.has(key)) {
        seen.add(key);
        stack.push([x + dx, y + dy, z + dz]);
      }
    }
  }
  return seen.size === cells.length;
}

/** 테스트용: 층 z 를 (skip 칸만 빼고) 채운다 */
function fillLayer(game, z, skip = []) {
  for (let y = 0; y < game.depth; y++) {
    for (let x = 0; x < game.width; x++) {
      if (!skip.some(([sx, sy]) => sx === x && sy === y)) game.grid[game.index(x, y, z)] = 1;
    }
  }
}

/** 원하는 조각을 원하는 자리에 놓는다 */
function place(game, kind, pos, cells = PIECES[kind].cells) {
  game.piece = { id: 999, kind, cells, pos };
}

// ---------- 조각 ----------

test('조각은 모두 이어져 있고 칸이 겹치지 않는다', () => {
  for (const [kind, { cells }] of Object.entries(PIECES)) {
    assert.equal(new Set(cells.map((c) => c.join(','))).size, cells.length, kind);
    assert.ok(connected(cells), `${kind} 이 이어져 있지 않다`);
  }
});

test('같은 축으로 네 번 돌리면 제자리, 반대로 돌리면 되돌아온다', () => {
  for (const { cells } of Object.values(PIECES)) {
    for (const axis of AXES) {
      let turned = cells;
      for (let i = 0; i < 4; i++) turned = rotateCells(turned, axis, 1);
      assert.deepEqual(turned, cells);
      assert.deepEqual(rotateCells(rotateCells(cells, axis, 1), axis, -1), cells);
    }
  }
});

test('회전은 오른손 법칙을 따른다', () => {
  assert.deepEqual(rotateCell([0, 1, 0], 'x', 1), [0, 0, 1]);
  assert.deepEqual(rotateCell([0, 0, 1], 'y', 1), [1, 0, 0]);
  assert.deepEqual(rotateCell([1, 0, 0], 'z', 1), [0, 1, 0]);
});

test('한 묶음 안의 조각은 돌려서 같아지지 않는다', () => {
  for (const [id, set] of Object.entries(PIECE_SETS)) {
    const all = set.kinds.map((kind) => orientations(PIECES[kind].cells));
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const overlap = [...all[i]].some((key) => all[j].has(key));
        assert.ok(!overlap, `${id}: ${set.kinds[i]} 와 ${set.kinds[j]} 가 같은 모양`);
      }
    }
  }
});

test('두 나사 조각은 서로 거울상이다', () => {
  const mirror = (cells) => cells.map(([x, y, z]) => [y, x, z]);
  assert.ok(orientations(PIECES.R4.cells).has(shapeKey(mirror(PIECES.K4.cells))));
});

test('모든 조각이 모든 우물 크기에 들어가는 방향으로 나온다', () => {
  for (const size of PIT_SIZES) {
    for (const kind of Object.keys(PIECES)) {
      const cells = spawnCells(kind, size, size);
      assert.ok(cells, `${kind} 이 ${size}×${size} 에 안 들어간다`);
      const { size: extent } = bounds(cells);
      assert.ok(extent[0] <= size && extent[1] <= size);
    }
  }
});

// ---------- 게임 ----------

test('시작 상태', () => {
  const game = new Tetris3D({ rng: createRng(1) });
  assert.equal(game.width, 5);
  assert.equal(game.depth, 5);
  assert.equal(game.height, 12);
  assert.equal(game.score, 0);
  assert.equal(game.level, 1);
  assert.equal(game.over, false);
  assert.ok(game.piece);
  assert.ok(game.kinds.includes(game.next));
  // 조각은 맨 위 층에 닿게, 우물 안에 나온다
  const cells = game.pieceCells();
  assert.equal(Math.max(...cells.map((c) => c[2])), game.height - 1);
  for (const [x, y, z] of cells) assert.ok(game.isFree(x, y, z));
  assert.deepEqual(game.drain().map((e) => e.type), ['spawn']);
});

test('한 묶음의 조각이 모두 한 번씩 나온 뒤에 다시 나온다', () => {
  const game = new Tetris3D({ set: 'extended', rng: createRng(7) });
  const n = game.kinds.length;
  const seen = [game.piece.kind, game.next];
  for (let i = 0; i < n * 2; i++) seen.push(game.draw());
  for (const round of [seen.slice(0, n), seen.slice(n, n * 2)]) {
    assert.deepEqual([...round].sort(), [...game.kinds].sort());
  }
});

test('벽을 넘어 옮길 수 없다', () => {
  const game = new Tetris3D({ rng: createRng(2) });
  place(game, 'O4', [0, 0, 5]);
  assert.equal(game.move(-1, 0), false);
  assert.equal(game.move(0, -1), false);
  assert.equal(game.move(1, 0), true);
  assert.equal(game.move(1, 0), true);
  assert.equal(game.move(1, 0), true);
  assert.equal(game.move(1, 0), false); // x = 3, 4 를 차지해 오른쪽 벽에 닿았다
  assert.deepEqual(game.piece.pos, [3, 0, 5]);
});

test('쌓인 칸을 뚫고 옮길 수 없다', () => {
  const game = new Tetris3D({ rng: createRng(2) });
  game.grid[game.index(2, 0, 0)] = 1;
  place(game, 'D2', [0, 0, 0]);
  assert.equal(game.move(1, 0), false);
});

test('막힌 회전은 옆으로 비켜서 돈다', () => {
  const game = new Tetris3D({ rng: createRng(3) });
  // 왼쪽 벽에 붙은 세로 3일자를 z 축으로 돌리면 x = -1 이 벽이라 한 칸 비켜야 한다
  place(game, 'I3', [0, 2, 5], rotateCells(PIECES.I3.cells, 'z', 1));
  assert.equal(game.rotate('z', 1), true);
  const xs = game.pieceCells().map((c) => c[0]);
  assert.equal(Math.min(...xs), 0);
  assert.equal(game.pieceCells().every(([x, y, z]) => game.isFree(x, y, z)), true);
});

test('어디에도 못 들어가는 회전은 거부한다', () => {
  const game = new Tetris3D({ width: 3, rng: createRng(3) });
  // 3×3 바닥 한가운데 줄만 비워 두고 I3 를 눕혀 넣는다. 세우려 해도 위가 막혀 있다
  fillLayer(game, 0, [[0, 1], [1, 1], [2, 1]]);
  fillLayer(game, 1);
  place(game, 'I3', [1, 1, 0]);
  const before = JSON.stringify(game.piece);
  assert.equal(game.rotate('y', 1), false);
  assert.equal(game.rotate('z', 1), false);
  assert.equal(JSON.stringify(game.piece), before);
});

test('바로 떨어뜨리면 바닥에 굳고 떨어진 거리의 두 배를 얻는다', () => {
  const game = new Tetris3D({ rng: createRng(4) });
  game.drain();
  place(game, 'O4', [0, 0, 9]);
  const distance = game.hardDrop();
  assert.equal(distance, 9);
  assert.equal(game.score, 18);
  assert.equal(game.filled(0, 0, 0), true);
  assert.equal(game.filled(1, 1, 0), true);
  assert.equal(game.pieces, 1);
  assert.deepEqual(game.drain().map((e) => e.type), ['drop', 'lock', 'spawn']);
});

test('그림자 위치는 쌓인 칸 바로 위다', () => {
  const game = new Tetris3D({ rng: createRng(4) });
  fillLayer(game, 0, [[4, 4]]);
  fillLayer(game, 1, [[4, 4]]);
  place(game, 'O4', [0, 0, 9]);
  assert.deepEqual(game.landing(), [0, 0, 2]);
});

test('중력으로 떨어지고, 바닥에 닿으면 잠시 뒤 굳는다', () => {
  const game = new Tetris3D({ rng: createRng(5) });
  place(game, 'O4', [0, 0, 1]);
  game.update(gravityInterval(1) + 0.001);
  assert.equal(game.piece.pos[2], 0);
  game.update(LOCK_DELAY / 2);
  assert.equal(game.pieces, 0);
  game.update(LOCK_DELAY / 2 + 0.01);
  assert.equal(game.pieces, 1);
  assert.equal(game.filled(0, 0, 0), true);
});

test('바닥에서 움직이면 굳는 시간이 다시 시작된다', () => {
  const game = new Tetris3D({ rng: createRng(5) });
  place(game, 'O4', [0, 0, 0]);
  game.update(LOCK_DELAY * 0.8);
  assert.equal(game.move(1, 0), true);
  game.update(LOCK_DELAY * 0.8);
  assert.equal(game.pieces, 0);
  game.update(LOCK_DELAY * 0.3);
  assert.equal(game.pieces, 1);
});

test('한 칸 내리기는 1점, 바닥이면 바로 굳힌다', () => {
  const game = new Tetris3D({ rng: createRng(6) });
  place(game, 'O4', [0, 0, 1]);
  assert.equal(game.softDrop(), true);
  assert.equal(game.score, 1);
  assert.equal(game.softDrop(), false);
  assert.equal(game.pieces, 1);
});

test('꽉 찬 층은 지워지고 위층이 내려온다', () => {
  const game = new Tetris3D({ rng: createRng(8) });
  fillLayer(game, 0, [[0, 0], [1, 0], [0, 1], [1, 1]]);
  game.grid[game.index(3, 3, 1)] = 1; // 위층에 남을 칸
  game.drain();
  place(game, 'O4', [0, 0, 6]);
  game.hardDrop();
  const events = game.drain();
  const clear = events.find((e) => e.type === 'clear');
  assert.deepEqual(clear.layers, [0]);
  assert.equal(clear.perfect, false);
  assert.equal(game.layers, 1);
  assert.equal(game.layerCount(0), 1);
  assert.equal(game.filled(3, 3, 0), true);
  assert.equal(game.layerCount(1), 0);
  assert.equal(game.score, 6 * 2 + clearScore(1, 1));
});

test('여러 층을 한꺼번에 지우면 더 많이 받고, 다 비우면 보너스', () => {
  const game = new Tetris3D({ rng: createRng(9) });
  // 두 층 모두 (0, 0) 한 칸씩만 비워 두고 세로 도미노로 채운다
  fillLayer(game, 0, [[0, 0]]);
  fillLayer(game, 1, [[0, 0]]);
  game.drain();
  place(game, 'D2', [0, 0, 8], rotateCells(PIECES.D2.cells, 'y', -1));
  game.hardDrop();
  const clear = game.drain().find((e) => e.type === 'clear');
  assert.deepEqual(clear.layers, [0, 1]);
  assert.equal(clear.perfect, true);
  assert.equal(clear.score, clearScore(2, 1) + perfectBonus(1));
  assert.equal(game.stackHeight(), 0);
});

test('점수 공식', () => {
  assert.equal(clearScore(1, 1), 100);
  assert.equal(clearScore(2, 1), 300);
  assert.equal(clearScore(3, 1), 600);
  assert.equal(clearScore(4, 2), 2000);
  assert.equal(clearScore(1, 1, 9), 36); // 3×3 우물은 한 층이 쉬우니 덜 준다
  assert.equal(perfectBonus(3), 3000);
});

test('지운 칸 수에 따라 레벨이 오르고 빨라진다', () => {
  const game = new Tetris3D({ rng: createRng(10) });
  game.cleared = CUBES_PER_LEVEL - 25;
  fillLayer(game, 0, [[0, 0], [1, 0], [0, 1], [1, 1]]);
  game.drain();
  place(game, 'O4', [0, 0, 3]);
  game.hardDrop();
  assert.equal(game.level, 2);
  assert.ok(game.drain().some((e) => e.type === 'level' && e.level === 2));
  assert.ok(gravityInterval(2) < gravityInterval(1));
  assert.equal(gravityInterval(1), 1.6);
  assert.equal(gravityInterval(50), 0.2);
});

test('새 조각이 나올 자리가 막히면 게임이 끝난다', () => {
  const game = new Tetris3D({ width: 3, rng: createRng(11) });
  for (let z = 0; z < game.height; z++) fillLayer(game, z, [[0, 0]]);
  game.piece = null;
  assert.equal(game.spawn(), false);
  assert.equal(game.over, true);
  assert.equal(game.move(1, 0), false);
  assert.equal(game.rotate('z', 1), false);
  assert.ok(game.drain().some((e) => e.type === 'over'));
});

test('아무렇게나 끝까지 해도 칸이 우물 밖으로 나가거나 겹치지 않는다', () => {
  for (const set of Object.keys(PIECE_SETS)) {
    for (const size of PIT_SIZES) {
      const rng = createRng(size * 31 + set.length);
      const game = new Tetris3D({ width: size, set, rng });
      let steps = 0;
      while (!game.over && steps++ < 5000) {
        const r = rng();
        if (r < 0.3) game.move(Math.floor(rng() * 3) - 1, Math.floor(rng() * 3) - 1);
        else if (r < 0.55) game.rotate(AXES[Math.floor(rng() * 3)], rng() < 0.5 ? 1 : -1);
        else if (r < 0.65) game.hardDrop();
        else game.update(0.2);
        if (game.piece && !game.over) {
          for (const [x, y, z] of game.pieceCells()) assert.ok(game.isFree(x, y, z), `${set}-${size}`);
        }
        for (let z = 0; z < game.height; z++) assert.ok(game.layerCount(z) < game.area);
      }
      assert.ok(game.over, `${set}-${size} 가 끝나지 않았다`);
    }
  }
});

// ---------- 화면 기준 조작 ----------

test('기본 시점에서 오른쪽은 +x, 안쪽은 +y', () => {
  assert.deepEqual(viewAxes(0), { right: [1, 0], away: [0, 1] });
  assert.deepEqual(moveVector('left', 0), [-1, 0]);
  assert.deepEqual(moveVector('down', 0), [0, -1]);
});

test('시점을 돌리면 이동 방향도 함께 돈다', () => {
  // 동쪽에서 서쪽을 보면 화면 오른쪽이 +y, 안쪽이 -x
  assert.deepEqual(viewAxes(1), { right: [0, 1], away: [-1, 0] });
  assert.deepEqual(viewAxes(2), { right: [-1, 0], away: [0, -1] });
  assert.deepEqual(viewAxes(-1), viewAxes(3));
});

test('화면 기준 회전이 보이는 대로 움직인다', () => {
  for (let q = 0; q < 4; q++) {
    const { right, away } = viewAxes(q);
    const up = [0, 0, 1];
    const apply = (turn, sign, cell) => {
      const { axis, dir } = rotation(turn, sign, q);
      return rotateCell(cell, axis, dir);
    };
    // pitch+: 위쪽이 화면 안쪽으로 넘어간다
    assert.deepEqual(apply('pitch', 1, up), [away[0], away[1], 0]);
    // roll+: 위쪽이 화면 오른쪽으로 넘어간다
    assert.deepEqual(apply('roll', 1, up), [right[0], right[1], 0]);
    // yaw+: 위에서 봐서 시계 방향 — 안쪽을 가리키던 칸이 오른쪽을 가리킨다
    assert.deepEqual(apply('yaw', 1, [away[0], away[1], 0]), [right[0], right[1], 0]);
    // 반대 부호는 되돌린다
    for (const turn of ['pitch', 'roll', 'yaw']) {
      assert.deepEqual(apply(turn, -1, apply(turn, 1, [1, 2, 3])), [1, 2, 3]);
    }
  }
});

// ---------- 저장 ----------

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

test('최고 기록은 모드마다 따로, 점수가 높을 때만 바뀐다', () => {
  const store = new SaveStore(memoryStorage());
  const mode = { set: 'basic', size: 5 };
  assert.equal(store.loadBest(mode), null);
  assert.equal(store.recordBest(mode, { score: 500, layers: 3, level: 1 }), true);
  assert.equal(store.recordBest(mode, { score: 400, layers: 9, level: 2 }), false);
  assert.equal(store.recordBest({ set: 'flat', size: 3 }, { score: 100, layers: 1, level: 1 }), true);
  assert.deepEqual(store.loadBest(mode), { score: 500, layers: 3, level: 1 });
  assert.deepEqual(store.loadBest({ set: 'flat', size: 3 }), { score: 100, layers: 1, level: 1 });
});

test('망가진 저장 데이터는 무시한다', () => {
  const storage = memoryStorage({
    [BEST_KEY]: JSON.stringify({ 'basic-5': { score: -3, layers: 1, level: 1 }, 'flat-4': { score: 10, layers: 1, level: 1 } }),
    [SETTINGS_KEY]: '{not json',
  });
  const store = new SaveStore(storage);
  assert.equal(store.loadBest({ set: 'basic', size: 5 }), null);
  assert.deepEqual(store.loadBest({ set: 'flat', size: 4 }), { score: 10, layers: 1, level: 1 });
  assert.deepEqual(store.loadSettings(), DEFAULT_SETTINGS);
  store.saveSettings({ set: 'extended', size: 7 });
  assert.deepEqual(store.loadSettings(), { set: 'extended', size: 5 });
});

test('저장소가 예외를 던져도 게임은 계속된다', () => {
  const broken = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('quota');
    },
  };
  const store = new SaveStore(broken);
  assert.equal(store.loadBest({ set: 'basic', size: 5 }), null);
  assert.equal(store.recordBest({ set: 'basic', size: 5 }, { score: 1, layers: 0, level: 1 }), true);
  assert.equal(new SaveStore(null).saveSettings(DEFAULT_SETTINGS), false);
});
