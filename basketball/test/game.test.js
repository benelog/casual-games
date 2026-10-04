import test from 'node:test';
import assert from 'node:assert/strict';
import { ShootoutGame, STAGES, TIME_LIMIT, TOTAL_SHOTS, SHOTS_PER_STAGE, MAKES_PER_STAGE, streakBonus } from '../js/game.js';
import { SaveStore, BEST_KEY, SETTINGS_KEY, DEFAULT_SETTINGS } from '../js/save.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

/** 공 하나를 던지고 결과를 적는다 */
function shoot(game, made, clean = false) {
  assert.ok(game.release(), '던질 수 있다');
  return game.record({ made, clean });
}

// ---------- 점수 ----------

test('연속 성공 보너스는 3연속부터 +1, 6연속 +2, 9연속 +3 에서 멈춘다', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 8, 9, 15].map(streakBonus), [0, 0, 1, 1, 1, 2, 2, 3, 3]);
});

test('들어가면 자리 점수에 연속·클린슛 보너스를 더하고, 실패하면 연속이 끊긴다', () => {
  const game = new ShootoutGame({ mode: 'shots' });
  assert.equal(shoot(game, true).points, 1); // 자유투 1점
  assert.equal(shoot(game, true, true).points, 2); // + 클린슛
  const third = shoot(game, true); // 엘보 2점 + 3연속 1점
  assert.equal(third.base, 2);
  assert.equal(third.bonus, 1);
  assert.equal(third.points, 3);
  assert.equal(game.streak[0], 3);
  const miss = shoot(game, false);
  assert.equal(miss.points, 0);
  assert.equal(game.streak[0], 0);
  assert.equal(game.bestStreak[0], 3);
  assert.equal(game.scores[0], 6);
  assert.deepEqual(game.result, { score: 6, makes: 3, shots: 4, streak: 3 });
});

test('결과가 나기 전에는 다음 공을 던질 수 없다', () => {
  const game = new ShootoutGame({ mode: 'time' });
  assert.ok(game.release());
  assert.equal(game.release(), false);
  game.record({ made: false });
  assert.ok(game.canShoot);
});

// ---------- 12구 ----------

test('12구: 자리마다 2개씩 던지고 다 던지면 끝난다', () => {
  const game = new ShootoutGame({ mode: 'shots' });
  const seen = [];
  let ups = 0;
  while (!game.over) {
    seen.push(game.stage.id);
    if (shoot(game, false).stageUp) ups++;
  }
  assert.equal(seen.length, TOTAL_SHOTS);
  assert.deepEqual(
    seen,
    STAGES.flatMap((s) => Array(SHOTS_PER_STAGE).fill(s.id)),
  );
  assert.equal(ups, STAGES.length - 1);
  assert.equal(game.canShoot, false);
});

// ---------- 60초 ----------

test('60초: 3개 넣을 때마다 다음 자리로, 마지막 자리에서 멈춘다', () => {
  const game = new ShootoutGame({ mode: 'time' });
  assert.equal(game.timeLeft, TIME_LIMIT);
  for (let i = 0; i < MAKES_PER_STAGE - 1; i++) assert.equal(shoot(game, true).stageUp, false);
  shoot(game, false); // 실패는 자리를 옮기지 않는다
  assert.equal(game.stageIndex(), 0);
  assert.equal(shoot(game, true).stageUp, true);
  assert.equal(game.stage.id, STAGES[1].id);
  for (let i = 0; i < 40; i++) shoot(game, true);
  assert.equal(game.stage.id, STAGES.at(-1).id);
});

test('60초: 시간이 다 되면 던질 수 없고, 날아가던 공은 결과까지 센다 (버저비터)', () => {
  const game = new ShootoutGame({ mode: 'time' });
  game.tick(TIME_LIMIT - 1);
  assert.ok(game.release());
  assert.equal(game.tick(2), true, '시간이 다 되었다');
  assert.equal(game.over, false, '공이 아직 날아간다');
  game.record({ made: true });
  assert.equal(game.scores[0], 1);
  assert.equal(game.over, true);
  assert.equal(game.canShoot, false);
  assert.equal(game.tick(1), false, '한 번만 알린다');
});

// ---------- 2인 대전 ----------

test('2인 대전: 번갈아 던지고, 각자 자기 자리를 따라가며, 점수가 높은 사람이 이긴다', () => {
  const game = new ShootoutGame({ mode: 'versus', first: 1 });
  assert.equal(game.current, 1);
  const order = [];
  while (!game.over) {
    order.push(game.current);
    // 플레이어 1(두 번째 사람)만 넣는다
    shoot(game, game.current === 1);
    game.nextTurn();
  }
  assert.equal(order.length, TOTAL_SHOTS * 2);
  assert.deepEqual(order.slice(0, 4), [1, 0, 1, 0]);
  assert.equal(game.shots[0], TOTAL_SHOTS);
  assert.equal(game.winner, 1);
  assert.equal(game.scores[0], 0);
  assert.ok(game.scores[1] > 0);
});

test('2인 대전: 점수가 같으면 무승부', () => {
  const game = new ShootoutGame({ mode: 'versus' });
  while (!game.over) {
    shoot(game, false);
    game.nextTurn();
  }
  assert.equal(game.winner, -1);
});

// ---------- 저장 ----------

test('설정을 검증해 읽고 쓴다', () => {
  const storage = memoryStorage({ [SETTINGS_KEY]: '{"mode":"nope","sound":3}' });
  const store = new SaveStore(storage);
  assert.deepEqual(store.loadSettings(), DEFAULT_SETTINGS);
  store.saveSettings({ mode: 'versus', sound: false });
  assert.deepEqual(store.loadSettings(), { mode: 'versus', sound: false });
});

test('모드별 최고 점수와 최고 연속 성공을 따로 겨룬다', () => {
  const store = new SaveStore(memoryStorage());
  assert.equal(store.loadBest('time'), null);
  assert.deepEqual(store.recordBest('time', { score: 20, makes: 10, shots: 15, streak: 4 }), { score: true, streak: true });
  // 점수는 낮지만 연속 성공은 더 길다
  assert.deepEqual(store.recordBest('time', { score: 12, makes: 7, shots: 9, streak: 7 }), { score: false, streak: true });
  assert.deepEqual(store.loadBest('time'), { score: 20, makes: 10, shots: 15, streak: 7 });
  assert.deepEqual(store.recordBest('time', { score: 25, makes: 12, shots: 20, streak: 3 }), { score: true, streak: false });
  assert.deepEqual(store.loadBest('time'), { score: 25, makes: 12, shots: 20, streak: 7 });
  assert.deepEqual(store.recordBest('time', { score: 1, makes: 1, shots: 1, streak: 1 }), { score: false, streak: false });
  assert.equal(store.loadBest('shots'), null, '모드마다 따로');
  assert.deepEqual(store.recordBest('versus', { score: 9, makes: 1, shots: 1, streak: 1 }), { score: false, streak: false });
  assert.deepEqual(store.recordBest('shots', { score: -1, makes: 0, shots: 0, streak: 0 }), { score: false, streak: false });
});

test('깨진 기록은 버리고, 저장소가 막혀도 게임은 계속된다', () => {
  const storage = memoryStorage({ [BEST_KEY]: '{"time":{"score":5,"makes":9,"shots":3,"streak":1},"shots":{"score":3,"makes":2,"shots":2,"streak":2}}' });
  const store = new SaveStore(storage);
  assert.deepEqual(store.loadAllBest(), { shots: { score: 3, makes: 2, shots: 2, streak: 2 } });
  const blocked = new SaveStore({
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {},
  });
  assert.equal(blocked.loadBest('time'), null);
  assert.deepEqual(blocked.recordBest('time', { score: 3, makes: 2, shots: 2, streak: 2 }), { score: true, streak: true });
});
