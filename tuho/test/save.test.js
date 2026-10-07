import test from 'node:test';
import assert from 'node:assert/strict';
import { SaveStore, DEFAULT_SETTINGS, BEST_KEY, RECORD_KEY, SETTINGS_KEY, validateSettings } from '../js/save.js';

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

test('설정: 잘못된 값은 기본값으로 바꾼다', () => {
  assert.deepEqual(validateSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(validateSettings({ mode: 'cpu', level: 'hard', players: 4, arrows: 5 }), {
    mode: 'cpu',
    level: 'hard',
    players: 4,
    arrows: 5,
  });
  assert.deepEqual(validateSettings({ mode: 'online', level: 'god', players: 9, arrows: 7 }), DEFAULT_SETTINGS);
  const store = new SaveStore(memoryStorage());
  store.saveSettings({ ...DEFAULT_SETTINGS, mode: 'multi', players: 3 });
  assert.equal(store.loadSettings().players, 3);
});

test('혼자서 최고 기록은 점수가 오를 때만 바뀐다', () => {
  const storage = memoryStorage();
  const store = new SaveStore(storage);
  assert.equal(store.loadBest(), null);
  assert.equal(store.recordBest({ score: 12, hits: 5, ears: 1 }), true);
  assert.equal(store.recordBest({ score: 10, hits: 5, ears: 0 }), false);
  assert.equal(store.recordBest({ score: 12, hits: 6, ears: 0 }), false);
  assert.equal(store.recordBest({ score: 21, hits: 7, ears: 2 }), true);
  assert.deepEqual(store.loadBest(), { score: 21, hits: 7, ears: 2 });
  assert.equal(store.recordBest({ score: 999, hits: 11, ears: 0 }), false, '있을 수 없는 기록은 버린다');
  storage.setItem(BEST_KEY, '{"score":"lots"}');
  assert.equal(store.loadBest(), null);
});

test('컴퓨터 상대 전적은 실력마다 따로 센다', () => {
  const storage = memoryStorage();
  const store = new SaveStore(storage);
  store.recordResult('easy', 'win');
  store.recordResult('easy', 'loss');
  store.recordResult('easy', 'draw');
  store.recordResult('hard', 'loss');
  assert.deepEqual(store.loadRecord('easy'), { wins: 1, losses: 1, draws: 1 });
  assert.deepEqual(store.loadRecord('hard'), { wins: 0, losses: 1, draws: 0 });
  assert.equal(store.loadRecord('normal'), null);
  assert.equal(store.recordResult('god', 'win'), null);
  storage.setItem(RECORD_KEY, '{"easy":{"wins":-1,"losses":0}}');
  assert.equal(store.loadRecord('easy'), null);
});

test('저장소가 막혀 있어도 예외 없이 기본값으로 돈다', () => {
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
  assert.equal(store.recordBest({ score: 3, hits: 1, ears: 0 }), false);
  assert.ok(store.recordResult('normal', 'win'));
  assert.equal(new SaveStore(null).saveSettings(DEFAULT_SETTINGS), false);
  assert.equal(SETTINGS_KEY, 'casual-games.tuho.settings.v1');
});
