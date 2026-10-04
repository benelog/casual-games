import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Board,
  Match,
  WIDTH,
  VISIBLE,
  HEIGHT,
  SPAWN_X,
  EMPTY,
  GARBAGE,
  LOCK_DELAY,
  TARGET_POINTS,
  MAX_GARBAGE_DROP,
  ALL_CLEAR_BONUS,
  at,
  createGrid,
  createRng,
  columnHeight,
  dropCells,
  findGroups,
  garbageBeside,
  popScore,
  collapse,
  resolveAll,
  fallTime,
  fallIntervalAt,
  targetPointsAt,
} from '../js/game.js';
import { AiPlayer, LEVELS, placements, simulate, potential, choose } from '../js/ai.js';
import { SaveStore, RECORD_KEY, SETTINGS_KEY, DEFAULT_SETTINGS } from '../js/save.js';

/** 아래 줄부터 적은 그림으로 판을 만든다. 글자: . 빈칸, 1~5 과일, # 코코넛. 맨 아래 줄이 마지막 */
function gridFrom(rows) {
  const grid = createGrid();
  rows
    .slice()
    .reverse()
    .forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (ch !== '.') grid[at(x, y)] = ch === '#' ? GARBAGE : Number(ch);
      });
    });
  return grid;
}

// 둘째 줄 위에 1 둘을 놓으면 2연쇄가 나는 판
const CHAIN_SETUP = ['2.....', '2.....', '11....', '23....', '23....'];

/** 정해 둔 짝만 차례로 주는 공급원 */
const fixedSource = (pairs) => ({ pairAt: (n) => pairs[n % pairs.length] });

/** 판 하나를 혼자 돌린다. link 로 보낸 코코넛을 기록한다 */
function soloBoard(pairs = [[1, 2]], rows = []) {
  const sent = [];
  let ended = 0;
  const board = new Board({
    source: fixedSource(pairs),
    rng: createRng(1),
    link: { send: (n) => sent.push(n), chainEnd: () => ended++ },
  });
  board.grid.set(gridFrom(rows));
  board.start();
  return { board, sent, ended: () => ended };
}

/** 다음 짝이 나오거나 끝날 때까지 시간을 흘린다 */
function settle(board) {
  for (let i = 0; i < 2000 && board.phase === 'wait'; i++) board.update(0.02);
}

// ---------- 판 함수 ----------

test('과일은 자기 줄 바닥까지 떨어지고, 아래 것이 먼저 놓인다', () => {
  const grid = gridFrom(['1.....']);
  const placed = dropCells(grid, [
    { x: 0, y: 9, color: 3 },
    { x: 0, y: 8, color: 2 },
    { x: 4, y: 8, color: 4 },
  ]);
  assert.equal(grid[at(0, 1)], 2);
  assert.equal(grid[at(0, 2)], 3);
  assert.equal(grid[at(4, 0)], 4);
  assert.deepEqual(
    placed.map((c) => [c.x, c.y, c.from]),
    [
      [0, 1, 8],
      [4, 0, 8],
      [0, 2, 9],
    ],
  );
});

test('숨은 줄 위로 넘치는 과일은 사라진다', () => {
  const grid = createGrid();
  for (let y = 0; y < HEIGHT; y++) grid[at(0, y)] = 1 + (y % 2);
  const placed = dropCells(grid, [{ x: 0, y: HEIGHT, color: 3 }]);
  assert.equal(placed[0].y, null);
  assert.equal(columnHeight(grid, 0), HEIGHT);
});

test('같은 과일 4개 이상이 상하좌우로 이어져야 묶음이다', () => {
  assert.equal(findGroups(gridFrom(['111...', '1222..'])).length, 1); // ㄱ 자로 이어진 1
  assert.equal(findGroups(gridFrom(['111.1.'])).length, 0); // 끊겨 있다
  assert.equal(findGroups(gridFrom(['1.....', '.1....', '1.....', '.1....'])).length, 0); // 대각선은 아니다
  assert.equal(findGroups(gridFrom(['####..'])).length, 0); // 코코넛끼리는 터지지 않는다
  const two = findGroups(gridFrom(['1111..', '2222..']));
  assert.deepEqual(two.map((g) => g.length).sort(), [4, 4]);
});

test('숨은 줄에 있는 과일은 묶음에 들지 않는다', () => {
  const grid = createGrid();
  for (let y = VISIBLE - 3; y < HEIGHT; y++) grid[at(0, y)] = 1; // 보이는 줄 3개 + 숨은 줄 1개
  assert.equal(findGroups(grid).length, 0);
  grid[at(1, VISIBLE - 1)] = 1;
  assert.equal(findGroups(grid)[0].length, 4);
});

test('터지는 묶음 옆의 코코넛을 찾는다', () => {
  const grid = gridFrom(['.#....', '1111#.', '#.#..#']);
  const groups = findGroups(grid);
  const beside = garbageBeside(grid, groups).sort((a, b) => a - b);
  assert.deepEqual(beside, [at(0, 0), at(2, 0), at(4, 1), at(1, 2)].sort((a, b) => a - b));
});

test('점수: 4개 한 묶음은 40점, 연쇄·여러 과일·큰 묶음에 덤이 붙는다', () => {
  const four = gridFrom(['1111..']);
  assert.equal(popScore(four, findGroups(four), 1), 40);
  assert.equal(popScore(four, findGroups(four), 2), 40 * 8);
  assert.equal(popScore(four, findGroups(four), 3), 40 * 16);
  const five = gridFrom(['11111.']);
  assert.equal(popScore(five, findGroups(five), 1), 50 * 2);
  const twoColors = gridFrom(['1111..', '2222..']);
  assert.equal(popScore(twoColors, findGroups(twoColors), 1), 80 * 3);
});

test('빈칸 위의 과일이 내려앉는다', () => {
  const grid = gridFrom(['1.....', '......', '2.....', '3..4..']);
  grid[at(0, 0)] = EMPTY;
  const moved = collapse(grid);
  assert.deepEqual([grid[at(0, 0)], grid[at(0, 1)], grid[at(0, 2)]], [2, 1, 0]);
  assert.equal(moved.length, 2);
  assert.deepEqual(moved[0], { x: 0, y: 0, from: 1, color: 2 });
});

test('resolveAll 은 연쇄를 끝까지 풀고 코코넛도 지운다', () => {
  const simple = gridFrom(['2.....', '2.....', '2.....', '1111..', '2#....']);
  const r = resolveAll(simple);
  assert.equal(r.chain, 2);
  assert.equal(r.popped, 8);
  assert.equal(r.score, 40 + 320);
  assert.equal(simple[at(1, 0)], EMPTY, '옆에서 터진 코코넛도 사라진다');
});

test('떨어지는 시간은 거리에 따라 늘고, 시간이 갈수록 게임이 빨라진다', () => {
  assert.ok(fallTime(0) < fallTime(1));
  assert.ok(fallTime(1) < fallTime(12));
  assert.ok(fallTime(13) < 0.7);
  assert.ok(fallIntervalAt(0) > fallIntervalAt(120));
  assert.equal(fallIntervalAt(1e6), 0.22);
  assert.equal(targetPointsAt(0), TARGET_POINTS);
  assert.ok(targetPointsAt(100) < TARGET_POINTS);
  assert.ok(targetPointsAt(1e6) >= 14);
});

// ---------- 짝 조작 ----------

test('짝은 셋째 줄 맨 위에서 세로로 나온다', () => {
  const { board } = soloBoard([[1, 2]]);
  assert.deepEqual({ ...board.pair, id: 0 }, { id: 0, colors: [1, 2], x: SPAWN_X, y: VISIBLE - 1, rot: 0 });
  assert.equal(board.phase, 'control');
  assert.deepEqual(board.preview(2), [
    [1, 2],
    [1, 2],
  ]);
});

test('옮기기는 벽과 쌓인 과일에 막힌다', () => {
  const { board } = soloBoard();
  assert.equal(board.move(-1), true);
  assert.equal(board.move(-1), true);
  assert.equal(board.move(-1), false);
  assert.equal(board.pair.x, 0);
  for (let i = 0; i < WIDTH - 1; i++) board.move(1);
  assert.equal(board.pair.x, WIDTH - 1);
  assert.equal(board.move(1), false);
});

test('돌리기: 시계 방향으로 네 번이면 제자리, 벽에 붙어 있으면 밀려난다', () => {
  const { board } = soloBoard();
  board.softDrop();
  board.softDrop();
  const { x, y } = board.pair;
  for (let i = 0; i < 4; i++) assert.equal(board.rotate(1), true);
  assert.deepEqual([board.pair.x, board.pair.y, board.pair.rot], [x, y, 0]);
  assert.equal(board.rotate(-1), true);
  assert.equal(board.pair.rot, 3);
  board.rotate(1);

  // 오른쪽 벽에 붙어 시계 방향으로 돌리면 왼쪽으로 한 칸 밀린다
  for (let i = 0; i < WIDTH; i++) board.move(1);
  assert.equal(board.rotate(1), true);
  assert.deepEqual([board.pair.x, board.pair.rot], [WIDTH - 2, 1]);
});

test('돌리기: 바닥에서 아래로 돌리면 위로 밀리고, 좁은 틈에서는 위아래가 뒤집힌다', () => {
  const { board } = soloBoard();
  while (!board.grounded) board.pair.y--;
  board.rotate(1); // 옆으로
  assert.equal(board.rotate(1), true); // 아래로: 바닥이라 축이 올라간다
  assert.deepEqual([board.pair.y, board.pair.rot], [1, 2]);

  const narrow = soloBoard([[1, 2]], ['12.34.', '12.34.', '12.34.']).board;
  while (!narrow.grounded) narrow.pair.y--;
  assert.equal(narrow.rotate(1), true);
  assert.equal(narrow.pair.rot, 2, '양옆이 막혀 반 바퀴 돈다');
  assert.equal(narrow.pair.x, SPAWN_X);
});

test('가만히 두면 떨어지다가 바닥에서 잠시 뒤 굳는다', () => {
  const { board } = soloBoard();
  board.fallInterval = 0.1;
  for (let i = 0; i < 200 && board.phase === 'control' && !board.grounded; i++) board.update(0.05);
  assert.equal(board.pair.y, 0);
  board.update(LOCK_DELAY - 0.01);
  assert.equal(board.phase, 'control');
  board.update(0.02);
  assert.equal(board.phase, 'wait');
  assert.equal(board.get(SPAWN_X, 0), 1);
  assert.equal(board.get(SPAWN_X, 1), 2);
  settle(board);
  assert.equal(board.phase, 'control');
  assert.equal(board.pair.id, 2);
});

test('바닥에서 움직이면 굳는 시간이 늦춰지지만 끝없이는 아니다', () => {
  const { board } = soloBoard();
  while (!board.grounded) board.pair.y--;
  let moves = 0;
  for (let i = 0; i < 200 && board.phase === 'control'; i++) {
    board.update(LOCK_DELAY * 0.8);
    if (board.phase === 'control') {
      board.move(i % 2 ? 1 : -1);
      moves++;
    }
  }
  assert.equal(board.phase, 'wait');
  assert.ok(moves >= 8 && moves < 20, `moves = ${moves}`);
});

test('옆으로 누운 짝을 놓으면 받침 없는 쪽은 더 떨어진다', () => {
  const { board } = soloBoard([[1, 2]], ['..3...', '..3...']);
  board.rotate(1); // 2 가 오른쪽
  board.hardDrop();
  assert.equal(board.get(2, 2), 1);
  assert.equal(board.get(3, 0), 2);
  const lock = board.drain().find((e) => e.type === 'lock');
  assert.deepEqual(lock.cells.map((c) => c.from - c.y).sort(), [0, 2]);
});

test('떨어질 자리는 실제로 놓이는 자리와 같다', () => {
  const { board } = soloBoard([[1, 2]], ['..3...', '..3...']);
  board.rotate(1);
  const landing = board.landing().map((c) => [c.x, c.y, c.color]);
  board.hardDrop();
  for (const [x, y, color] of landing) assert.equal(board.get(x, y), color);
});

// ---------- 터뜨리기와 공격 ----------

test('넷이 이어지면 터지고 점수가 오른다', () => {
  const { board, sent, ended } = soloBoard([[1, 1]], ['..1...', '..1...']);
  board.hardDrop();
  settle(board);
  const events = board.drain();
  const pop = events.find((e) => e.type === 'pop');
  assert.equal(pop.chain, 1);
  assert.equal(pop.cells.length, 4);
  assert.equal(board.grid.every((v) => v === EMPTY), true);
  assert.equal(board.maxChain, 1);
  assert.equal(ended(), 1);
  assert.deepEqual(sent, [], '40점으로는 코코넛을 못 보낸다');
  assert.equal(board.leftover, 40);
  assert.equal(events.find((e) => e.type === 'chainEnd').allClear, true);
  assert.equal(board.bonus, ALL_CLEAR_BONUS);
});

test('연쇄가 이어지면 코코넛을 보낸다', () => {
  // 둘째 줄에 1 둘을 세워 놓으면 1 넷이 터지고, 첫째 줄의 2 가 내려와 2 넷이 된다
  const { board, sent } = soloBoard([[1, 1]], CHAIN_SETUP);
  board.move(-1);
  board.hardDrop();
  settle(board);
  const pops = board.drain().filter((e) => e.type === 'pop');
  assert.deepEqual(
    pops.map((e) => e.chain),
    [1, 2],
  );
  assert.equal(board.maxChain, 2);
  // 40 + 320 = 360점 → 코코넛 5개, 10점 남는다
  assert.deepEqual(sent, [5]);
  assert.equal(board.sent, 5);
  assert.equal(board.leftover, 360 % TARGET_POINTS);
});

test('받을 코코넛은 내 연쇄로 먼저 지운다', () => {
  const { board, sent } = soloBoard([[1, 1]], CHAIN_SETUP);
  board.receive(2);
  board.activate();
  board.receive(1);
  assert.equal(board.incoming, 3);
  board.move(-1);
  board.hardDrop();
  settle(board);
  const pops = board.drain().filter((e) => e.type === 'pop');
  assert.equal(pops[1].offset, 3);
  assert.equal(pops[1].sent, 2);
  assert.deepEqual(sent, [2]);
  assert.equal(board.incoming, 0);
});

test('터뜨리지 못한 차례에 코코넛이 떨어진다 (한 번에 30개까지)', () => {
  const { board } = soloBoard([[1, 2]]);
  board.receive(40);
  assert.equal(board.pending, 0, '상대 연쇄가 끝나기 전에는 떨어지지 않는다');
  board.activate();
  board.move(1);
  board.hardDrop();
  settle(board);
  const garbage = board.drain().find((e) => e.type === 'garbage');
  assert.equal(garbage.amount, MAX_GARBAGE_DROP);
  assert.equal(board.pending, 10);
  assert.equal(board.grid.filter((v) => v === GARBAGE).length, 30);
  for (let x = 0; x < WIDTH; x++) assert.ok(columnHeight(board.grid, x) >= 5);
  assert.equal(board.phase, 'control');
});

test('코코넛 몇 개는 서로 다른 줄에 떨어진다', () => {
  const { board } = soloBoard([[1, 2]]);
  board.receive(4);
  board.activate();
  board.move(-2);
  board.hardDrop();
  settle(board);
  const cells = board.drain().find((e) => e.type === 'garbage').cells;
  assert.equal(cells.length, 4);
  assert.equal(new Set(cells.map((c) => c.x)).size, 4);
});

test('터뜨린 차례에는 남은 코코넛이 떨어지지 않는다', () => {
  const { board } = soloBoard([[1, 1]], ['..1...', '..1...']);
  board.receive(20);
  board.activate();
  board.hardDrop();
  settle(board);
  assert.equal(board.grid.filter((v) => v === GARBAGE).length, 0);
  assert.equal(board.pending, 20);
});

test('짝이 나오는 칸이 막히면 진다', () => {
  const { board } = soloBoard([[1, 2]]);
  for (let y = 0; y < VISIBLE - 2; y++) board.grid[at(SPAWN_X, y)] = 3 + (y % 2);
  board.hardDrop();
  settle(board);
  assert.equal(board.over, true);
  assert.equal(board.phase, 'over');
  assert.equal(board.pair, null);
  assert.equal(board.move(1), false);
  assert.ok(board.drain().some((e) => e.type === 'over'));
});

// ---------- 대전 ----------

test('두 판은 같은 순서의 짝을 받는다', () => {
  const match = new Match({ colors: 3, rng: createRng(7) });
  match.start();
  assert.deepEqual(match.boards[0].pair.colors, match.boards[1].pair.colors);
  assert.deepEqual(match.boards[0].preview(3), match.boards[1].preview(3));
  for (let n = 0; n < 200; n++) for (const color of match.pairAt(n)) assert.ok(color >= 1 && color <= 3);
  assert.throws(() => new Match({ colors: 7 }));
});

test('연쇄로 보낸 코코넛은 연쇄가 끝난 뒤 상대 판에 떨어진다', () => {
  const match = new Match({ colors: 4, rng: createRng(3) });
  match.sequence = [
    [1, 1],
    [3, 4],
    [3, 4],
  ];
  const [a, b] = match.boards;
  a.grid.set(gridFrom(CHAIN_SETUP));
  match.start();
  a.move(-1);
  a.hardDrop();
  for (let i = 0; i < 400 && a.phase === 'wait'; i++) match.update(0.02);
  assert.equal(b.pending, 5);
  assert.equal(b.queued, 0);
  b.hardDrop();
  for (let i = 0; i < 400 && b.phase === 'wait'; i++) match.update(0.02);
  assert.equal(b.grid.filter((v) => v === GARBAGE).length, 5);
  const events = match.drain();
  assert.ok(events.some((e) => e.type === 'garbage' && e.player === 1));
  assert.ok(events.some((e) => e.type === 'pop' && e.player === 0));
});

test('한쪽 판이 막히면 상대가 이긴다', () => {
  const match = new Match({ rng: createRng(5) });
  match.start();
  const loser = match.boards[1];
  for (let y = 0; y < VISIBLE - 2; y++) loser.grid[at(SPAWN_X, y)] = 1 + (y % 2);
  loser.pair.colors = [3, 4];
  loser.hardDrop();
  for (let i = 0; i < 400 && !match.over; i++) match.update(0.02);
  assert.equal(match.winner, 0);
  const time = match.time;
  match.update(1);
  assert.equal(match.time, time, '끝난 뒤에는 시간이 흐르지 않는다');
});

// ---------- 컴퓨터 ----------

test('놓을 자리: 빈 판에서는 서로 다른 짝 22가지, 같은 짝 11가지', () => {
  assert.equal(placements(createGrid(), [1, 2]).length, 22);
  assert.equal(placements(createGrid(), [1, 1]).length, 11);
  // 꼭대기까지 찬 줄 너머로는 갈 수 없다
  const walled = createGrid();
  for (let y = 0; y < VISIBLE; y++) walled[at(1, y)] = 1 + (y % 2);
  assert.ok(placements(walled, [1, 2]).every((p) => p.x >= 2));
});

test('simulate 는 원래 판을 바꾸지 않고 결과를 돌려준다', () => {
  const grid = gridFrom(['..1...', '..1...']);
  const copy = grid.slice();
  const result = simulate(grid, [1, 1], { x: 2, rot: 0 });
  assert.deepEqual(grid, copy);
  assert.equal(result.chain, 1);
  assert.equal(result.score, 40);
  assert.equal(result.dead, false);
  const sideways = simulate(grid, [3, 4], { x: 2, rot: 1 });
  assert.equal(sideways.grid[at(2, 2)], 3);
  assert.equal(sideways.grid[at(3, 0)], 4);
});

test('potential 은 하나만 더 놓으면 터지는 연쇄를 알아본다', () => {
  assert.equal(potential(createGrid(), 4), 0);
  assert.equal(potential(gridFrom(['111...']), 4), 40);
  assert.equal(potential(gridFrom(['2.....', '2.....', '2.....', '111...', '2..3..']), 4), 40 + 320);
});

test('컴퓨터는 터뜨릴 수 있으면 터뜨리고, 죽는 자리는 피한다', () => {
  const grid = gridFrom(['111...']);
  for (const id of Object.keys(LEVELS)) {
    const level = { ...LEVELS[id], noise: 0, fire: 0 };
    const place = choose({ grid, colors: [1, 2], next: [3, 4], colorCount: 4 }, level, createRng(1));
    assert.equal(simulate(grid, [1, 2], place).chain, 1, id);
  }
  const tall = createGrid();
  for (let y = 0; y < VISIBLE - 2; y++) tall[at(SPAWN_X, y)] = 1 + (y % 2);
  const place = choose({ grid: tall, colors: [3, 4], next: [3, 4], colorCount: 4 }, LEVELS.normal, createRng(1));
  assert.equal(simulate(tall, [3, 4], place).dead, false);
});

/** 컴퓨터끼리 한 판 */
function autoMatch(levelA, levelB, seed) {
  const match = new Match({ colors: 4, rng: createRng(seed) });
  const ais = [new AiPlayer(levelA, createRng(seed + 100)), new AiPlayer(levelB, createRng(seed + 200))];
  match.start();
  while (!match.over && match.time < 400) {
    ais.forEach((ai, i) => ai.update(1 / 30, match.boards[i], 4));
    match.update(1 / 30);
    match.drain();
  }
  return match;
}

test('컴퓨터끼리 겨루면 실력이 높은 쪽이 대체로 이긴다', () => {
  let normalWins = 0;
  let hardWins = 0;
  for (let seed = 1; seed <= 6; seed++) {
    if (autoMatch('easy', 'normal', seed).winner === 1) normalWins++;
    if (autoMatch('hard', 'normal', seed).winner === 0) hardWins++;
  }
  assert.ok(normalWins >= 5, `보통이 쉬움에게 ${normalWins}/6 승`);
  assert.ok(hardWins >= 5, `어려움이 보통에게 ${hardWins}/6 승`);
  assert.throws(() => new AiPlayer('godlike'));
});

// ---------- 저장 ----------

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    data,
  };
}

test('설정을 저장하고 불러온다. 잘못된 값은 기본값으로', () => {
  const storage = fakeStorage();
  const store = new SaveStore(storage);
  assert.deepEqual(store.loadSettings(), DEFAULT_SETTINGS);
  store.saveSettings({ opponent: 'friend', level: 'hard', colors: 5 });
  assert.deepEqual(new SaveStore(storage).loadSettings(), { opponent: 'friend', level: 'hard', colors: 5 });
  storage.setItem(SETTINGS_KEY, JSON.stringify({ opponent: 'alien', level: 3, colors: 9 }));
  assert.deepEqual(store.loadSettings(), DEFAULT_SETTINGS);
  storage.setItem(SETTINGS_KEY, '{깨진 JSON');
  assert.deepEqual(store.loadSettings(), DEFAULT_SETTINGS);
});

test('전적은 실력·과일 종류마다 따로 쌓인다', () => {
  const storage = fakeStorage();
  const store = new SaveStore(storage);
  const mode = { level: 'normal', colors: 4 };
  assert.equal(store.loadRecord(mode), null);
  store.recordResult(mode, { won: true, lost: false, chain: 3 });
  store.recordResult(mode, { won: false, lost: true, chain: 5 });
  store.recordResult(mode, { won: false, lost: false, chain: 2 }); // 무승부
  assert.deepEqual(store.loadRecord(mode), { wins: 1, losses: 1, bestChain: 5 });
  assert.equal(store.loadRecord({ level: 'hard', colors: 4 }), null);
  storage.setItem(RECORD_KEY, JSON.stringify({ 'normal-4': { wins: -1, losses: 'x', bestChain: 2 }, bogus: {} }));
  assert.deepEqual(store.loadAllRecords(), {});
});

test('저장소가 없거나 예외를 던져도 계속된다', () => {
  const none = new SaveStore(null);
  assert.deepEqual(none.loadSettings(), DEFAULT_SETTINGS);
  assert.equal(none.saveSettings(DEFAULT_SETTINGS), false);
  assert.deepEqual(none.recordResult({ level: 'easy', colors: 3 }, { won: true, lost: false, chain: 1 }), {
    wins: 1,
    losses: 0,
    bestChain: 1,
  });
  const broken = new SaveStore({
    getItem() {
      throw new Error('막힘');
    },
    setItem() {
      throw new Error('막힘');
    },
  });
  assert.deepEqual(broken.loadSettings(), DEFAULT_SETTINGS);
  assert.equal(broken.saveSettings(DEFAULT_SETTINGS), false);
});
