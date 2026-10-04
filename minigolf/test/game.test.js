import test from 'node:test';
import assert from 'node:assert/strict';
import { GolfRound, maxStrokes, scoreName, formatToPar, MAX_CAP } from '../js/game.js';
import { HOLES, COURSE_PAR } from '../js/course.js';
import { SaveStore, SETTINGS_KEY, RECORD_KEY, DEFAULT_SETTINGS, validateRecord } from '../js/save.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

/** n 타 만에 넣는다 */
function holeIn(round, n) {
  for (let i = 1; i < n; i++) {
    round.stroke();
    assert.equal(round.shotResult('stopped').done, false);
  }
  round.stroke();
  return round.shotResult('holed');
}

/** 모든 사람이 scores[p] 타로 홀을 마친다 */
function playHole(round, scores) {
  for (;;) {
    const r = holeIn(round, scores[round.current]);
    assert.equal(r.done, true);
    if (round.nextPlayer().holeDone) break;
  }
  return round.nextHole();
}

// ---------- 점수 ----------

test('최대 타수는 파 + 4, 8타를 넘지 않는다', () => {
  assert.equal(maxStrokes(2), 6);
  assert.equal(maxStrokes(3), 7);
  assert.equal(maxStrokes(4), 8);
  assert.equal(maxStrokes(5), MAX_CAP);
});

test('파 대비 점수 이름: 1타는 언제나 홀인원', () => {
  assert.equal(scoreName(1, 2), 'ace');
  assert.equal(scoreName(1, 4), 'ace');
  assert.equal(scoreName(1, 3), 'ace');
  assert.equal(scoreName(2, 5), 'albatross');
  assert.equal(scoreName(2, 4), 'eagle');
  assert.equal(scoreName(2, 3), 'birdie');
  assert.equal(scoreName(3, 3), 'par');
  assert.equal(scoreName(4, 3), 'bogey');
  assert.equal(scoreName(5, 3), 'double');
  assert.equal(scoreName(6, 3), 'triple');
  assert.equal(scoreName(7, 3), 'over');
});

test('파 대비 표기', () => {
  assert.equal(formatToPar(0), 'E');
  assert.equal(formatToPar(3), '+3');
  assert.equal(formatToPar(-2), '-2');
});

// ---------- 라운드 ----------

test('혼자서: 타수를 세고 홀을 마치면 기록하며, 합계와 파 대비를 계산한다', () => {
  const round = new GolfRound({ players: 1 });
  assert.equal(round.holeIndex, 0);
  assert.equal(round.max, maxStrokes(HOLES[0].par));
  const r = holeIn(round, 3);
  assert.deepEqual(r, { done: true, holed: true, penalty: false, picked: false, strokes: 3 });
  assert.equal(round.scores[0][0], 3);
  assert.equal(round.nextPlayer().holeDone, true);
  assert.equal(round.nextHole().over, false);
  assert.equal(round.holeIndex, 1);
  assert.equal(round.strokes, 0);
  holeIn(round, 1);
  assert.equal(round.total(0), 4);
  assert.equal(round.toPar(0), 4 - HOLES[0].par - HOLES[1].par);
  assert.equal(round.played(0), 2);
});

test('물에 빠지면 1벌타: 친 타수에 1을 더한다', () => {
  const round = new GolfRound({ players: 1 });
  round.stroke();
  const r = round.shotResult('water');
  assert.equal(r.penalty, true);
  assert.equal(r.done, false);
  assert.equal(round.strokes, 2);
  assert.equal(round.penalties[0][0], 1);
  round.stroke();
  assert.equal(round.shotResult('holed').strokes, 3);
  assert.equal(round.scores[0][0], 3);
});

test('최대 타수를 채우면 넣지 못해도 그 타수로 마치고, 더는 칠 수 없다', () => {
  const round = new GolfRound({ players: 1 });
  const max = round.max;
  for (let i = 1; i < max; i++) {
    round.stroke();
    assert.equal(round.shotResult('stopped').done, false);
  }
  round.stroke();
  const r = round.shotResult('stopped');
  assert.deepEqual(r, { done: true, holed: false, penalty: false, picked: true, strokes: max });
  assert.equal(round.scores[0][0], max);
  assert.throws(() => round.stroke());
});

test('최대 타수 한 타 앞에서 물에 빠지면 벌타로 최대 타수를 채워 마친다', () => {
  const round = new GolfRound({ players: 1 });
  for (let i = 1; i < round.max - 1; i++) {
    round.stroke();
    round.shotResult('stopped');
  }
  round.stroke();
  const r = round.shotResult('water');
  assert.equal(r.done, true);
  assert.equal(r.picked, true);
  assert.equal(r.strokes, round.max);
  // 마지막 타에서 빠져도 최대 타수를 넘지 않는다
  const again = new GolfRound({ players: 1 });
  for (let i = 1; i < again.max; i++) {
    again.stroke();
    again.shotResult('stopped');
  }
  again.stroke();
  assert.equal(again.shotResult('water').strokes, again.max);
});

test('여럿이: 홀마다 차례대로 치고, 다음 홀은 앞 홀 타수가 적은 사람부터 (같으면 앞 순서)', () => {
  const round = new GolfRound({ players: 3 });
  assert.deepEqual(round.order, [0, 1, 2]);
  assert.equal(round.current, 0);
  playHole(round, [4, 2, 3]);
  assert.deepEqual(round.order, [1, 2, 0]);
  assert.equal(round.current, 1);
  playHole(round, [3, 3, 2]); // 1P 와 2P 가 같으면 앞 홀에서 먼저 친 2P 가 먼저
  assert.deepEqual(round.order, [2, 1, 0]);
  assert.equal(round.scores[2][1], 2);
  assert.equal(round.total(0), 7);
});

test('9홀을 마치면 끝나고, 합계가 가장 적은 사람이 1위 (같으면 공동)', () => {
  const round = new GolfRound({ players: 2 });
  let result;
  for (let h = 0; h < HOLES.length; h++) result = playHole(round, h === 0 ? [2, 3] : h === 1 ? [3, 2] : [2, 2]);
  assert.equal(result.over, true);
  assert.equal(round.over, true);
  assert.deepEqual(round.leaders(), [0, 1]);
  assert.deepEqual(round.ranks(), [1, 1]);
  assert.equal(round.total(0), 2 * HOLES.length + 1);
  assert.equal(round.toPar(0), round.total(0) - COURSE_PAR);
  assert.throws(() => round.stroke());

  const four = new GolfRound({ players: 4 });
  playHole(four, [3, 1, 2, 2]);
  assert.deepEqual(four.ranks(), [4, 1, 2, 2]);
  assert.deepEqual(four.leaders(), [1]);
});

test('인원은 1~4명', () => {
  assert.throws(() => new GolfRound({ players: 0 }));
  assert.throws(() => new GolfRound({ players: 5 }));
});

// ---------- 저장 ----------

test('설정: 잘못된 값은 기본값으로', () => {
  const store = new SaveStore(memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ players: 7, camera: 'drone', sound: 'yes' }) }));
  assert.deepEqual(store.loadSettings(), DEFAULT_SETTINGS);
  store.saveSettings({ players: 3, camera: 'follow', sound: false });
  assert.deepEqual(store.loadSettings(), { players: 3, camera: 'follow', sound: false });
});

test('기록: 홀마다 가장 적은 타수와 9홀 최저 합계만 남는다', () => {
  const store = new SaveStore(memoryStorage());
  assert.deepEqual(store.loadRecord(), { total: null, holes: Array(HOLES.length).fill(null) });
  assert.equal(store.recordHole(0, 3), true);
  assert.equal(store.recordHole(0, 4), false);
  assert.equal(store.recordHole(0, 2), true);
  assert.equal(store.recordHole(0, 2), false);
  assert.equal(store.recordHole(9, 2), false);
  assert.equal(store.recordHole(1, 0), false);
  assert.equal(store.recordRound(30), true);
  assert.equal(store.recordRound(31), false);
  assert.equal(store.recordRound(28), true);
  const record = store.loadRecord();
  assert.equal(record.total, 28);
  assert.equal(record.holes[0], 2);
  assert.equal(record.holes[1], null);
});

test('기록: 깨진 값은 버리고 올바른 것만 쓴다', () => {
  const clean = validateRecord({ total: 3, holes: [2, 'x', 9, 4, null, -1, 1.5, 8, 1] });
  assert.equal(clean.total, null);
  assert.deepEqual(clean.holes, [2, null, null, 4, null, null, null, 8, 1]);
  const store = new SaveStore(memoryStorage({ [RECORD_KEY]: '{not json' }));
  assert.equal(store.loadRecord().total, null);
});

test('저장소 접근이 예외를 던져도 게임은 계속된다', () => {
  const broken = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
    removeItem() {},
  };
  const store = new SaveStore(broken);
  assert.deepEqual(store.loadSettings(), DEFAULT_SETTINGS);
  assert.equal(store.recordHole(0, 2), true); // 새 기록이지만 남지는 않는다
  assert.equal(store.loadRecord().holes[0], null);
  assert.equal(new SaveStore(null).saveSettings(DEFAULT_SETTINGS), false);
});
