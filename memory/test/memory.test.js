import test from 'node:test';
import assert from 'node:assert/strict';
import { FACES, SIZES, MISS_DELAY, MemoryGame, createRng, shuffle, formatTime, layoutFor } from '../js/game.js';
import { SaveStore, BEST_KEY, SETTINGS_KEY, DEFAULT_SETTINGS } from '../js/save.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

/** 같은 그림인 카드 번호 두 개씩 */
function pairsOf(game) {
  const byFace = new Map();
  game.cards.forEach((card, index) => byFace.set(card.face, [...(byFace.get(card.face) ?? []), index]));
  return [...byFace.values()];
}

/** 그림이 서로 다른 덮인 카드 두 장 */
function mismatch(game) {
  const down = game.cards.map((card, index) => ({ ...card, index })).filter((card) => card.state === 'down');
  const other = down.find((card) => card.face !== down[0].face);
  return [down[0].index, other.index];
}

const types = (events) => events.map((event) => event.type);

// ---------- 판 만들기 ----------

test('그림 파일 이름은 30개이고 겹치지 않는다', () => {
  assert.equal(FACES.length, 30);
  assert.equal(new Set(FACES).size, 30);
  assert.ok(Math.max(...SIZES) / 2 <= FACES.length);
});

test('카드는 그림마다 정확히 두 장씩이고 모두 덮여 있다', () => {
  for (const count of SIZES) {
    const game = new MemoryGame({ count, rng: createRng(count) });
    assert.equal(game.cards.length, count);
    const pairs = pairsOf(game);
    assert.equal(pairs.length, count / 2);
    for (const pair of pairs) assert.equal(pair.length, 2);
    assert.ok(game.cards.every((card) => card.state === 'down' && card.owner === -1));
  }
});

test('같은 시드면 같은 판, 다른 시드면 다른 판', () => {
  const faces = (seed) => new MemoryGame({ count: 20, rng: createRng(seed) }).cards.map((card) => card.face);
  assert.deepEqual(faces(7), faces(7));
  assert.notDeepEqual(faces(7), faces(8));
});

test('홀수 장이나 그림이 모자라면 만들지 않는다', () => {
  assert.throws(() => new MemoryGame({ count: 13 }));
  assert.throws(() => new MemoryGame({ count: 12, faces: ['a', 'b'] }));
});

test('shuffle 은 원소를 잃지 않는다', () => {
  const list = shuffle([1, 2, 3, 4, 5, 6], createRng(1));
  assert.deepEqual([...list].sort(), [1, 2, 3, 4, 5, 6]);
});

// ---------- 혼자서 ----------

test('짝을 맞추면 펼쳐진 채 남고 턴이 하나 는다', () => {
  const game = new MemoryGame({ count: 12, rng: createRng(1) });
  const [a, b] = pairsOf(game)[0];
  assert.equal(game.flip(a), true);
  assert.equal(game.turns, 0);
  assert.equal(game.flip(b), true);
  assert.equal(game.turns, 1);
  assert.equal(game.found, 1);
  assert.equal(game.cards[a].state, 'matched');
  assert.equal(game.cards[b].state, 'matched');
  assert.deepEqual(types(game.drain()), ['flip', 'flip', 'match']);
});

test('틀리면 잠깐 보여 준 뒤 다시 덮는다', () => {
  const game = new MemoryGame({ count: 12, rng: createRng(1) });
  const [a, b] = mismatch(game);
  game.flip(a);
  game.flip(b);
  assert.deepEqual(types(game.drain()), ['flip', 'flip', 'miss']);
  assert.equal(game.cards[a].state, 'up');
  game.update(MISS_DELAY / 2);
  assert.equal(game.cards[a].state, 'up');
  game.update(MISS_DELAY);
  assert.equal(game.cards[a].state, 'down');
  assert.equal(game.cards[b].state, 'down');
  assert.deepEqual(types(game.drain()), ['hide']);
  assert.equal(game.turns, 1);
  assert.equal(game.found, 0);
});

test('이미 뒤집은 카드나 없는 카드는 뒤집지 못한다', () => {
  const game = new MemoryGame({ count: 12, rng: createRng(1) });
  const [a, b] = pairsOf(game)[0];
  game.flip(a);
  assert.equal(game.flip(a), false);
  assert.equal(game.flip(99), false);
  assert.equal(game.turns, 0);
  game.flip(b);
  assert.equal(game.flip(a), false);
  assert.equal(game.canFlip(a), false);
});

test('혼자 할 때는 틀린 카드가 덮이기를 기다리지 않고 다음 카드를 뒤집을 수 있다', () => {
  const game = new MemoryGame({ count: 12, rng: createRng(1) });
  const [a, b] = mismatch(game);
  game.flip(a);
  game.flip(b);
  game.drain();
  assert.equal(game.flip(a), true); // 방금 틀린 카드를 바로 다시 눌러도 된다
  assert.deepEqual(types(game.drain()), ['hide', 'flip']);
  assert.equal(game.cards[a].state, 'up');
  assert.equal(game.cards[b].state, 'down');
  assert.equal(game.first, a);
});

test('시간은 첫 카드를 뒤집은 뒤부터 다 맞출 때까지만 흐른다', () => {
  const game = new MemoryGame({ count: 12, rng: createRng(3) });
  game.update(5);
  assert.equal(game.elapsed, 0);
  const pairs = pairsOf(game);
  game.flip(pairs[0][0]);
  game.update(2);
  assert.equal(game.elapsed, 2);
  game.flip(pairs[0][1]);
  for (const [a, b] of pairs.slice(1)) {
    game.flip(a);
    game.flip(b);
  }
  assert.equal(game.done, true);
  game.update(10);
  assert.equal(game.elapsed, 2);
  assert.equal(game.turns, 6);
  assert.equal(game.winner, 0);
  assert.equal(game.drain().at(-1).type, 'done');
  assert.equal(game.flip(0), false);
});

// ---------- 2인 대전 ----------

test('2인 대전: 짝을 맞추면 한 번 더, 틀리면 차례가 넘어간다', () => {
  const game = new MemoryGame({ count: 12, players: 2, rng: createRng(2) });
  assert.equal(game.current, 0);
  const [a, b] = pairsOf(game)[0];
  game.flip(a);
  game.flip(b);
  assert.equal(game.current, 0);
  assert.deepEqual(game.scores, [1, 0]);
  assert.equal(game.cards[a].owner, 0);

  const [c, d] = mismatch(game);
  game.flip(c);
  game.flip(d);
  assert.equal(game.current, 0, '틀린 카드를 보여 주는 동안은 아직 차례가 넘어가지 않는다');
  game.drain();
  game.update(MISS_DELAY + 0.01);
  assert.equal(game.current, 1);
  assert.deepEqual(game.drain(), [
    { type: 'hide', a: c, b: d },
    { type: 'turn', player: 1 },
  ]);
});

test('2인 대전: 틀린 카드가 펼쳐져 있을 때 누르면 덮고 차례만 넘긴다', () => {
  const game = new MemoryGame({ count: 12, players: 2, rng: createRng(2) });
  const [a, b] = mismatch(game);
  game.flip(a);
  game.flip(b);
  game.drain();
  const other = game.cards.findIndex((card, index) => index !== a && index !== b);
  assert.equal(game.flip(other), true);
  assert.deepEqual(types(game.drain()), ['hide', 'turn']);
  assert.equal(game.cards[other].state, 'down');
  assert.equal(game.current, 1);
  assert.equal(game.first, -1);
});

test('2인 대전: 먼저 하는 사람을 정할 수 있다', () => {
  assert.equal(new MemoryGame({ count: 12, players: 2, first: 1 }).current, 1);
  assert.equal(new MemoryGame({ count: 12, players: 1, first: 1 }).current, 0);
});

test('2인 대전: 짝을 더 많이 모은 사람이 이기고, 같으면 비긴다', () => {
  const play = (missAfter) => {
    const game = new MemoryGame({ count: 12, players: 2, rng: createRng(5) });
    const pairs = pairsOf(game);
    pairs.forEach(([a, b], n) => {
      if (n === missAfter) {
        // 일부러 틀려 차례를 넘긴다
        game.flip(a);
        game.flip(pairs[n + 1][0]);
        game.update(MISS_DELAY + 0.01);
      }
      game.flip(a);
      game.flip(b);
    });
    return game;
  };
  const sweep = play(-1);
  assert.deepEqual(sweep.scores, [6, 0]);
  assert.equal(sweep.winner, 0);
  const late = play(2);
  assert.deepEqual(late.scores, [2, 4]);
  assert.equal(late.winner, 1);
  const even = play(3);
  assert.deepEqual(even.scores, [3, 3]);
  assert.equal(even.winner, -1);
});

// ---------- 배치·표시 ----------

test('layoutFor 는 화면 비율에 맞춰 줄 수를 고른다', () => {
  for (const count of SIZES) {
    for (const aspect of [0.4, 0.6, 1, 1.6, 2.4]) {
      const { cols, rows } = layoutFor(count, aspect, 0.8);
      assert.equal(cols * rows, count);
      assert.ok(rows >= 2 && cols >= 2);
    }
  }
  assert.deepEqual(layoutFor(12, 0.5, 0.8), { cols: 3, rows: 4 });
  assert.deepEqual(layoutFor(12, 1.2, 0.8), { cols: 4, rows: 3 });
  assert.deepEqual(layoutFor(20, 0.5, 0.8), { cols: 4, rows: 5 });
  assert.deepEqual(layoutFor(30, 0.5, 0.8), { cols: 5, rows: 6 });
  assert.deepEqual(layoutFor(30, 3, 0.8), { cols: 10, rows: 3 });
});

test('formatTime', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(65.9), '1:05');
  assert.equal(formatTime(600), '10:00');
});

// ---------- 저장 ----------

test('최고 기록: 시간과 턴 수를 따로 겨룬다', () => {
  const store = new SaveStore(memoryStorage());
  assert.equal(store.loadBest(12), null);
  assert.deepEqual(store.recordBest(12, { time: 40, turns: 10 }), { time: true, turns: true });
  assert.deepEqual(store.recordBest(12, { time: 30, turns: 12 }), { time: true, turns: false });
  assert.deepEqual(store.loadBest(12), { time: 30, turns: 10 });
  assert.deepEqual(store.recordBest(12, { time: 35, turns: 8 }), { time: false, turns: true });
  assert.deepEqual(store.recordBest(12, { time: 50, turns: 20 }), { time: false, turns: false });
  assert.deepEqual(store.loadBest(12), { time: 30, turns: 8 });
  assert.equal(store.loadBest(20), null, '장수마다 따로 남는다');
});

test('최고 기록: 잘못된 값은 남기지도 읽지도 않는다', () => {
  const store = new SaveStore(memoryStorage({ [BEST_KEY]: '{"12":{"time":-1,"turns":3},"20":{"time":9,"turns":11}}' }));
  assert.equal(store.loadBest(12), null);
  assert.deepEqual(store.loadBest(20), { time: 9, turns: 11 });
  assert.deepEqual(store.recordBest(14, { time: 1, turns: 7 }), { time: false, turns: false });
  assert.deepEqual(store.recordBest(12, { time: NaN, turns: 7 }), { time: false, turns: false });
});

test('설정: 저장하고 읽으며, 잘못된 값은 기본값으로 바꾼다', () => {
  const store = new SaveStore(memoryStorage());
  assert.deepEqual(store.loadSettings(), DEFAULT_SETTINGS);
  store.saveSettings({ players: 2, size: 30, sound: false });
  assert.deepEqual(store.loadSettings(), { players: 2, size: 30, sound: false });
  const broken = new SaveStore(memoryStorage({ [SETTINGS_KEY]: '{"players":5,"size":13,"sound":"yes"}' }));
  assert.deepEqual(broken.loadSettings(), DEFAULT_SETTINGS);
});

test('저장소가 없거나 예외를 던져도 게임은 계속된다', () => {
  const none = new SaveStore(null);
  assert.deepEqual(none.loadSettings(), DEFAULT_SETTINGS);
  assert.equal(none.saveSettings(DEFAULT_SETTINGS), false);
  const throwing = new SaveStore({
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  });
  assert.equal(throwing.loadBest(12), null);
  assert.deepEqual(throwing.recordBest(12, { time: 10, turns: 6 }), { time: true, turns: true });
});
