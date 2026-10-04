import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OthelloMatch,
  BLACK,
  WHITE,
  EMPTY,
  CELLS,
  initialBoard,
  boardFromText,
  boardToText,
  legalMoves,
  flipsFor,
  applyMove,
  countDiscs,
  notation,
  parseNotation,
} from '../js/game.js';
import { chooseMove, search, evaluate, SearchBoard, LEVELS, LEVEL_IDS, WEIGHTS } from '../js/ai.js';
import { SaveStore, SETTINGS_KEY, RECORD_KEY, DEFAULT_SETTINGS } from '../js/save.js';
import { createRng } from '../../shared/util.js';

const cells = (...names) => names.map(parseNotation).sort((a, b) => a - b);

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

/** 두 컴퓨터(또는 무작위)가 끝까지 두며 매 수가 합법인지 확인한다 */
function playOut(pick, seed = 1) {
  const rng = createRng(seed);
  const match = new OthelloMatch({ mode: 'versus' });
  while (!match.over) {
    const legal = match.legalMoves();
    assert.ok(legal.length > 0, '끝나지 않은 판에서는 지금 차례가 둘 곳이 있어야 한다');
    const move = pick(match, rng);
    assert.ok(legal.includes(move), `합법수가 아님: ${notation(move)}`);
    assert.ok(match.play(move));
  }
  return match;
}

// ---------- 판과 표기 ----------

test('처음 배치: 가운데 네 칸, 흑 2 백 2', () => {
  const board = initialBoard();
  assert.equal(board.length, CELLS);
  assert.equal(board[parseNotation('d4')], WHITE);
  assert.equal(board[parseNotation('e5')], WHITE);
  assert.equal(board[parseNotation('e4')], BLACK);
  assert.equal(board[parseNotation('d5')], BLACK);
  assert.deepEqual(countDiscs(board), [2, 2]);
});

test('기보 표기 ↔ 칸 번호', () => {
  assert.equal(notation(0), 'a1');
  assert.equal(notation(63), 'h8');
  assert.equal(notation(parseNotation('c5')), 'c5');
  assert.equal(parseNotation('z9'), -1);
  const board = initialBoard();
  assert.deepEqual(boardFromText(boardToText(board)), board);
});

// ---------- 합법수와 뒤집기 ----------

test('처음 판에서 흑이 둘 수 있는 곳은 d3·c4·f5·e6 네 곳', () => {
  assert.deepEqual(legalMoves(initialBoard(), BLACK), cells('d3', 'c4', 'f5', 'e6'));
  assert.deepEqual(legalMoves(initialBoard(), WHITE), cells('e3', 'f4', 'c5', 'd6'));
});

test('뒤집기: 사이에 낀 돌만, 여러 방향을 한꺼번에', () => {
  const board = boardFromText(`
    ........
    ...B....
    ...W.B..
    ...WW...
    ........
    ..WW....
    ........
    ........
  `);
  // d5 에 두면 위로 d4·d3(끝에 d2 흑), 오른쪽 위로 e4(끝에 f3 흑)가 뒤집힌다.
  // 왼쪽 아래 c6 백은 끝에 흑이 없어 그대로다
  const flips = flipsFor(board, BLACK, parseNotation('d5'));
  assert.deepEqual(flips.slice().sort((a, b) => a - b), cells('d3', 'd4', 'e4'));
  assert.deepEqual(flipsFor(board, BLACK, parseNotation('d2')), [], '이미 돌이 있는 칸');
  assert.deepEqual(flipsFor(board, BLACK, parseNotation('b7')), [], '끝에 흑이 없는 줄');
  const after = Int8Array.from(board);
  assert.deepEqual(applyMove(after, BLACK, parseNotation('d5')).sort((a, b) => a - b), cells('d3', 'd4', 'e4'));
  assert.equal(after[parseNotation('d5')], BLACK);
  for (const i of cells('d3', 'd4', 'e4')) assert.equal(after[i], BLACK);
  assert.equal(after[parseNotation('c6')], WHITE);
  assert.equal(applyMove(after, BLACK, parseNotation('a1')), null, '뒤집을 것이 없으면 두지 못한다');
});

test('판 가장자리에서 끊긴 줄은 뒤집지 않는다', () => {
  const board = boardFromText(`
    WWWWWWW.
    ........
    ........
    ........
    ........
    ........
    ........
    ........
  `);
  assert.deepEqual(flipsFor(board, BLACK, parseNotation('h1')), []);
  board[0] = BLACK;
  assert.equal(flipsFor(board, BLACK, parseNotation('h1')).length, 6);
});

// ---------- 한 판 ----------

test('한 수 두면 차례가 넘어가고 돌 수가 바뀐다', () => {
  const match = new OthelloMatch();
  assert.equal(match.current, BLACK);
  assert.equal(match.play(parseNotation('a1')), null);
  const result = match.play(parseNotation('d3'));
  assert.deepEqual(result.flips, cells('d4'));
  assert.equal(result.passed, null);
  assert.equal(result.over, false);
  assert.equal(match.current, WHITE);
  assert.deepEqual(match.counts, [4, 1]);
  assert.equal(match.lastMove, parseNotation('d3'));
});

test('패스: 상대가 둘 곳이 없으면 같은 사람이 이어서 둔다', () => {
  const board = boardFromText(`
    BW......
    ........
    ........
    ........
    ........
    ........
    ........
    BWW.....
  `);
  const match = new OthelloMatch({ mode: 'versus', board, current: BLACK });
  // 흑 c1 로 b1 이 뒤집히면 백은 끼울 흑이 없어 넘긴다 (a8 흑은 모서리라 끼울 수 없다). 흑은 d8 에 또 둘 수 있다
  const r = match.play(parseNotation('c1'));
  assert.ok(r);
  assert.deepEqual(r.flips, cells('b1'));
  assert.equal(r.passed, WHITE);
  assert.equal(match.current, BLACK);
  assert.equal(match.over, false);
  assert.deepEqual(match.legalMoves(WHITE), []);
  assert.deepEqual(match.legalMoves(), cells('d8'));
});

test('양쪽 다 둘 곳이 없으면 끝나고, 돌 수로 승패를 가린다', () => {
  // 흑이 마지막 빈칸에 두면 판이 꽉 찬다
  const full = boardFromText(`
    .WBBBBBB
    BBBBBBBB
    BBBBBBBB
    BBBBBBBB
    WWWWWWWW
    WWWWWWWW
    WWWWWWWW
    WWWWWWWW
  `);
  const match = new OthelloMatch({ mode: 'versus', board: full, current: BLACK });
  const r = match.play(parseNotation('a1'));
  assert.ok(r.over);
  assert.ok(match.over);
  assert.deepEqual(match.counts, [32, 32]);
  assert.equal(match.winner, -1, '32:32 는 무승부');
  assert.deepEqual(match.legalMoves(), []);

  // 빈칸이 남아도 둘 다 못 두면 끝난다: 백이 모두 사라진 판
  const wipe = boardFromText(`
    ........
    ........
    ........
    ...BW...
    ........
    ........
    ........
    ........
  `);
  const m2 = new OthelloMatch({ mode: 'versus', board: wipe, current: BLACK });
  const r2 = m2.play(parseNotation('f4'));
  assert.ok(r2.over);
  assert.equal(m2.winner, BLACK);
  assert.deepEqual(m2.counts, [3, 0]);
});

test('처음부터 둘 곳이 없는 판은 바로 끝난다', () => {
  const board = boardFromText(`
    BBBBBBBB
    BBBBBBBB
    BBBBBBBB
    BBBBBBBB
    BBBBBBBB
    BBBBBBBB
    BBBBBBBB
    BBBBBBB.
  `);
  const match = new OthelloMatch({ mode: 'versus', board, current: WHITE });
  assert.ok(match.over);
  assert.equal(match.winner, BLACK);
});

test('무르기: 2인 대전은 한 수, 컴퓨터 대전은 사람의 수까지', () => {
  const versus = new OthelloMatch({ mode: 'versus' });
  assert.equal(versus.canUndo(), false);
  versus.play(parseNotation('d3'));
  versus.play(parseNotation('c3'));
  assert.equal(versus.undo(), 1);
  assert.equal(versus.current, WHITE);
  assert.deepEqual(versus.counts, [4, 1]);
  assert.equal(versus.lastMove, parseNotation('d3'));
  assert.equal(versus.undo(), 1);
  assert.deepEqual(versus.board, initialBoard());
  assert.equal(versus.lastMove, -1);

  const solo = new OthelloMatch({ mode: 'computer', human: BLACK });
  solo.play(parseNotation('d3')); // 사람
  solo.play(parseNotation('c3')); // 컴퓨터
  assert.equal(solo.undo(), 2);
  assert.equal(solo.current, BLACK);
  assert.deepEqual(solo.board, initialBoard());
  assert.equal(solo.moves, 0);

  // 사람이 백이면 컴퓨터의 첫 수만으로는 무를 수 없다
  const white = new OthelloMatch({ mode: 'computer', human: WHITE });
  white.play(parseNotation('d3'));
  assert.equal(white.canUndo(), false);
  assert.equal(white.undo(), 0);
  white.play(parseNotation('c3'));
  assert.equal(white.undo(), 1);
  assert.equal(white.current, WHITE);
});

test('끝난 판도 무르면 다시 이어진다', () => {
  const full = boardFromText(`
    .WBBBBBB
    BBBBBBBB
    BBBBBBBB
    BBBBBBBB
    WWWWWWWW
    WWWWWWWW
    WWWWWWWW
    WWWWWWWW
  `);
  const match = new OthelloMatch({ mode: 'versus', board: full, current: BLACK });
  match.play(parseNotation('a1'));
  assert.ok(match.over);
  match.undo();
  assert.equal(match.over, false);
  assert.equal(match.winner, null);
  assert.equal(match.board[0], EMPTY);
});

test('무작위로 끝까지 두어도 규칙이 어긋나지 않는다', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const match = playOut((m, rng) => {
      const legal = m.legalMoves();
      return legal[Math.floor(rng() * legal.length)];
    }, seed);
    const [b, w] = match.counts;
    assert.ok(b + w <= 64);
    assert.equal(match.winner, b > w ? BLACK : w > b ? WHITE : -1);
    assert.ok(match.moves >= 4);
  }
});

// ---------- 컴퓨터 ----------

test('실력 목록', () => {
  assert.deepEqual(LEVEL_IDS, ['easy', 'normal', 'hard']);
  assert.equal(WEIGHTS.length, 64);
  for (const level of LEVEL_IDS) assert.ok(LEVELS[level]);
});

test('컴퓨터는 모든 실력에서 합법수만 둔다', () => {
  for (const level of LEVEL_IDS) {
    for (const seed of [11, 12]) {
      playOut((m, rng) => chooseMove(m.board, m.current, level, { rng, time: 15 }), seed);
    }
  }
});

test('둘 곳이 없으면 -1, 한 곳뿐이면 그곳', () => {
  const board = boardFromText(`
    BBBBBBBB
    BBBBBBBB
    BBBBBBBB
    BBBBBBBB
    BBBBBBBB
    BBBBBBBB
    BBBBBBBB
    BBBBBBB.
  `);
  for (const level of LEVEL_IDS) {
    assert.equal(chooseMove(board, WHITE, level), -1);
    assert.equal(chooseMove(board, BLACK, level), -1);
  }
  const one = boardFromText(`
    .WB.....
    ........
    ........
    ........
    ........
    ........
    ........
    ........
  `);
  assert.deepEqual(legalMoves(one, BLACK), [0]);
  for (const level of LEVEL_IDS) assert.equal(chooseMove(one, BLACK, level), 0);
});

test('보통·어려움은 잡을 수 있는 모서리를 잡는다', () => {
  const board = boardFromText(`
    .WWWB...
    ..BW....
    ...BW...
    ...BBB..
    ........
    ........
    ........
    ........
  `);
  assert.ok(legalMoves(board, BLACK).includes(0));
  for (const level of ['normal', 'hard']) assert.equal(chooseMove(board, BLACK, level, { rng: createRng(3), time: 200 }), 0, level);
});

test('어려움: 빈칸이 적으면 끝까지 읽어 돌 수 차이가 가장 좋은 수를 고른다', () => {
  const rng = createRng(7);
  const match = new OthelloMatch({ mode: 'versus' });
  // 무작위로 빈칸이 9개 남을 때까지 둔다
  while (!match.over && countDiscs(match.board).reduce((a, b) => a + b) < 55) {
    const legal = match.legalMoves();
    match.play(legal[Math.floor(rng() * legal.length)]);
  }
  if (match.over) return;
  const result = search(match.board, match.current, { endgame: 12, time: 20000 });
  assert.ok(result.exact);
  // 끝까지 읽은 점수는 실제로 그 수를 두고 서로 최선을 다했을 때의 돌 수 차이(×1000)와 같아야 한다
  const exact = (board, player) => {
    const moves = legalMoves(board, player);
    if (!moves.length) {
      if (!legalMoves(board, 1 - player).length) {
        const [b, w] = countDiscs(board);
        const diff = player === BLACK ? b - w : w - b;
        const empties = 64 - b - w;
        return diff > 0 ? diff + empties : diff < 0 ? diff - empties : 0;
      }
      return -exact(board, 1 - player);
    }
    let best = -Infinity;
    for (const m of moves) {
      const next = Int8Array.from(board);
      applyMove(next, player, m);
      best = Math.max(best, -exact(next, 1 - player));
    }
    return best;
  };
  assert.equal(result.score, exact(match.board, match.current) * 1000);
});

test('평가: 모서리를 가진 쪽이 좋고, 기동력이 점수에 들어간다', () => {
  const board = boardFromText(`
    B.......
    ........
    ........
    ...BW...
    ...WB...
    ........
    ........
    ........
  `);
  const sb = new SearchBoard(board);
  assert.ok(evaluate(sb, BLACK) > 0);
  assert.equal(evaluate(sb, BLACK), -evaluate(sb, WHITE));
  // 흑 d3, 백 c3 을 둔 판(흑 4곳, 백 5곳): 둘 수 있는 칸 수가 다르면 그 쪽으로 점수가 움직인다
  const opened = initialBoard();
  applyMove(opened, BLACK, parseNotation('d3'));
  applyMove(opened, WHITE, parseNotation('c3'));
  const sb2 = new SearchBoard(opened);
  const diff = legalMoves(opened, BLACK).length - legalMoves(opened, WHITE).length;
  assert.notEqual(diff, 0);
  assert.equal(Math.sign(evaluate(sb2, BLACK, 12) - evaluate(sb2, BLACK, 0)), Math.sign(diff));
});

test('탐색은 시간을 넘기지 않는다', () => {
  const started = performance.now();
  const result = search(initialBoard(), BLACK, { depth: 30, time: 120, mobility: 12 });
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 600, `${elapsed}ms`);
  assert.ok(legalMoves(initialBoard(), BLACK).includes(result.move));
  assert.ok(result.depth >= 1);
});

test('실력 차이: 어려움은 쉬움을 이긴다', () => {
  for (const seed of [21, 22]) {
    for (const hardSide of [BLACK, WHITE]) {
      const match = playOut((m, rng) => chooseMove(m.board, m.current, m.current === hardSide ? 'hard' : 'easy', { rng, time: 30 }), seed);
      assert.equal(match.winner, hardSide, `seed ${seed}, 어려움이 ${hardSide === BLACK ? '흑' : '백'}`);
    }
  }
});

// ---------- 저장 ----------

test('설정: 잘못된 값은 기본값으로', () => {
  const store = new SaveStore(memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ opponent: 'x', level: 'hard', color: 'white', hints: 'yes' }) }));
  assert.deepEqual(store.loadSettings(), { ...DEFAULT_SETTINGS, level: 'hard', color: 'white' });
  store.saveSettings({ ...DEFAULT_SETTINGS, opponent: 'versus', sound: false });
  assert.equal(store.loadSettings().opponent, 'versus');
  assert.equal(store.loadSettings().sound, false);
  assert.deepEqual(new SaveStore(memoryStorage({ [SETTINGS_KEY]: '{깨진' })).loadSettings(), DEFAULT_SETTINGS);
  assert.deepEqual(new SaveStore(null).loadSettings(), DEFAULT_SETTINGS);
});

test('전적: 실력마다 승·패·무와 가장 많이 남긴 승리', () => {
  const store = new SaveStore(memoryStorage());
  assert.equal(store.loadRecord('hard'), null);
  store.recordResult('hard', 'win', 40);
  store.recordResult('hard', 'win', 35);
  store.recordResult('hard', 'loss', 20);
  store.recordResult('hard', 'draw', 32);
  store.recordResult('easy', 'win', 50);
  assert.deepEqual(store.loadRecord('hard'), { wins: 2, losses: 1, draws: 1, best: 40 });
  assert.deepEqual(store.loadRecord('easy'), { wins: 1, losses: 0, draws: 0, best: 50 });
  assert.equal(store.recordResult('nope', 'win'), null);
  assert.equal(store.recordResult('easy', 'tie'), null);
  // 깨진 항목은 버리고 나머지는 남긴다
  const broken = new SaveStore(
    memoryStorage({ [RECORD_KEY]: JSON.stringify({ easy: { wins: -1, losses: 0 }, normal: { wins: 3, losses: 2 } }) }),
  );
  assert.deepEqual(broken.loadAllRecords(), { normal: { wins: 3, losses: 2, draws: 0, best: 0 } });
  // 저장소가 예외를 던져도 계속된다
  const throwing = new SaveStore({
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {},
  });
  assert.equal(throwing.loadRecord('easy'), null);
  assert.deepEqual(throwing.recordResult('easy', 'win', 33), { wins: 1, losses: 0, draws: 0, best: 33 });
});
