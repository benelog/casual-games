import test from 'node:test';
import assert from 'node:assert/strict';
import { Sokoban, parseLevel, DIRS, DIR_NAMES } from '../js/game.js';
import { LEVELS } from '../js/levels.js';
import { solve, deadCells, LETTER_DIRS } from '../js/solver.js';
import { KEYS, swipeDirection, SWIPE_STEP } from '../js/controls.js';
import { SaveStore, PROGRESS_KEY, better } from '../js/save.js';

const game = (rows) => new Sokoban(parseLevel(rows));

/** 'rrd' 같은 방향 글자 순서대로 움직인다 */
function walk(g, path) {
  for (const letter of path) g.move(LETTER_DIRS[letter]);
  return g;
}

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    data,
  };
}

const SIMPLE = ['######', '#    #', '#@$ .#', '#    #', '######'];

// ---------- 지도 읽기 ----------

test('지도를 읽어 벽·목표·상자·캐릭터를 찾는다', () => {
  const level = parseLevel(['#####', '#@$.#', '# * #', '#####']);
  assert.equal(level.width, 5);
  assert.equal(level.height, 4);
  assert.equal(level.player, 1 * 5 + 1);
  assert.deepEqual(level.boxes, [1 * 5 + 2, 2 * 5 + 2]);
  assert.deepEqual(level.goals, [1 * 5 + 3, 2 * 5 + 2]);
  assert.equal(level.walls[0], 1);
  assert.equal(level.walls[level.player], 0);
  assert.equal(level.floor[level.player], 1);
});

test('목표 위 캐릭터(+)와 짧은 줄을 받아들인다', () => {
  const level = parseLevel(['####', '#+$#', '#  ##', '# $.#', '#####']);
  assert.equal(level.width, 5);
  assert.equal(level.goals.length, 2);
  assert.ok(level.goals.includes(level.player));
});

test('잘못된 지도는 예외를 던진다', () => {
  assert.throws(() => parseLevel([]), /비어/);
  assert.throws(() => parseLevel(['####', '# $.#', '####']), /캐릭터가 없다/);
  assert.throws(() => parseLevel(['#####', '#@@$.#', '#####']), /둘 이상/);
  assert.throws(() => parseLevel(['####', '#@ #', '####']), /상자가 없다/);
  assert.throws(() => parseLevel(['#####', '#@$ #', '#####']), /수가 다르다/);
  assert.throws(() => parseLevel(['#####', '#@$. ', '#####']), /뚫려/);
  assert.throws(() => parseLevel(['#####', '#@$x#', '#####']), /알 수 없는 기호/);
  assert.throws(() => parseLevel(['#######', '#@$.#$#', '#####.#', '#######']), /닿을 수 없는/);
});

// ---------- 규칙 ----------

test('빈 칸으로 걷는다', () => {
  const g = game(SIMPLE);
  assert.equal(g.move('up'), true);
  assert.deepEqual(g.xy(g.player), [1, 1]);
  assert.equal(g.moves, 1);
  assert.equal(g.pushes, 0);
  assert.equal(g.facing, 'up');
  assert.deepEqual(g.drain(), [{ type: 'move', dir: 'up', from: 13, to: 7, pushed: null }]);
  assert.deepEqual(g.drain(), []);
});

test('벽으로는 못 간다', () => {
  const g = game(SIMPLE);
  assert.equal(g.move('left'), false);
  assert.equal(g.moves, 0);
  assert.equal(g.facing, 'left');
  assert.deepEqual(g.drain(), [{ type: 'blocked', dir: 'left' }]);
  assert.equal(g.move('sideways'), false);
});

test('상자를 밀면 한 칸 밀리고 밀기 수가 는다', () => {
  const g = game(SIMPLE);
  assert.equal(g.move('right'), true);
  assert.deepEqual(g.xy(g.player), [2, 2]);
  assert.deepEqual(g.xy(g.boxes[0]), [3, 2]);
  assert.equal(g.moves, 1);
  assert.equal(g.pushes, 1);
  const [event] = g.drain();
  assert.deepEqual(event.pushed, { box: 0, from: 14, to: 15, onGoal: false, wasOnGoal: false });
  assert.equal(g.solved, false);
});

test('벽에 붙은 상자와 두 개가 겹친 상자는 못 민다', () => {
  const g = game(['######', '#@$$ #', '#   $#', '#.. .#', '######']);
  assert.equal(g.canMove('right'), false);
  assert.equal(g.move('right'), false);
  assert.equal(g.pushes, 0);
  walk(g, 'drrr'); // 오른쪽 벽에 붙은 상자를 벽 쪽으로
  assert.deepEqual(g.xy(g.player), [3, 2]);
  assert.deepEqual(g.xy(g.boxes[2]), [4, 2]);
  assert.equal(g.pushes, 0);
});

test('상자를 모두 목표에 놓으면 풀린다', () => {
  const g = game(SIMPLE);
  walk(g, 'rr');
  assert.equal(g.solved, true);
  assert.equal(g.placed, 1);
  const events = g.drain();
  assert.equal(events[1].pushed.onGoal, true);
  assert.deepEqual(events.at(-1), { type: 'solved', moves: 2, pushes: 2 });
  // 풀린 뒤에는 움직이지 않는다
  assert.equal(g.move('left'), false);
  assert.equal(g.moves, 2);
  assert.deepEqual(g.drain(), []);
});

test('목표에서 상자를 밀어내면 wasOnGoal 이 참이다', () => {
  const g = game(['#######', '#@*  .#', '#  $  #', '#######']);
  assert.equal(g.placed, 1);
  g.move('right');
  const [event] = g.drain();
  assert.equal(event.pushed.wasOnGoal, true);
  assert.equal(event.pushed.onGoal, false);
  assert.equal(g.placed, 0);
});

test('되돌리기는 걸음과 민 상자를 함께 되돌린다', () => {
  const g = game(SIMPLE);
  assert.equal(g.canUndo, false);
  assert.equal(g.undo(), false);
  walk(g, 'ur');
  g.move('up'); // 막힘: 기록에 남지 않는다
  walk(g, 'ldr');
  g.drain();
  assert.equal(g.moves, 5);
  assert.equal(g.pushes, 1);

  assert.equal(g.undo(), true);
  assert.deepEqual(g.xy(g.player), [1, 2]);
  assert.deepEqual(g.xy(g.boxes[0]), [2, 2]);
  assert.equal(g.moves, 4);
  assert.equal(g.pushes, 0);
  const [event] = g.drain();
  assert.equal(event.type, 'undo');
  assert.deepEqual(event.pulled, { box: 0, from: 15, to: 14, onGoal: false, wasOnGoal: false });

  while (g.undo());
  assert.equal(g.player, g.level.player);
  assert.deepEqual(g.boxes, g.level.boxes);
  assert.equal(g.moves, 0);
});

test('풀린 뒤에도 되돌리면 다시 움직일 수 있다', () => {
  const g = game(SIMPLE);
  walk(g, 'rr');
  assert.equal(g.solved, true);
  g.undo();
  assert.equal(g.solved, false);
  assert.equal(g.move('right'), true);
  assert.equal(g.solved, true);
});

test('무작위로 걷고 모두 되돌리면 처음 상태가 된다', () => {
  let seed = 12345;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (const { map } of LEVELS.slice(0, 12)) {
    const g = game(map);
    let made = 0;
    for (let i = 0; i < 300; i++) if (g.move(DIR_NAMES[Math.floor(random() * 4)])) made++;
    assert.equal(g.moves, made);
    assert.equal(g.history.length, made);
    // 상자와 boxAt 이 어긋나지 않는다
    assert.equal(g.boxAt.size, g.boxes.length);
    g.boxes.forEach((cell, id) => assert.equal(g.boxAt.get(cell), id));
    while (g.undo());
    assert.equal(g.player, g.level.player);
    assert.deepEqual(g.boxes, g.level.boxes);
    assert.equal(g.moves, 0);
    assert.equal(g.pushes, 0);
  }
});

test('다시 시작하면 처음 상태가 되고, 이미 처음이면 아무 일도 없다', () => {
  const g = game(SIMPLE);
  assert.equal(g.restart(), false);
  walk(g, 'ur');
  g.drain();
  assert.equal(g.restart(), true);
  assert.equal(g.player, g.level.player);
  assert.deepEqual(g.boxes, g.level.boxes);
  assert.equal(g.moves, 0);
  assert.equal(g.canUndo, false);
  assert.deepEqual(g.drain(), [{ type: 'restart' }]);
});

// ---------- 풀이기 ----------

test('풀이기: 풀이대로 걸으면 풀린다', () => {
  const level = parseLevel(['  ####', '###  #', '#. $ #', '#  $@#', '#.   #', '######']);
  const solution = solve(level);
  assert.ok(solution);
  const g = walk(new Sokoban(level), solution.path);
  assert.equal(g.solved, true);
  assert.equal(g.pushes, solution.pushes);
});

test('풀이기: 풀 수 없는 레벨은 null', () => {
  // 상자가 구석에 있다
  assert.equal(solve(parseLevel(['#####', '#$ .#', '#  @#', '#####'])), null);
  // 벽에 붙은 상자를 벽을 따라서만 밀 수 있는데 목표는 그 줄에 없다
  assert.equal(solve(parseLevel(['######', '# $  #', '#@   #', '#.   #', '######'])), null);
  // 이미 풀린 상태는 빈 풀이
  assert.deepEqual(solve(parseLevel(['#####', '#@* #', '#####'])), { path: '', pushes: 0, states: 1 });
});

test('풀이기: 상태 수 한도를 넘으면 null', () => {
  assert.equal(solve(parseLevel(LEVELS.at(-1).map), { maxStates: 10 }), null);
});

test('풀이기: 구석은 죽은 칸이고 목표는 살아 있다', () => {
  const level = parseLevel(['######', '#    #', '#@$ .#', '#    #', '######']);
  const dead = deadCells(level);
  const at = (x, y) => dead[y * level.width + x];
  assert.equal(at(1, 1), 1); // 구석
  assert.equal(at(2, 1), 1); // 위쪽 벽에 붙은 줄에는 목표가 없다
  assert.equal(at(4, 2), 0); // 목표
  assert.equal(at(2, 2), 0);
  assert.equal(at(0, 0), 0); // 벽은 세지 않는다
});

// ---------- 레벨 ----------

test('레벨이 20개 이상이고 id 와 지도가 겹치지 않는다', () => {
  assert.ok(LEVELS.length >= 20);
  assert.equal(new Set(LEVELS.map((l) => l.id)).size, LEVELS.length);
  assert.equal(new Set(LEVELS.map((l) => l.map.join('\n'))).size, LEVELS.length);
});

test('모든 레벨이 올바르고 휴대폰 화면에 들어갈 크기다', () => {
  for (const { id, map } of LEVELS) {
    const level = parseLevel(map);
    assert.ok(level.width <= 10 && level.height <= 10, `레벨 ${id} 가 너무 크다`);
    assert.equal(new Sokoban(level).solved, false, `레벨 ${id} 는 처음부터 풀려 있다`);
  }
});

test('모든 레벨을 풀 수 있다 (풀이기의 풀이를 그대로 걸어 확인)', () => {
  const pushes = [];
  for (const { id, map } of LEVELS) {
    const level = parseLevel(map);
    const solution = solve(level);
    assert.ok(solution, `레벨 ${id} 를 풀 수 없다`);
    const g = new Sokoban(level);
    for (const letter of solution.path) {
      assert.equal(g.move(LETTER_DIRS[letter]), true, `레벨 ${id} 의 풀이가 막혔다`);
    }
    assert.equal(g.solved, true, `레벨 ${id} 의 풀이가 끝나도 풀리지 않았다`);
    assert.equal(g.pushes, solution.pushes);
    pushes.push(solution.pushes);
  }
  // 뒤로 갈수록 대체로 어려워진다: 앞 절반의 평균 밀기 수가 뒤 절반보다 적다
  const half = Math.floor(pushes.length / 2);
  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  assert.ok(mean(pushes.slice(0, half)) < mean(pushes.slice(half)));
  assert.ok(pushes[0] <= 3);
});

// ---------- 조작 ----------

test('키 배치: 방향키와 WASD, Z, R', () => {
  for (const [code, dir] of [['ArrowUp', 'up'], ['KeyW', 'up'], ['ArrowLeft', 'left'], ['KeyA', 'left'], ['KeyS', 'down'], ['KeyD', 'right']]) {
    assert.equal(KEYS[code], dir);
    assert.ok(DIRS[dir]);
  }
  assert.equal(KEYS.KeyZ, 'undo');
  assert.equal(KEYS.KeyR, 'restart');
});

test('스와이프: 많이 간 축을 따르고 짧으면 무시한다', () => {
  assert.equal(swipeDirection(SWIPE_STEP - 1, 0), null);
  assert.equal(swipeDirection(5, -5), null);
  assert.equal(swipeDirection(SWIPE_STEP, 0), 'right');
  assert.equal(swipeDirection(-60, 20), 'left');
  assert.equal(swipeDirection(10, 50), 'down');
  assert.equal(swipeDirection(-30, -50), 'up');
  assert.equal(swipeDirection(12, 0, 10), 'right');
});

// ---------- 저장 ----------

const IDS = [1, 2, 3];

test('저장: 처음에는 기록이 없다', () => {
  const store = new SaveStore(fakeStorage(), IDS);
  assert.deepEqual(store.load(), { best: {}, last: null });
  assert.equal(store.loadBest(1), null);
  assert.equal(store.solvedCount(), 0);
  assert.equal(store.nextUnsolved(), 1);
});

test('저장: 처음 깬 기록과 더 좋은 기록만 남긴다', () => {
  const storage = fakeStorage();
  const store = new SaveStore(storage, IDS);
  assert.deepEqual(store.record(1, { moves: 20, pushes: 6 }), { first: true, improved: true, previous: null });
  assert.deepEqual(store.loadBest(1), { moves: 20, pushes: 6 });
  // 더 나쁜 기록
  assert.deepEqual(store.record(1, { moves: 25, pushes: 5 }), {
    first: false,
    improved: false,
    previous: { moves: 20, pushes: 6 },
  });
  assert.deepEqual(store.loadBest(1), { moves: 20, pushes: 6 });
  // 이동 수가 같으면 밀기 수가 적은 쪽
  assert.equal(store.record(1, { moves: 20, pushes: 5 }).improved, true);
  assert.equal(store.record(1, { moves: 18, pushes: 9 }).improved, true);
  assert.deepEqual(store.loadBest(1), { moves: 18, pushes: 9 });
  assert.equal(store.solvedCount(), 1);
  assert.deepEqual(JSON.parse(storage.data.get(PROGRESS_KEY)).best, { 1: { moves: 18, pushes: 9 } });
});

test('저장: better 는 이동 수, 그다음 밀기 수를 본다', () => {
  assert.equal(better({ moves: 5, pushes: 5 }, null), true);
  assert.equal(better({ moves: 5, pushes: 5 }, { moves: 6, pushes: 1 }), true);
  assert.equal(better({ moves: 5, pushes: 4 }, { moves: 5, pushes: 5 }), true);
  assert.equal(better({ moves: 5, pushes: 5 }, { moves: 5, pushes: 5 }), false);
});

test('저장: 다음에 할 레벨과 마지막 레벨', () => {
  const store = new SaveStore(fakeStorage(), IDS);
  store.record(1, { moves: 3, pushes: 2 });
  assert.equal(store.nextUnsolved(), 2);
  assert.equal(store.saveLast(2), true);
  assert.equal(store.load().last, 2);
  assert.equal(store.saveLast(99), false);
  store.record(2, { moves: 3, pushes: 2 });
  store.record(3, { moves: 3, pushes: 2 });
  assert.equal(store.nextUnsolved(), 2); // 다 깼으면 마지막으로 하던 레벨
  assert.equal(store.solvedCount(), 3);
});

test('저장: 잘못된 데이터와 없는 레벨의 기록은 버린다', () => {
  const broken = fakeStorage({ [PROGRESS_KEY]: '{not json' });
  assert.deepEqual(new SaveStore(broken, IDS).load(), { best: {}, last: null });

  const mixed = fakeStorage({
    [PROGRESS_KEY]: JSON.stringify({
      best: { 1: { moves: 10, pushes: 3 }, 2: { moves: -1, pushes: 0 }, 3: { moves: 4, pushes: 9 }, 77: { moves: 5, pushes: 2 } },
      last: 77,
    }),
  });
  const store = new SaveStore(mixed, IDS);
  assert.deepEqual(store.load(), { best: { 1: { moves: 10, pushes: 3 } }, last: null });
  assert.deepEqual(store.record(77, { moves: 5, pushes: 2 }), { first: false, improved: false, previous: null });
  assert.equal(store.record(1, { moves: 0, pushes: 0 }).improved, false);
});

test('저장: storage 가 없거나 예외를 던져도 게임은 계속된다', () => {
  const none = new SaveStore(null, IDS);
  assert.deepEqual(none.load(), { best: {}, last: null });
  assert.equal(none.record(1, { moves: 3, pushes: 2 }).first, true);
  assert.equal(none.saveLast(1), false);

  const throwing = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('quota');
    },
  };
  const store = new SaveStore(throwing, IDS);
  assert.deepEqual(store.load(), { best: {}, last: null });
  assert.equal(store.record(1, { moves: 3, pushes: 2 }).improved, true);
  assert.equal(store.nextUnsolved(), 1);
});
