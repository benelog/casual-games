import test from 'node:test';
import assert from 'node:assert/strict';
import {
  N,
  E,
  S,
  W,
  DIRS,
  SIZES,
  SHAPES,
  PipesGame,
  rotateMask,
  openCount,
  shapeOf,
  turnsOf,
  createRng,
  hashSeed,
  dateKey,
  dailySeed,
  centerIndex,
  generateSolution,
  flood,
  looseEnds,
  isSolved,
  scramble,
  formatTime,
} from '../js/game.js';
import { SaveStore, BEST_KEY, DAILY_KEY, SETTINGS_KEY, DEFAULT_SETTINGS, previousDay } from '../js/save.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

/** 정답대로 돌려 푼다. 돌린 횟수를 돌려준다 */
function solve(game) {
  let turns = 0;
  for (let index = 0; index < game.count; index++) {
    while (game.masks[index] !== game.solution[index]) {
      assert.equal(game.rotate(index), true);
      assert.ok(++turns <= game.count * 3, '한 칸은 세 번 안에 맞는다');
    }
  }
  return turns;
}

// ---------- 조각 ----------

test('rotateMask 는 시계 방향으로 돌리고 네 번이면 제자리', () => {
  assert.equal(rotateMask(N), E);
  assert.equal(rotateMask(E), S);
  assert.equal(rotateMask(S), W);
  assert.equal(rotateMask(W), N);
  assert.equal(rotateMask(N, -1), W);
  assert.equal(rotateMask(N | E), E | S);
  assert.equal(rotateMask(N | E | S, 2), S | W | N);
  for (let mask = 1; mask < 16; mask++) {
    assert.equal(rotateMask(mask, 4), mask);
    assert.equal(rotateMask(rotateMask(mask, 1), -1), mask);
    assert.equal(openCount(rotateMask(mask)), openCount(mask));
  }
});

test('모양과 회전 수는 mask 에서 나온다', () => {
  assert.equal(shapeOf(W), 'end');
  assert.equal(shapeOf(E | W), 'straight');
  assert.equal(shapeOf(S | W), 'elbow');
  assert.equal(shapeOf(N | S | W), 'tee');
  assert.equal(shapeOf(15), 'cross');
  assert.throws(() => shapeOf(0));
  for (let mask = 1; mask < 16; mask++) {
    assert.equal(rotateMask(SHAPES[shapeOf(mask)], turnsOf(mask)), mask);
  }
});

test('DIRS 는 시계 방향 순서고 opposite 는 맞은편 비트', () => {
  assert.deepEqual(DIRS.map((d) => d.bit), [N, E, S, W]);
  for (const dir of DIRS) {
    assert.equal(rotateMask(dir.bit, 2), dir.opposite);
    const back = DIRS.find((d) => d.bit === dir.opposite);
    assert.equal(back.dx + dir.dx, 0);
    assert.equal(back.dy + dir.dy, 0);
  }
});

// ---------- 난수·시드 ----------

test('createRng 는 같은 시드에 같은 수열', () => {
  const a = createRng(42);
  const b = createRng(42);
  const c = createRng(43);
  const seqA = Array.from({ length: 20 }, a);
  assert.deepEqual(seqA, Array.from({ length: 20 }, b));
  assert.notDeepEqual(seqA, Array.from({ length: 20 }, c));
  assert.ok(seqA.every((v) => v >= 0 && v < 1));
});

test('오늘의 퍼즐 시드는 날짜와 크기로 정해진다', () => {
  assert.equal(dateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(dailySeed('2026-10-04', 7), dailySeed('2026-10-04', 7));
  assert.notEqual(dailySeed('2026-10-04', 7), dailySeed('2026-10-05', 7));
  assert.notEqual(dailySeed('2026-10-04', 7), dailySeed('2026-10-04', 9));
  assert.equal(hashSeed('abc') >>> 0, hashSeed('abc'));

  const day = '2026-10-04';
  const a = new PipesGame({ size: 7, rng: createRng(dailySeed(day, 7)), daily: day });
  const b = new PipesGame({ size: 7, rng: createRng(dailySeed(day, 7)), daily: day });
  const other = new PipesGame({ size: 7, rng: createRng(dailySeed('2026-10-05', 7)) });
  assert.deepEqual(a.solution, b.solution);
  assert.deepEqual(a.masks, b.masks);
  assert.notDeepEqual(a.solution, other.solution);
  assert.equal(a.daily, day);
});

test('formatTime 은 초를 분:초로', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(9.9), '0:09');
  assert.equal(formatTime(75), '1:15');
  assert.equal(formatTime(3725), '1:02:05');
  assert.equal(formatTime(-3), '0:00');
});

// ---------- 퍼즐 생성 ----------

test('정답은 모든 칸을 잇는 신장 트리', () => {
  for (const size of [2, 3, ...SIZES, 14]) {
    for (let seed = 0; seed < 40; seed++) {
      const { source, masks } = generateSolution(size, createRng(seed * 7919 + size));
      assert.equal(source, centerIndex(size));
      assert.equal(masks.length, size * size);
      assert.ok(masks.every((mask) => mask > 0), '빈 칸이 없다');
      assert.equal(flood(size, masks, source).count, size * size, '모든 칸이 수원과 이어진다');
      assert.equal(looseEnds(size, masks), 0, '열린 끝이 없다');
      // 연결 수가 칸 수 - 1 이면 고리가 없다
      const halfEdges = masks.reduce((sum, mask) => sum + openCount(mask), 0);
      assert.equal(halfEdges, 2 * (size * size - 1));
      assert.ok(isSolved(size, masks, source));
    }
  }
});

test('십자 조각은 거의 나오지 않는다', () => {
  let cross = 0;
  let total = 0;
  for (let seed = 0; seed < 100; seed++) {
    const { masks } = generateSolution(9, createRng(seed));
    cross += masks.filter((mask) => mask === 15).length;
    total += masks.length;
  }
  assert.ok(cross / total < 0.005, `십자 ${cross}/${total}`);
});

test('섞인 퍼즐은 풀려 있지 않고, 조각을 돌리면 항상 풀 수 있다', () => {
  for (const size of SIZES) {
    for (let seed = 1; seed <= 30; seed++) {
      const game = new PipesGame({ size, rng: createRng(seed) });
      assert.equal(game.solved, false);
      assert.equal(isSolved(size, game.masks, game.source), false, '시작부터 풀려 있으면 안 된다');
      for (let index = 0; index < game.count; index++) {
        assert.equal(shapeOf(game.masks[index]), shapeOf(game.solution[index]), '섞어도 모양은 그대로');
      }
      const turns = solve(game);
      assert.ok(turns > 0);
      assert.equal(game.solved, true);
      assert.equal(game.filled, game.count);
      assert.equal(game.moves, turns);
    }
  }
});

test('아주 작은 판도 시작부터 풀려 있지 않다', () => {
  for (let seed = 0; seed < 200; seed++) {
    const game = new PipesGame({ size: 2, rng: createRng(seed) });
    assert.equal(isSolved(2, game.masks, game.source), false);
  }
  // 섞기가 우연히 정답을 내는 난수여도 다시 섞는다
  const { source, masks } = generateSolution(3, createRng(5));
  const values = [...Array(9).fill(0), ...Array(9).fill(0.3)];
  const mixed = scramble(3, masks, source, () => values.shift() ?? 0.3);
  assert.equal(isSolved(3, mixed, source), false);
});

// ---------- 물길 ----------

test('물은 서로 마주 열린 칸으로만 흐른다', () => {
  // 3×3: 수원(가운데)이 동쪽으로 열려 있고, 오른쪽 칸이 서쪽·북쪽으로 열려 있다
  const masks = new Uint8Array(9).fill(N);
  masks[4] = E;
  masks[5] = W | N;
  masks[2] = W; // 5 의 북쪽 구멍과 마주 보지 않는다
  let result = flood(3, masks, 4);
  assert.equal(result.count, 2);
  assert.deepEqual([...result.depth], [-1, -1, -1, -1, 0, 1, -1, -1, -1]);
  masks[2] = S;
  result = flood(3, masks, 4);
  assert.equal(result.count, 3);
  assert.equal(result.depth[2], 2);
});

test('판 밖을 향하거나 막힌 쪽을 향한 구멍은 열린 끝', () => {
  const masks = new Uint8Array(4);
  masks[0] = E; // (0,0) → (1,0)
  masks[1] = W | S; // (1,0)
  masks[3] = N | W; // (1,1)
  masks[2] = E; // (0,1)
  assert.equal(looseEnds(2, masks), 0);
  assert.ok(isSolved(2, masks, 0));
  masks[2] = W; // 판 밖
  assert.equal(looseEnds(2, masks), 2); // 2 의 구멍과, 짝을 잃은 3 의 서쪽 구멍
  assert.equal(isSolved(2, masks, 0), false);
});

// ---------- 진행 ----------

test('회전하면 회전 수가 오르고 물이 찬 칸이 다시 계산된다', () => {
  const game = new PipesGame({ size: 5, rng: createRng(7) });
  assert.deepEqual(game.drain(), [{ type: 'start' }]);
  assert.equal(game.moves, 0);
  assert.equal(game.isFilled(game.source), true);

  const index = 0;
  const before = game.masks[index];
  assert.equal(game.rotate(index), true);
  assert.equal(game.masks[index], rotateMask(before, 1));
  assert.equal(game.rotate(index, -1), true);
  assert.equal(game.masks[index], before);
  assert.equal(game.moves, 2);
  const events = game.drain().filter((e) => e.type === 'rotate');
  assert.deepEqual(events, [
    { type: 'rotate', index, dir: 1 },
    { type: 'rotate', index, dir: -1 },
  ]);
  assert.equal(game.filled, flood(5, game.masks, game.source).count);

  assert.equal(game.rotate(-1), false);
  assert.equal(game.rotate(25), false);
  assert.equal(game.rotate(1.5), false);
  assert.equal(game.moves, 2);
});

test('시간은 첫 회전부터 풀 때까지만 흐른다', () => {
  const game = new PipesGame({ size: 5, rng: createRng(3) });
  game.update(5);
  assert.equal(game.elapsed, 0);
  game.rotate(0);
  game.rotate(0, -1);
  game.update(1.5);
  assert.equal(game.elapsed, 1.5);
  solve(game);
  const solved = game.drain().filter((e) => e.type === 'solved');
  assert.equal(solved.length, 1);
  assert.equal(solved[0].time, 1.5);
  assert.equal(solved[0].moves, game.moves);
  game.update(10);
  assert.equal(game.elapsed, 1.5);
  // 푼 뒤에는 돌릴 수 없다
  const moves = game.moves;
  assert.equal(game.rotate(0), false);
  assert.equal(game.moves, moves);
});

test('물이 찬 칸 수가 바뀌면 fill 사건이 난다', () => {
  const game = new PipesGame({ size: 5, rng: createRng(11) });
  game.drain();
  let seen = 0;
  for (let index = 0; index < game.count; index++) {
    while (game.masks[index] !== game.solution[index]) {
      const before = game.filled;
      game.rotate(index);
      const fill = game.drain().find((e) => e.type === 'fill');
      if (game.filled !== before) {
        assert.deepEqual(fill, { type: 'fill', filled: game.filled, before });
        seen++;
      } else {
        assert.equal(fill, undefined);
      }
    }
  }
  assert.ok(seen > 0);
});

test('reset 은 처음 상태로, reshuffle 은 같은 정답을 새로 섞는다', () => {
  const game = new PipesGame({ size: 7, rng: createRng(99) });
  const initial = Uint8Array.from(game.masks);
  const solution = Uint8Array.from(game.solution);
  game.rotate(3);
  game.rotate(10);
  game.update(4);
  game.reset();
  assert.deepEqual(game.masks, initial);
  assert.equal(game.moves, 0);
  assert.equal(game.elapsed, 0);
  assert.equal(game.started, false);

  solve(game);
  game.reshuffle(createRng(5));
  assert.deepEqual(game.solution, solution);
  assert.notDeepEqual(game.masks, initial);
  assert.equal(game.solved, false);
  assert.equal(isSolved(7, game.masks, game.source), false);
  assert.equal(game.moves, 0);
  solve(game);
  assert.equal(game.solved, true);
});

test('잘못된 크기는 거부한다', () => {
  assert.throws(() => new PipesGame({ size: 1 }));
  assert.throws(() => new PipesGame({ size: 5.5 }));
});

// ---------- 저장 ----------

test('설정은 저장했다 다시 읽고, 잘못된 값은 기본값으로', () => {
  const store = new SaveStore(memoryStorage());
  assert.deepEqual(store.loadSettings(), DEFAULT_SETTINGS);
  store.saveSettings({ mode: 'daily', size: 9 });
  assert.deepEqual(store.loadSettings(), { mode: 'daily', size: 9 });
  store.saveSettings({ mode: 'zen', size: 6 });
  assert.deepEqual(store.loadSettings(), DEFAULT_SETTINGS);
});

test('최고 기록은 난이도마다 따로, 시간과 회전 수를 따로 겨룬다', () => {
  const store = new SaveStore(memoryStorage());
  assert.equal(store.loadBest(5), null);
  assert.deepEqual(store.recordBest(5, { time: 60, moves: 40 }), { time: true, moves: true });
  assert.deepEqual(store.recordBest(5, { time: 50, moves: 45 }), { time: true, moves: false });
  assert.deepEqual(store.recordBest(5, { time: 70, moves: 30 }), { time: false, moves: true });
  assert.deepEqual(store.recordBest(5, { time: 80, moves: 80 }), { time: false, moves: false });
  assert.deepEqual(store.loadBest(5), { time: 50, moves: 30 });
  assert.equal(store.loadBest(7), null);
  assert.deepEqual(store.recordBest(6, { time: 1, moves: 1 }), { time: false, moves: false });
  assert.deepEqual(store.recordBest(7, { time: -1, moves: 1 }), { time: false, moves: false });
  assert.equal(store.loadBest(7), null);
});

test('오늘의 퍼즐 결과는 날짜가 바뀌면 비고, 연속 일수는 하루씩 오른다', () => {
  const store = new SaveStore(memoryStorage());
  assert.equal(previousDay('2026-03-01'), '2026-02-28');
  assert.equal(previousDay('2026-01-01'), '2025-12-31');
  assert.equal(store.loadDaily('2026-10-04', 5), null);
  assert.equal(store.loadStreak('2026-10-04'), 0);

  assert.deepEqual(store.recordDaily('2026-10-04', 5, { time: 30, moves: 20 }), { first: true, streak: 1 });
  assert.deepEqual(store.recordDaily('2026-10-04', 7, { time: 90, moves: 60 }), { first: false, streak: 1 });
  // 같은 날 다시 풀면 더 빠른 쪽만 남는다
  store.recordDaily('2026-10-04', 5, { time: 40, moves: 10 });
  assert.deepEqual(store.loadDaily('2026-10-04', 5), { time: 30, moves: 20 });
  store.recordDaily('2026-10-04', 5, { time: 25, moves: 22 });
  assert.deepEqual(store.loadDaily('2026-10-04', 5), { time: 25, moves: 22 });
  assert.deepEqual(store.loadDaily('2026-10-04', 7), { time: 90, moves: 60 });

  // 다음 날: 어제 결과는 보이지 않고, 연속 일수는 아직 이어진다
  assert.equal(store.loadDaily('2026-10-05', 5), null);
  assert.equal(store.loadStreak('2026-10-05'), 1);
  assert.deepEqual(store.recordDaily('2026-10-05', 9, { time: 200, moves: 150 }), { first: true, streak: 2 });
  assert.equal(store.loadDaily('2026-10-05', 5), null);
  assert.equal(store.loadStreak('2026-10-05'), 2);

  // 하루를 거르면 끊긴다
  assert.equal(store.loadStreak('2026-10-07'), 0);
  assert.deepEqual(store.recordDaily('2026-10-07', 5, { time: 10, moves: 10 }), { first: true, streak: 1 });
});

test('망가진 저장 데이터는 무시한다', () => {
  const storage = memoryStorage({
    [BEST_KEY]: JSON.stringify({ 5: { time: -3, moves: 10 }, 7: { time: 12.5, moves: 30 }, 8: { time: 1, moves: 1 } }),
    [DAILY_KEY]: JSON.stringify({ day: 'today', results: { 5: { time: 1, moves: 1 } }, streak: 'x', lastDay: 3 }),
    [SETTINGS_KEY]: '{not json',
  });
  const store = new SaveStore(storage);
  assert.equal(store.loadBest(5), null);
  assert.deepEqual(store.loadBest(7), { time: 12.5, moves: 30 });
  assert.deepEqual(store.loadAllBest(), { 7: { time: 12.5, moves: 30 } });
  assert.deepEqual(store.loadDailyState(), { day: null, results: {}, streak: 0, lastDay: null });
  assert.deepEqual(store.loadSettings(), DEFAULT_SETTINGS);
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
  assert.equal(store.loadBest(5), null);
  assert.deepEqual(store.recordBest(5, { time: 1, moves: 1 }), { time: true, moves: true });
  assert.deepEqual(store.recordDaily('2026-10-04', 5, { time: 1, moves: 1 }), { first: true, streak: 1 });
  assert.equal(new SaveStore(null).saveSettings(DEFAULT_SETTINGS), false);
  assert.equal(new SaveStore(null).loadStreak('2026-10-04'), 0);
});
