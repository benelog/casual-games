import test from 'node:test';
import assert from 'node:assert/strict';
import { DefenseGame } from '../js/game.js';
import { SaveStore, serialize, validateSave, isBetterRecord, SAVE_KEY, BEST_KEY, SAVE_VERSION } from '../js/save.js';

class MemoryStorage {
  constructor() {
    this.data = new Map();
  }
  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }
  setItem(key, value) {
    this.data.set(key, String(value));
  }
  removeItem(key) {
    this.data.delete(key);
  }
}

// 사생활 보호 모드처럼 모든 접근이 예외를 던진다
const brokenStorage = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
  removeItem() {
    throw new Error('SecurityError');
  },
};

function playedGame() {
  const game = new DefenseGame({ gold: 500 });
  const { tower } = game.build('archer', 5, 3);
  game.upgrade(tower.id);
  game.build('frost', 9, 3);
  game.wave = 4;
  game.lives = 17;
  return game;
}

test('저장 → 불러오기 왕복이 같다', () => {
  const storage = new MemoryStorage();
  const store = new SaveStore(storage);
  const game = playedGame();
  assert.equal(store.sync(game, { speed: 2, now: 1234 }), true);

  const loaded = store.load();
  assert.deepEqual(loaded, {
    version: SAVE_VERSION,
    wave: 4,
    gold: 500 - 50 - 40 - 80,
    lives: 17,
    towers: [
      { type: 'archer', level: 2, col: 5, row: 3, invested: 90 },
      { type: 'frost', level: 1, col: 9, row: 3, invested: 80 },
    ],
    speed: 2,
    savedAt: 1234,
  });

  const restored = DefenseGame.fromSnapshot(loaded);
  assert.equal(restored.phase, 'build');
  assert.deepEqual(restored.snapshot(), game.snapshot());
  assert.deepEqual(serialize(restored, { speed: 2, now: 1234 }), loaded);
  // 복원한 타워도 정상적으로 다룰 수 있다
  const tower = restored.towerAt(5, 3);
  assert.equal(restored.upgrade(tower.id).ok, true);
});

test('잘못된 저장본은 조용히 버린다', () => {
  const good = serialize(playedGame(), { now: 1 });
  const cases = {
    '깨진 JSON': '{"version":1,',
    '버전 불일치': JSON.stringify({ ...good, version: 2 }),
    '배열': '[]',
    '목숨 0': JSON.stringify({ ...good, lives: 0 }),
    '음수 골드': JSON.stringify({ ...good, gold: -5 }),
    '웨이브 범위 밖': JSON.stringify({ ...good, wave: 20 }),
    '경로 위 타워': JSON.stringify({ ...good, towers: [{ type: 'archer', level: 1, col: 0, row: 1, invested: 50 }] }),
    '맵 밖 타워': JSON.stringify({ ...good, towers: [{ type: 'archer', level: 1, col: 30, row: 3, invested: 50 }] }),
    '모르는 타워': JSON.stringify({ ...good, towers: [{ type: 'laser', level: 1, col: 5, row: 3, invested: 50 }] }),
    '레벨 범위 밖': JSON.stringify({ ...good, towers: [{ type: 'archer', level: 4, col: 5, row: 3, invested: 50 }] }),
    '같은 칸에 두 개': JSON.stringify({
      ...good,
      towers: [
        { type: 'archer', level: 1, col: 5, row: 3, invested: 50 },
        { type: 'cannon', level: 1, col: 5, row: 3, invested: 100 },
      ],
    }),
  };
  for (const [name, text] of Object.entries(cases)) {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, text);
    const store = new SaveStore(storage);
    assert.equal(store.load(), null, name);
    assert.equal(storage.getItem(SAVE_KEY), null, `${name}: 지워진다`);
  }
  assert.equal(validateSave(null), null);
  assert.equal(new SaveStore(new MemoryStorage()).load(), null);
});

test('storage 가 예외를 던지거나 없어도 게임은 계속된다', () => {
  for (const storage of [brokenStorage, null, undefined]) {
    const store = new SaveStore(storage);
    const game = playedGame();
    assert.equal(store.load(), null);
    assert.equal(store.sync(game), false);
    assert.doesNotThrow(() => store.clear());
    assert.equal(store.loadBest(), null);
    assert.doesNotThrow(() => store.recordBest({ wave: 3, won: false, lives: 0 }));
  }
});

test('전투 중 변경은 저장본에 반영되지 않고 웨이브 시작 직전 상태가 남는다', () => {
  const storage = new MemoryStorage();
  const store = new SaveStore(storage);
  const game = new DefenseGame();
  game.build('archer', 5, 3);
  store.sync(game); // 건설 단계 변경 → 저장
  store.sync(game); // 웨이브 시작 직전 저장
  game.startWave();
  const atStart = store.load();
  assert.equal(atStart.gold, 150);
  assert.equal(atStart.wave, 0);

  // 전투 중에 팔고, 새로 짓고, 피해도 입는다
  game.sell(game.towerAt(5, 3).id);
  game.build('archer', 9, 3);
  game.build('archer', 9, 2);
  game.lives -= 3;
  assert.equal(store.sync(game), false);
  for (let i = 0; i < 120; i++) game.step();
  assert.equal(store.sync(game), false);

  assert.deepEqual(store.load(), atStart);
  const restored = DefenseGame.fromSnapshot(store.load());
  assert.equal(restored.gold, 150);
  assert.equal(restored.lives, 20);
  assert.deepEqual(
    restored.towers.map((t) => [t.col, t.row]),
    [[5, 3]],
  );
  assert.equal(restored.wave, 0); // 다시 1웨이브부터
});

test('웨이브를 클리어하면 저장되고, 게임이 끝나면 저장본을 지운다', () => {
  const storage = new MemoryStorage();
  const store = new SaveStore(storage);
  const waves = [[{ type: 'normal', count: 1, interval: 1 }], [{ type: 'normal', count: 1, interval: 1 }]];
  const game = new DefenseGame({ waves, gold: 500 });
  game.build('archer', 2, 2);
  game.build('archer', 4, 2);
  store.sync(game);
  game.startWave();
  while (game.phase === 'combat') game.step();
  assert.equal(game.phase, 'build');
  assert.equal(store.sync(game), true);
  assert.equal(new SaveStore(storage, { waves }).load().wave, 1);

  game.lives = 0;
  game.phase = 'lost';
  store.sync(game);
  assert.equal(storage.getItem(SAVE_KEY), null);
});

test('최고 기록', () => {
  const storage = new MemoryStorage();
  const store = new SaveStore(storage);
  assert.equal(store.recordBest({ wave: 5, won: false, lives: 0 }), true);
  assert.equal(store.recordBest({ wave: 4, won: false, lives: 0 }), false);
  assert.equal(store.recordBest({ wave: 20, won: true, lives: 7 }), true);
  assert.equal(store.recordBest({ wave: 20, won: true, lives: 3 }), false);
  assert.equal(store.recordBest({ wave: 20, won: true, lives: 12 }), true);
  assert.deepEqual(store.loadBest(), { wave: 20, won: true, lives: 12 });
  assert.equal(isBetterRecord({ wave: 20, won: true, lives: 1 }, { wave: 20, won: false, lives: 0 }), true);
  storage.setItem(BEST_KEY, 'not json');
  assert.equal(store.loadBest(), null);
});
