import test from 'node:test';
import assert from 'node:assert/strict';
import { Connect6Game, SIZE, CELLS, EMPTY, indexOf, longestLine, stonesForTurn } from '../js/game.js';
import { chooseTurn, Position, evaluate, candidates, WINDOWS, CELL_WINDOWS, LEVELS, LEVEL_IDS, WIN } from '../js/ai.js';
import { SaveStore, SETTINGS_KEY, RECORD_KEY, DEFAULT_SETTINGS } from '../js/save.js';
import { createRng } from '../../shared/util.js';

const at = (row, col) => indexOf(row, col);

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

/** 주어진 칸들에 차례대로 둔다 (규칙대로 흑 1, 백 2, 흑 2 …) */
function play(game, moves) {
  for (const [row, col] of moves) game.place(at(row, col));
  return game;
}

/** 흑·백 돌을 직접 놓은 판 (차례와 상관없이 AI 를 시험할 때) */
function boardOf(black, white) {
  const cells = new Int8Array(CELLS).fill(EMPTY);
  for (const [row, col] of black) cells[at(row, col)] = 0;
  for (const [row, col] of white) cells[at(row, col)] = 1;
  return cells;
}

// ---------- 차례 ----------

test('흑이 첫 차례에 1개, 그 뒤로는 번갈아 2개씩 둔다', () => {
  const game = new Connect6Game({ mode: 'versus' });
  assert.equal(stonesForTurn(0), 1);
  assert.equal(stonesForTurn(1), 2);
  assert.equal(game.current, 0);
  assert.equal(game.perTurn, 1);
  assert.equal(game.remaining, 1);
  let r = game.place(at(9, 9));
  assert.equal(r.turnEnded, true);
  assert.equal(game.current, 1);
  assert.equal(game.perTurn, 2);
  assert.equal(game.remaining, 2);
  r = game.place(at(8, 8));
  assert.equal(r.turnEnded, false);
  assert.equal(game.current, 1);
  assert.equal(game.remaining, 1);
  assert.deepEqual(game.placed, [at(8, 8)]);
  r = game.place(at(8, 9));
  assert.equal(r.turnEnded, true);
  assert.equal(r.next, 0);
  assert.equal(game.current, 0);
  assert.equal(game.remaining, 2);
  assert.deepEqual(game.lastTurn, { team: 1, moves: [at(8, 8), at(8, 9)] });
  play(game, [
    [10, 10],
    [11, 11],
  ]);
  assert.equal(game.current, 1);
  assert.equal(game.count(0), 3);
  assert.equal(game.count(1), 2);
  assert.equal(game.turns.length, 3);
});

test('빈 칸에만 둘 수 있다', () => {
  const game = new Connect6Game();
  game.place(at(9, 9));
  assert.equal(game.canPlace(at(9, 9)), false);
  assert.throws(() => game.place(at(9, 9)));
  assert.throws(() => game.place(-1));
  assert.throws(() => game.place(CELLS));
  assert.equal(game.canPlace(at(0, 0)), true);
});

// ---------- 6목 판정 ----------

test('가로·세로·대각선 6목이면 이기고, 이긴 줄을 알려 준다', () => {
  const lines = {
    가로: (k) => [3, 2 + k],
    세로: (k) => [4 + k, 15],
    '↘ 대각선': (k) => [10 + k, 1 + k],
    '↙ 대각선': (k) => [2 + k, 17 - k],
  };
  for (const [name, cell] of Object.entries(lines)) {
    const cells = new Int8Array(CELLS).fill(EMPTY);
    for (let k = 0; k < 6; k++) cells[at(...cell(k))] = 0;
    const line = longestLine(cells, at(...cell(2)));
    assert.equal(line.length, 6, name);
    assert.deepEqual(line.cells, [0, 1, 2, 3, 4, 5].map((k) => at(...cell(k))), name);
  }
});

test('흑이 6목을 만들면 그 수에서 바로 끝난다 (차례 중간이라도)', () => {
  const game = new Connect6Game({ mode: 'versus' });
  // 흑: (9,9) → (9,10)(9,11) → (9,12)(9,13) → (9,14) 로 6목. 백은 멀리 둔다
  play(game, [
    [9, 9],
    [0, 0],
    [0, 2],
    [9, 10],
    [9, 11],
    [0, 4],
    [0, 6],
    [9, 12],
    [9, 13],
    [0, 8],
    [0, 10],
  ]);
  assert.equal(game.over, false);
  const r = game.place(at(9, 14));
  assert.equal(r.win, true);
  assert.equal(game.over, true);
  assert.equal(game.winner, 0);
  assert.equal(game.reason, 'six');
  assert.deepEqual(game.line, [9, 10, 11, 12, 13, 14].map((c) => at(9, c)));
  assert.equal(game.remaining, 0);
  assert.equal(game.canPlace(at(5, 5)), false);
  assert.throws(() => game.place(at(5, 5)));
});

test('5목은 이기지 않는다', () => {
  const game = new Connect6Game({ mode: 'versus' });
  play(game, [
    [9, 9],
    [3, 0],
    [3, 1],
    [10, 9],
    [11, 9],
    [3, 2],
    [3, 3],
    [12, 9],
    [13, 9],
    [3, 4],
  ]);
  assert.equal(longestLine(game.cells, at(13, 9)).length, 5);
  assert.equal(longestLine(game.cells, at(3, 4)).length, 5);
  assert.equal(game.over, false);
  assert.equal(game.current, 1);
});

test('장목(7개 이상)도 이긴다', () => {
  const game = new Connect6Game({ mode: 'versus' });
  // 흑 ●●●_●●● 를 만든 뒤 가운데를 채우면 7목. 백은 한 칸씩 띄워 둔다
  play(game, [
    [5, 3],
    [0, 0],
    [0, 2],
    [5, 4],
    [5, 5],
    [0, 4],
    [0, 6],
    [5, 7],
    [5, 8],
    [0, 8],
    [0, 10],
    [5, 9],
  ]);
  assert.equal(game.over, false);
  const r = game.place(at(5, 6));
  assert.equal(r.win, true);
  assert.equal(game.winner, 0);
  assert.equal(game.reason, 'long');
  assert.deepEqual(game.line, [3, 4, 5, 6, 7, 8, 9].map((c) => at(5, c)));
});

test('판이 다 차도록 6목이 없으면 무승부다', () => {
  const game = new Connect6Game({ mode: 'versus' });
  // 두 칸씩 엇갈린 무늬: 어느 방향으로도 같은 색이 3개 넘게 이어지지 않는다. 흑 181, 백 180
  const color = (row, col) => (Math.floor(col / 2) + row) % 2;
  const queues = [[], []];
  for (let row = 0; row < SIZE; row++) for (let col = 0; col < SIZE; col++) queues[color(row, col)].push(at(row, col));
  assert.equal(queues[0].length, 181);
  assert.equal(queues[1].length, 180);
  let last;
  while (!game.over) last = game.place(queues[game.current].shift());
  assert.equal(game.stones, CELLS);
  assert.equal(last.draw, true);
  assert.equal(game.winner, null);
  assert.equal(game.reason, 'full');
  assert.equal(game.turns.length, 181);
});

// ---------- 무르기 ----------

test('무르기: 차례 중간이면 이번 차례 돌을, 아니면 앞 차례 전체를 거둔다', () => {
  const game = new Connect6Game({ mode: 'versus' });
  assert.equal(game.canUndo, false);
  assert.equal(game.undo(), null);
  play(game, [
    [9, 9],
    [8, 8],
    [8, 9],
    [10, 10],
  ]);
  // 흑이 둘째 차례에 하나만 둔 상태
  assert.equal(game.current, 0);
  assert.equal(game.remaining, 1);
  let undone = game.undo();
  assert.deepEqual(undone, { team: 0, moves: [at(10, 10)] });
  assert.equal(game.cells[at(10, 10)], EMPTY);
  assert.equal(game.current, 0);
  assert.equal(game.remaining, 2);
  // 백의 차례 전체
  undone = game.undo();
  assert.deepEqual(undone, { team: 1, moves: [at(8, 8), at(8, 9)] });
  assert.equal(game.current, 1);
  assert.equal(game.remaining, 2);
  assert.equal(game.stones, 1);
  // 흑의 첫 수
  undone = game.undo();
  assert.deepEqual(undone, { team: 0, moves: [at(9, 9)] });
  assert.equal(game.current, 0);
  assert.equal(game.perTurn, 1);
  assert.equal(game.stones, 0);
  assert.equal(game.canUndo, false);
});

test('무르기: 이긴 수를 무르면 판이 다시 이어진다', () => {
  const game = new Connect6Game({ mode: 'versus' });
  play(game, [
    [9, 9],
    [0, 0],
    [0, 2],
    [9, 10],
    [9, 11],
    [0, 4],
    [0, 6],
    [9, 12],
    [9, 13],
    [0, 8],
    [0, 10],
    [9, 14],
  ]);
  assert.equal(game.over, true);
  const undone = game.undo();
  assert.deepEqual(undone, { team: 0, moves: [at(9, 14)] });
  assert.equal(game.over, false);
  assert.equal(game.winner, null);
  assert.equal(game.line, null);
  assert.equal(game.current, 0);
  assert.equal(game.remaining, 2);
  game.place(at(18, 18));
  game.place(at(18, 16));
  assert.equal(game.current, 1);
  assert.equal(game.over, false);
});

// ---------- 컴퓨터 ----------

test('창: 6칸짜리 창이 924개이고, 칸마다 많아야 24개 창에 든다', () => {
  assert.equal(WINDOWS.length, 2 * 19 * 14 + 2 * 14 * 14);
  assert.equal(Math.max(...CELL_WINDOWS.map((list) => list.length)), 24);
  assert.equal(CELL_WINDOWS[at(0, 0)].length, 3);
  const pos = new Position(boardOf([[9, 9]], [[9, 10]]));
  pos.place(at(9, 8), 0);
  pos.remove(at(9, 8));
  assert.deepEqual(pos, new Position(boardOf([[9, 9]], [[9, 10]])));
});

test('첫 수는 천원에 둔다', () => {
  for (const level of LEVEL_IDS) {
    assert.deepEqual(chooseTurn(new Connect6Game().cells, 0, 1, level, createRng(1)), [at(9, 9)]);
  }
});

test('컴퓨터는 빈 칸에만, 이번 차례 돌 수만큼 서로 다르게 둔다', () => {
  for (const level of LEVEL_IDS) {
    const game = new Connect6Game({ mode: 'versus' });
    const rng = createRng(7);
    for (let turn = 0; turn < 24 && !game.over; turn++) {
      const count = game.remaining;
      const moves = chooseTurn(game.cells, game.current, count, level, rng);
      assert.equal(moves.length, count, level);
      assert.equal(new Set(moves).size, count, level);
      for (const index of moves) {
        assert.ok(Number.isInteger(index) && index >= 0 && index < CELLS, level);
        assert.equal(game.cells[index], EMPTY, level);
      }
      for (const index of moves) if (!game.over) game.place(index);
    }
  }
});

test('이길 수 있으면 바로 6목을 만든다 (4개 + 두 돌, 5개 + 한 돌)', () => {
  // 백 ○○_○○_ 같은 줄: 빈 두 칸을 채우면 6목. 흑은 위협이 될 만한 돌을 여기저기 둔다
  const four = boardOf(
    [
      [12, 3],
      [12, 4],
      [12, 5],
      [3, 15],
    ],
    [
      [6, 4],
      [6, 5],
      [6, 7],
      [6, 8],
    ],
  );
  for (const level of LEVEL_IDS) {
    const moves = chooseTurn(four, 1, 2, level, createRng(3));
    const pos = new Position(four);
    for (const i of moves) pos.place(i, 1);
    assert.ok(pos.won(1), `${level}: ${moves}`);
  }
  // 흑 다섯 개가 한쪽이 막힌 채 이어져 있고 한 돌만 남았다
  const five = boardOf(
    [
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
      [6, 6],
    ],
    [
      [1, 1],
      [9, 3],
      [9, 4],
      [9, 5],
      [9, 6],
    ],
  );
  for (const level of LEVEL_IDS) assert.deepEqual(chooseTurn(five, 0, 1, level, createRng(5)), [at(7, 7)], level);
});

test('상대의 6목 위협(막히지 않은 4개)은 두 돌로 막는다', () => {
  // 흑이 가로로 4개, 양쪽이 비어 있다. 백은 이길 수 없으니 막아야 한다
  const cells = boardOf(
    [
      [9, 6],
      [9, 7],
      [9, 8],
      [9, 9],
      [3, 3],
    ],
    [
      [10, 10],
      [11, 11],
    ],
  );
  for (const level of LEVEL_IDS) {
    const moves = chooseTurn(cells, 1, 2, level, createRng(11));
    const pos = new Position(cells);
    for (const i of moves) pos.place(i, 1);
    // 막은 뒤에는 흑이 두 돌로 6목을 만들 창이 없다
    assert.equal(pos.liveWindows(0, 4).length, 0, `${level}: ${moves}`);
    assert.ok(evaluate(pos, 1) > -WIN / 2, level);
  }
});

test('막을 수 없으면 덜 나쁜 수라도 두고, 이길 수 있으면 막기보다 이긴다', () => {
  // 백도 흑도 4개씩: 백 차례면 막지 않고 이긴다
  const cells = boardOf(
    [
      [9, 6],
      [9, 7],
      [9, 8],
      [9, 9],
    ],
    [
      [3, 3],
      [4, 3],
      [5, 3],
      [6, 3],
    ],
  );
  const moves = chooseTurn(cells, 1, 2, 'easy', createRng(2));
  const pos = new Position(cells);
  for (const i of moves) pos.place(i, 1);
  assert.ok(pos.won(1), String(moves));
});

test('실력 표와 후보 칸', () => {
  assert.deepEqual(LEVEL_IDS, ['easy', 'normal', 'hard']);
  assert.ok(LEVELS.hard.candidates > LEVELS.easy.candidates);
  const pos = new Position(boardOf([[9, 9]], [[9, 10]]));
  const list = candidates(pos, 0, 10);
  assert.equal(list.length, 10);
  for (const i of list) assert.equal(pos.cells[i], EMPTY);
});

test('어려움의 한 차례 계산은 오래 걸리지 않는다', () => {
  const game = new Connect6Game({ mode: 'versus' });
  const rng = createRng(4);
  let worst = 0;
  for (let turn = 0; turn < 20 && !game.over; turn++) {
    const t0 = performance.now();
    const moves = chooseTurn(game.cells, game.current, game.remaining, 'hard', rng);
    worst = Math.max(worst, performance.now() - t0);
    for (const index of moves) if (!game.over) game.place(index);
  }
  assert.ok(worst < 250, `${worst.toFixed(1)}ms`);
});

test('어려움은 쉬움을 대체로 이긴다', () => {
  let wins = 0;
  for (let seed = 1; seed <= 4; seed++) {
    for (const hardTeam of [0, 1]) {
      const game = new Connect6Game({ mode: 'versus' });
      const rng = createRng(seed);
      while (!game.over) {
        const level = game.current === hardTeam ? 'hard' : 'easy';
        for (const index of chooseTurn(game.cells, game.current, game.remaining, level, rng)) if (!game.over) game.place(index);
      }
      if (game.winner === hardTeam) wins++;
    }
  }
  assert.ok(wins >= 6, `${wins}/8`);
});

// ---------- 저장 ----------

test('설정은 검증해서 읽고, 잘못된 값은 기본값으로 바꾼다', () => {
  const store = new SaveStore(memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ opponent: 'x', level: 'hard', color: 'white', view: 'top', sound: 'no' }) }));
  assert.deepEqual(store.loadSettings(), { ...DEFAULT_SETTINGS, level: 'hard', color: 'white', view: 'top' });
  assert.deepEqual(new SaveStore(memoryStorage({ [SETTINGS_KEY]: '{' })).loadSettings(), DEFAULT_SETTINGS);
  assert.deepEqual(new SaveStore(null).loadSettings(), DEFAULT_SETTINGS);
  const saved = new SaveStore(memoryStorage());
  saved.saveSettings({ ...DEFAULT_SETTINGS, opponent: 'versus' });
  assert.equal(saved.loadSettings().opponent, 'versus');
});

test('컴퓨터 상대 전적은 실력마다 승·패·무를 따로 센다', () => {
  const storage = memoryStorage();
  const store = new SaveStore(storage);
  assert.equal(store.loadRecord('hard'), null);
  store.recordResult('hard', 'win');
  store.recordResult('hard', 'loss');
  store.recordResult('hard', 'draw');
  store.recordResult('hard', 'win');
  store.recordResult('easy', 'loss');
  assert.equal(store.recordResult('legend', 'win'), null);
  assert.equal(store.recordResult('easy', 'maybe'), null);
  assert.deepEqual(store.loadRecord('hard'), { wins: 2, losses: 1, draws: 1 });
  assert.deepEqual(store.loadRecord('easy'), { wins: 0, losses: 1, draws: 0 });
  // 깨진 항목은 버리고, 무승부가 없던 옛 형식도 읽는다
  storage.setItem(RECORD_KEY, JSON.stringify({ normal: { wins: 3, losses: 1 }, hard: { wins: -1, losses: 0 } }));
  assert.deepEqual(store.loadAllRecords(), { normal: { wins: 3, losses: 1, draws: 0 } });
});
