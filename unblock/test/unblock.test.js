import test from 'node:test';
import assert from 'node:assert/strict';
import { UnblockGame, parseBoard, slideRange, boardString, SIZE, GOAL_COL, TIERS, starsFor } from '../js/game.js';
import { solve, nextMove, hardestInCluster, encode, decode } from '../js/solver.js';
import { LEVELS } from '../js/levels.js';
import { dailyPuzzle, dateKey, normalize, evaluate, randomSpec, specBoard, climb, hashSeed, createRng, DAILY_RANGE } from '../js/generator.js';
import { SaveStore, PROGRESS_KEY, DAILY_KEY, UNLOCK_AHEAD, better, previousDay } from '../js/save.js';

/** 여섯 줄을 이어 36글자 판으로 */
const board = (...rows) => rows.join('');
const game = (...rows) => new UnblockGame(parseBoard(board(...rows)));
const start = (puzzle) => puzzle.pieces.map((p) => p.start);
const minMoves = (text) => {
  const puzzle = parseBoard(text);
  return solve(puzzle.pieces, start(puzzle))?.moves ?? null;
};

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    data,
  };
}

// 빨간 차 앞을 세로 트럭 B 가 막고, B 가 내려갈 자리를 가로 차 C 가 막는다: C 왼쪽, B 아래, 내 차 = 3수
const CHAIN = board('.....B', '.....B', 'AA...B', '......', '......', '....CC');

// ---------- 판 읽기 ----------

test('판을 읽어 차의 방향·길이·자리를 찾는다', () => {
  const { pieces } = parseBoard(CHAIN);
  assert.equal(pieces.length, 3);
  assert.deepEqual(pieces[0], { letter: 'A', horizontal: true, length: 2, fixed: 2, start: 0 });
  assert.deepEqual(pieces[1], { letter: 'B', horizontal: false, length: 3, fixed: 5, start: 0 });
  assert.deepEqual(pieces[2], { letter: 'C', horizontal: true, length: 2, fixed: 5, start: 4 });
  assert.equal(boardString(pieces, start({ pieces })), CHAIN);
});

test('잘못된 판은 예외를 던진다', () => {
  const empty = '.'.repeat(36);
  assert.throws(() => parseBoard('AA'), /36글자/);
  assert.throws(() => parseBoard(empty), /내 차/);
  assert.throws(() => parseBoard(board('......', '......', 'AA..x.', '......', '......', '......')), /알 수 없는/);
  assert.throws(() => parseBoard(board('......', '......', 'AAA...', '......', '......', '......')), /길이 2 차/);
  assert.throws(() => parseBoard(board('A.....', 'A.....', '......', '......', '......', '......')), /가로로/);
  assert.throws(() => parseBoard(board('......', '......', 'AA....', '......', '......', 'BBBB..')), /길이/);
  assert.throws(() => parseBoard(board('B.....', '.B....', 'AA....', '......', '......', '......')), /한 줄/);
  assert.throws(() => parseBoard(board('B.B...', '......', 'AA....', '......', '......', '......')), /한 줄/);
  // 줄을 넘어 이어지는 가로 차
  assert.throws(() => parseBoard(board('.....B', 'B.....', 'AA....', '......', '......', '......')), /한 줄/);
});

// ---------- 규칙 ----------

test('차는 다른 차나 벽에 막히기 전까지만 갈 수 있다', () => {
  const g = new UnblockGame(parseBoard(CHAIN));
  assert.deepEqual(g.range(0), { min: 0, max: 3 }); // 내 차: B 앞까지
  assert.deepEqual(g.range(1), { min: 0, max: 2 }); // B: C 앞까지만 내려가 출구 줄을 비키지 못한다
  assert.deepEqual(g.range(2), { min: 0, max: 4 }); // C: 왼쪽 끝까지
  assert.deepEqual(slideRange(g.pieces, g.positions, 2), { min: 0, max: 4 });
  assert.equal(g.pieceAt(5, 1), 1);
  assert.equal(g.pieceAt(2, 2), -1);
  assert.equal(g.pieceAt(6, 2), -1);
});

test('막힌 곳 너머로 밀면 그 앞까지만 가고 막혔다고 알린다', () => {
  const g = new UnblockGame(parseBoard(CHAIN));
  assert.equal(g.move(0, 5), true);
  assert.equal(g.positions[0], 3);
  const events = g.drain();
  assert.deepEqual(events[0], { type: 'blocked', id: 0, at: 3, dir: 1 });
  assert.equal(events[1].type, 'move');
  assert.equal(g.move(1, 3), true); // C 앞까지만
  assert.equal(g.positions[1], 2);
  assert.equal(g.moves, 2);
  // 아예 못 움직이면 수가 늘지 않는다
  assert.equal(g.move(0, 5), false);
  assert.equal(g.moves, 2);
  assert.equal(g.move(2, 4), false); // 제자리
  assert.equal(g.move(7, 1), false); // 없는 차
});

test('한 번 미는 것이 몇 칸이든 1수이고, 같은 차를 잇달아 밀면 한 수로 친다', () => {
  const g = new UnblockGame(parseBoard(CHAIN));
  g.move(2, 0);
  assert.equal(g.moves, 1);
  g.move(2, 2); // 같은 차를 다시
  assert.equal(g.moves, 1);
  g.move(1, 3);
  assert.equal(g.moves, 2);
  g.move(2, 0); // 다른 차를 사이에 두면 새 수
  assert.equal(g.moves, 3);
  g.move(2, 2); // 같은 차를 제자리로 되돌리면 그 수는 없던 것이 된다
  assert.equal(g.moves, 2);
  assert.equal(g.positions[2], 2);
});

test('내 차가 출구에 닿으면 풀리고, 그 뒤로는 움직이지 않는다', () => {
  const g = new UnblockGame(parseBoard(CHAIN));
  g.move(2, 0);
  g.move(1, 3);
  assert.equal(g.solved, false);
  g.move(0, GOAL_COL);
  assert.equal(g.solved, true);
  assert.equal(g.moves, 3);
  const events = g.drain();
  assert.deepEqual(events.at(-1), { type: 'solved', moves: 3 });
  assert.equal(g.move(2, 3), false);
});

test('되돌리기와 다시 시작', () => {
  const g = new UnblockGame(parseBoard(CHAIN));
  assert.equal(g.undo(), false);
  assert.equal(g.restart(), false);
  g.move(2, 1);
  g.move(1, 3);
  g.drain();
  assert.equal(g.undo(), true);
  assert.deepEqual(g.drain(), [{ type: 'undo', id: 1, from: 3, to: 0 }]);
  assert.deepEqual(g.positions, [0, 0, 1]);
  assert.equal(g.moves, 1);
  // 풀린 뒤에도 되돌릴 수 있다
  g.move(1, 3);
  g.move(0, GOAL_COL);
  assert.equal(g.solved, true);
  g.undo();
  assert.equal(g.solved, false);
  assert.equal(g.restart(), true);
  assert.deepEqual(g.positions, [0, 0, 4]);
  assert.equal(g.moves, 0);
  assert.equal(g.drain().at(-1).type, 'restart');
});

test('별: 최소 수면 3개, 1.5배 안이면 2개, 그 밖은 1개', () => {
  assert.equal(starsFor(10, 10), 3);
  assert.equal(starsFor(11, 10), 2);
  assert.equal(starsFor(15, 10), 2);
  assert.equal(starsFor(16, 10), 1);
  assert.equal(starsFor(5, 3), 2); // 1.5배 올림 = 5
  assert.equal(starsFor(6, 3), 1);
});

// ---------- 풀이기 ----------

test('상태 수로 묶고 푼다', () => {
  const positions = [3, 0, 4, 2, 1];
  assert.deepEqual(decode(encode(positions), new Array(5)), positions);
});

test('알려진 퍼즐의 최소 수를 구한다', () => {
  // 이미 출구에 있다
  assert.equal(minMoves(board('......', '......', '....AA', '......', '......', '......')), 0);
  // 길이 비어 있으면 한 번에
  assert.equal(minMoves(board('......', '......', 'AA....', '......', '......', '......')), 1);
  // 세로 차 하나가 막고 있다
  assert.equal(minMoves(board('......', '...B..', 'AA.B..', '......', '......', '......')), 2);
  // 사슬: C → B → 내 차
  assert.equal(minMoves(CHAIN), 3);
  // 아래로 비키려면 C 를 먼저 옮겨야 하지만 위로 비키면 한 번에 된다
  assert.equal(minMoves(board('......', '......', 'AA.B..', '...B..', '..CC..', '......')), 2);
  // 길이 3 트럭은 위로 비킬 수 없어 아래의 C 를 먼저 옮겨야 한다
  assert.equal(minMoves(board('......', '......', 'AA.B..', '...B..', '...B..', '..CC..')), 3);
  // 풀 수 없다: 같은 줄 오른쪽에 가로 차
  assert.equal(minMoves(board('......', '......', 'AA..BB', '......', '......', '......')), null);
});

/** 시험용으로 따로 만든 느린 너비 우선 탐색 (UnblockGame 을 그대로 써서 한 칸씩 민다) */
function slowSolve(text) {
  const puzzle = parseBoard(text);
  const seen = new Set([text]);
  let frontier = [start(puzzle)];
  for (let depth = 0; frontier.length; depth++) {
    const next = [];
    for (const positions of frontier) {
      if (positions[0] === GOAL_COL) return depth;
      for (let id = 0; id < puzzle.pieces.length; id++) {
        const { min, max } = slideRange(puzzle.pieces, positions, id);
        for (let p = min; p <= max; p++) {
          if (p === positions[id]) continue;
          const moved = [...positions];
          moved[id] = p;
          const key = boardString(puzzle.pieces, moved);
          if (seen.has(key)) continue;
          seen.add(key);
          next.push(moved);
        }
      }
    }
    frontier = next;
  }
  return null;
}

test('풀이기의 최소 수가 느린 탐색과 같다', () => {
  const rng = createRng(11);
  for (let i = 0; i < 12; i++) {
    const text = specBoard(randomSpec(rng, 7 + (i % 5)));
    assert.equal(minMoves(text), slowSolve(text), text);
  }
});

test('풀이기의 풀이를 그대로 두면 정말 풀린다', () => {
  const level = LEVELS.find((l) => l.tier === 'hard');
  const g = new UnblockGame(parseBoard(level.board));
  const { path } = solve(g.pieces, g.positions);
  for (const { id, to } of path) assert.equal(g.move(id, to), true);
  assert.equal(g.solved, true);
  assert.equal(g.moves, level.moves);
});

test('힌트: 다음 한 수를 두면 남은 최소 수가 하나 준다', () => {
  const level = LEVELS.find((l) => l.tier === 'medium');
  const g = new UnblockGame(parseBoard(level.board));
  for (let left = level.moves; left > 0; left--) {
    const move = nextMove(g.pieces, g.positions);
    assert.equal(move.moves, left);
    g.move(move.id, move.to);
  }
  assert.equal(g.solved, true);
  assert.equal(nextMove(g.pieces, g.positions), null);
});

test('무리에서 가장 어려운 상태를 찾는다', () => {
  const puzzle = parseBoard(CHAIN);
  const hardest = hardestInCluster(puzzle.pieces, start(puzzle));
  assert.ok(hardest.moves >= 3);
  assert.equal(solve(puzzle.pieces, hardest.positions).moves, hardest.moves);
  // 풀 수 없는 배치
  const stuck = parseBoard(board('......', '......', 'AA..BB', '......', '......', '......'));
  assert.equal(hardestInCluster(stuck.pieces, start(stuck)), null);
});

// ---------- 단계 데이터 ----------

test('단계는 난이도마다 여럿이고 쉬운 순서로 놓여 있다', () => {
  const order = TIERS.map((tier) => tier.id);
  for (const tier of TIERS) assert.ok(LEVELS.filter((l) => l.tier === tier.id).length >= 10, tier.id);
  for (let i = 1; i < LEVELS.length; i++) {
    const a = LEVELS[i - 1];
    const b = LEVELS[i];
    assert.ok(order.indexOf(a.tier) <= order.indexOf(b.tier), `${a.id} → ${b.id}`);
    assert.ok(a.moves <= b.moves, `${a.id}(${a.moves}) → ${b.id}(${b.moves})`);
  }
});

test('단계의 id 는 판에서 나오고 겹치는 판이 없다', () => {
  assert.equal(new Set(LEVELS.map((l) => l.id)).size, LEVELS.length);
  assert.equal(new Set(LEVELS.map((l) => normalize(l.board))).size, LEVELS.length);
  for (const level of LEVELS) assert.equal(level.id, hashSeed(level.board).toString(36));
});

test('모든 단계가 풀리고 기록된 최소 수가 풀이기와 같으며 난이도 범위 안에 있다', () => {
  for (const level of LEVELS) {
    const puzzle = parseBoard(level.board);
    assert.equal(puzzle.board.length, SIZE * SIZE);
    const result = solve(puzzle.pieces, start(puzzle));
    assert.ok(result, `${level.id} 를 풀 수 없다`);
    assert.equal(result.moves, level.moves, level.id);
    const tier = TIERS.find((t) => t.id === level.tier);
    assert.ok(level.moves >= tier.min && level.moves <= tier.max, `${level.id}: ${level.moves}수가 ${tier.id} 범위 밖`);
  }
});

// ---------- 퍼즐 만들기 ----------

test('글자를 판에 나오는 순서로 다시 매긴다', () => {
  assert.equal(normalize(board('ZZ...Q', '.....Q', 'AA...Q', '......', '......', '......')), board('BB...C', '.....C', 'AA...C', '......', '......', '......'));
});

test('만든 퍼즐은 풀 수 있고 최소 수가 맞다', () => {
  const found = climb(createRng(3), { count: 10, steps: 30 });
  assert.ok(found);
  assert.equal(minMoves(found.board), found.moves);
  const again = climb(createRng(3), { count: 10, steps: 30 });
  assert.deepEqual(again, found); // 시드가 같으면 같은 퍼즐
  const one = evaluate(randomSpec(createRng(5), 9));
  if (one) assert.equal(minMoves(one.board), one.moves);
});

test('오늘의 퍼즐은 날짜로 정해지고, 풀 수 있고, 정한 범위 안이다', () => {
  const a = dailyPuzzle('2026-10-05');
  const b = dailyPuzzle('2026-10-05');
  const c = dailyPuzzle('2026-10-06');
  assert.deepEqual(a, b);
  assert.notEqual(a.board, c.board);
  for (const puzzle of [a, c]) {
    assert.equal(minMoves(puzzle.board), puzzle.moves);
    assert.ok(puzzle.moves >= DAILY_RANGE.min && puzzle.moves <= DAILY_RANGE.max, String(puzzle.moves));
  }
});

test('날짜 열쇠는 기기 시간대의 YYYY-MM-DD', () => {
  assert.equal(dateKey(new Date(2026, 0, 9, 23, 59)), '2026-01-09');
  assert.equal(previousDay('2026-03-01'), '2026-02-28');
  assert.equal(previousDay('2026-01-01'), '2025-12-31');
});

// ---------- 저장 ----------

const IDS = LEVELS.map((l) => l.id);

test('단계 기록은 처음이거나 나아졌을 때만 바뀐다', () => {
  const store = new SaveStore(fakeStorage(), IDS);
  const id = IDS[0];
  let result = store.record(id, { moves: 9, hinted: true });
  assert.deepEqual(result, { first: true, improved: true, previous: null });
  result = store.record(id, { moves: 9, hinted: false }); // 같은 수지만 힌트 없이
  assert.equal(result.improved, true);
  result = store.record(id, { moves: 9, hinted: true });
  assert.equal(result.improved, false);
  result = store.record(id, { moves: 12, hinted: false });
  assert.equal(result.improved, false);
  assert.deepEqual(store.loadBest(id), { moves: 9, hinted: false });
  assert.equal(store.record('없는 단계', { moves: 3, hinted: false }).first, false);
  assert.equal(store.record(id, { moves: 0, hinted: false }).first, false);
  assert.equal(better({ moves: 3, hinted: true }, { moves: 4, hinted: false }), true);
});

test('깬 단계 수보다 몇 단계 더 열리고, 다음에 할 단계를 고른다', () => {
  const store = new SaveStore(fakeStorage(), IDS);
  assert.equal(store.isUnlocked(0), true);
  assert.equal(store.isUnlocked(UNLOCK_AHEAD - 1), true);
  assert.equal(store.isUnlocked(UNLOCK_AHEAD), false);
  assert.equal(store.nextUnsolved(), IDS[0]);
  store.record(IDS[1], { moves: 30, hinted: false });
  assert.equal(store.isUnlocked(UNLOCK_AHEAD), true);
  assert.equal(store.nextUnsolved(), IDS[0]);
  store.saveLast(IDS[1]);
  assert.equal(store.load().last, IDS[1]);
  assert.equal(store.isUnlocked(IDS.length), false);
});

test('깨진 데이터는 버린다', () => {
  const storage = fakeStorage({
    [PROGRESS_KEY]: JSON.stringify({ best: { [IDS[0]]: { moves: 'x', hinted: false }, [IDS[1]]: { moves: 4, hinted: false }, zzz: { moves: 3, hinted: false } }, last: 'zzz' }),
    [DAILY_KEY]: '{깨짐',
  });
  const store = new SaveStore(storage, IDS);
  assert.deepEqual(store.load(), { best: { [IDS[1]]: { moves: 4, hinted: false } }, last: null });
  assert.equal(store.loadDaily('2026-10-05'), null);
  const broken = new SaveStore(
    {
      getItem() {
        throw new Error('막힘');
      },
      setItem() {
        throw new Error('막힘');
      },
    },
    IDS,
  );
  assert.equal(broken.record(IDS[0], { moves: 3, hinted: false }).first, true);
  assert.equal(broken.solvedCount(), 0);
});

test('오늘의 퍼즐: 만든 퍼즐을 남기고, 기록과 연속 일수를 센다', () => {
  const store = new SaveStore(fakeStorage(), IDS);
  const puzzle = { board: LEVELS[20].board, moves: LEVELS[20].moves };
  // 퍼즐을 남기기 전에는 기록하지 않는다
  assert.equal(store.recordDaily('2026-10-04', { moves: 20, hinted: false }).first, false);
  store.saveDailyPuzzle('2026-10-04', puzzle);
  assert.deepEqual(store.loadDailyPuzzle('2026-10-04'), puzzle);
  assert.equal(store.loadDailyPuzzle('2026-10-05'), null);
  let result = store.recordDaily('2026-10-04', { moves: 20, hinted: false });
  assert.equal(result.first, true);
  assert.equal(result.streak, 1);
  result = store.recordDaily('2026-10-04', { moves: 18, hinted: false });
  assert.equal(result.improved, true);
  assert.equal(result.streak, 1); // 같은 날 다시 풀어도 그대로
  store.saveDailyPuzzle('2026-10-05', puzzle);
  assert.equal(store.loadDaily('2026-10-05'), null);
  result = store.recordDaily('2026-10-05', { moves: 25, hinted: true });
  assert.equal(result.streak, 2);
  assert.deepEqual(store.loadDaily('2026-10-05'), { moves: 25, hinted: true });
  assert.equal(store.loadStreak('2026-10-06'), 2);
  assert.equal(store.loadStreak('2026-10-07'), 0);
});
