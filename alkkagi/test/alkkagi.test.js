import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Board,
  makeStone,
  STONE_RADIUS,
  HALF_X,
  HALF_Z,
  GRID_X,
  GRID_Z,
  SPEED_MAX,
  DECEL,
  STEP,
  speedOfPower,
  powerOfSpeed,
  slideDistance,
  direction,
  angleOf,
  firstContact,
  distanceToEdge,
} from '../js/physics.js';
import { AlkkagiMatch, initialStones, STONE_OPTIONS } from '../js/game.js';
import { chooseShot, candidates, evaluate, simulate, LEVELS, LEVEL_IDS } from '../js/ai.js';
import { SaveStore, SETTINGS_KEY, RECORD_KEY, DEFAULT_SETTINGS } from '../js/save.js';
import { createRng } from '../../shared/util.js';

const near = (a, b, eps) => Math.abs(a - b) <= eps;
const stone = (team, x, z) => makeStone(team, x, z);
const outsOf = (events) => events.filter((e) => e.type === 'out').map((e) => e.stone);

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

// ---------- 물리 ----------

test('방향 각도: 0 은 백 쪽(-z), + 는 오른쪽', () => {
  assert.ok(near(direction(0).z, -1, 1e-12));
  assert.ok(near(direction(Math.PI / 2).x, 1, 1e-12));
  for (const a of [-2.5, -1, 0, 0.3, 1.7, 3]) {
    const d = direction(a);
    assert.ok(near(angleOf(d.x, d.z), a, 1e-12));
  }
});

test('세기와 속도는 서로 바뀌고, 미끄러지는 거리는 세기에 비례한다', () => {
  assert.equal(speedOfPower(0), 0);
  assert.equal(speedOfPower(1), SPEED_MAX);
  for (const p of [0.1, 0.35, 0.8]) assert.ok(near(powerOfSpeed(speedOfPower(p)), p, 1e-12));
  assert.ok(near(slideDistance(speedOfPower(0.5)) / slideDistance(speedOfPower(0.25)), 2, 1e-9));
});

test('빈 판에서 돌은 마찰로 일정하게 느려져 v²/2a 만큼 가서 멈춘다', () => {
  const board = new Board([stone(0, 0, 0.15)]);
  const id = board.stones[0].id;
  const speed = 0.6;
  board.flick(id, { angle: 0, speed });
  board.run();
  const s = board.byId(id);
  assert.equal(s.moving, false);
  assert.ok(s.inPlay);
  assert.ok(near(0.15 - s.z, slideDistance(speed), 0.002), `${0.15 - s.z}`);
  assert.ok(near(s.x, 0, 1e-12));
  // 걸린 시간도 v/a
  assert.ok(near(board.time, speed / DECEL, 0.01));
  const events = board.drain().map((e) => e.type);
  assert.deepEqual(events, ['flick', 'stop']);
});

test('같은 수는 언제나 같은 결과 (프레임 길이와 상관없이)', () => {
  const stones = initialStones(5);
  const shoot = (advance) => {
    const board = new Board(stones);
    const black = board.stonesOf(0)[2];
    board.flick(black.id, { angle: 0.02, speed: 1.3 });
    advance(board);
    return board.stones.map(({ id, x, z, inPlay }) => ({ id, x, z, inPlay }));
  };
  const a = shoot((b) => b.run());
  const b = shoot((b) => {
    while (b.moving) b.advance(1 / 60);
  });
  const c = shoot((b) => {
    while (b.moving) b.advance(1 / 144);
  });
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
});

test('정면 충돌: 운동량이 보존되고 맞힌 돌은 거의 멈춘다', () => {
  const board = new Board([stone(0, 0, 0.1), stone(1, 0, 0)]);
  const [a, b] = board.stones;
  board.flick(a.id, { angle: 0, speed: 0.8 });
  let before = null;
  while (!board.events.some((e) => e.type === 'hit')) {
    before = a.vz + b.vz;
    board.substep(STEP);
  }
  // 충돌 직후: 운동량 보존 (같은 무게), 반발 계수만큼 에너지를 잃는다
  assert.ok(near(a.vz + b.vz, before, DECEL * STEP * 1.5), `${a.vz + b.vz} vs ${before}`); // 그 한 걸음의 마찰만큼만 다르다
  assert.ok(Math.abs(a.vz) < Math.abs(b.vz) * 0.1);
  assert.ok(b.vz < 0);
  board.run();
  assert.ok(b.z < -0.1, '맞은 돌이 앞으로 밀려 간다');
  assert.ok(a.z > -0.03 && a.z < 0.1, '맞힌 돌은 부딪친 자리 근처에 남는다');
  // 겹친 채로 멈추지 않는다
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 2 * STONE_RADIUS - 1e-6);
});

test('비껴 맞히면 두 돌이 서로 직각에 가깝게 갈라진다', () => {
  const board = new Board([stone(0, 0, 0.1), stone(1, STONE_RADIUS, 0)]);
  const [a, b] = board.stones;
  board.flick(a.id, { angle: 0, speed: 0.9 });
  while (!board.events.some((e) => e.type === 'hit')) board.substep(STEP);
  board.substep(STEP);
  const dot = (a.vx * b.vx + a.vz * b.vz) / (Math.hypot(a.vx, a.vz) * Math.hypot(b.vx, b.vz));
  assert.ok(Math.abs(dot) < 0.15, `cos=${dot}`);
  assert.ok(a.vx < 0 && b.vx > 0, '맞힌 돌은 왼쪽, 맞은 돌은 오른쪽으로');
});

test('중심이 판 가장자리를 넘은 돌은 떨어져 빠지고, 그 순간의 속도를 알린다', () => {
  const board = new Board([stone(0, 0, -HALF_Z + 0.05)]);
  const s = board.stones[0];
  board.flick(s.id, { angle: 0, speed: 0.6 });
  board.run();
  const events = board.drain();
  const out = events.find((e) => e.type === 'out');
  assert.ok(out);
  assert.equal(out.stone, s);
  assert.ok(out.z < -HALF_Z && out.vz < 0);
  assert.equal(s.inPlay, false);
  assert.equal(board.count(0), 0);
  assert.equal(events.at(-1).type, 'stop');
});

test('가장자리 바로 앞에서 멈춘 돌은 떨어지지 않는다', () => {
  const start = -HALF_Z + 0.08;
  const speed = Math.sqrt(2 * DECEL * 0.075); // 7.5cm 만 간다
  const board = new Board([stone(0, 0.1, start)]);
  board.flick(board.stones[0].id, { angle: 0, speed });
  board.run();
  assert.equal(board.stones[0].inPlay, true);
  assert.ok(board.stones[0].z > -HALF_Z);
});

test('세게 맞히면 맞은 돌이 판 밖으로, 약하게 맞히면 판 위에 남는다', () => {
  const setup = () => new Board([stone(0, 0, 0.1), stone(1, 0, -0.1)]);
  const strong = setup();
  strong.flick(strong.stones[0].id, { angle: 0, speed: 1.4 });
  strong.run();
  assert.equal(strong.stones[1].inPlay, false);
  assert.equal(strong.stones[0].inPlay, true);
  const soft = setup();
  soft.flick(soft.stones[0].id, { angle: 0, speed: 0.75 });
  soft.run();
  assert.equal(soft.stones[1].inPlay, true);
});

test('여러 돌이 줄줄이 부딪쳐도 겹치지 않고 모두 멈춘다', () => {
  const stones = [stone(0, 0, 0.15)];
  for (let i = 0; i < 6; i++) stones.push(stone(1, (i % 2) * 0.004, 0.05 - i * 0.0225));
  const board = new Board(stones);
  board.flick(board.stones[0].id, { angle: 0, speed: 1.2 });
  board.run();
  assert.equal(board.moving, false);
  const live = board.inPlay;
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      assert.ok(Math.hypot(live[i].x - live[j].x, live[i].z - live[j].z) > 2 * STONE_RADIUS - 1e-4);
    }
  }
  const front = board.stones.at(-1);
  assert.ok(front.z < 0.05 - 5 * 0.0225 - 0.02, '맨 앞 돌까지 힘이 전해져 밀려 나간다');
});

test('조준선: 처음 닿는 돌과 가장자리까지의 거리', () => {
  const from = stone(0, 0, 0.1);
  const a = stone(1, 0.005, 0);
  const b = stone(1, 0, -0.1);
  const behind = stone(1, 0, 0.2);
  const contact = firstContact(from, 0, [from, b, a, behind]);
  assert.equal(contact.stone, a);
  // 가로로 0.005 떨어진 돌에 닿는 순간 중심 사이 거리는 지름
  assert.ok(near(Math.hypot(contact.x - a.x, contact.z - a.z), 2 * STONE_RADIUS, 1e-9));
  assert.equal(firstContact(from, Math.PI / 2, [a, b, behind]), null);
  assert.ok(near(distanceToEdge(0, 0.1, 0), HALF_Z + 0.1, 1e-12));
  assert.ok(near(distanceToEdge(0, 0, Math.PI / 2), HALF_X, 1e-12));
});

// ---------- 규칙 ----------

test('처음 배치: 편마다 같은 수, 흑은 아래 백은 위에 대칭으로, 줄 위에 겹치지 않게', () => {
  for (const n of STONE_OPTIONS) {
    const stones = initialStones(n);
    const black = stones.filter((s) => s.team === 0);
    const white = stones.filter((s) => s.team === 1);
    assert.equal(black.length, n);
    assert.equal(white.length, n);
    for (const s of black) assert.ok(s.z > 0);
    for (const s of white) assert.ok(s.z < 0);
    for (const s of black) assert.ok(white.some((w) => near(w.x, -s.x, 1e-12) && near(w.z, -s.z, 1e-12)));
    for (const s of stones) {
      assert.ok(near(s.x / GRID_X, Math.round(s.x / GRID_X), 1e-9));
      assert.ok(near(s.z / GRID_Z, Math.round(s.z / GRID_Z), 1e-9));
      assert.ok(Math.abs(s.x) < HALF_X - 0.03 && Math.abs(s.z) < HALF_Z - 0.03);
    }
    for (let i = 0; i < stones.length; i++) {
      for (let j = i + 1; j < stones.length; j++) {
        assert.ok(Math.hypot(stones[i].x - stones[j].x, stones[i].z - stones[j].z) > 2 * STONE_RADIUS);
      }
    }
  }
  assert.throws(() => initialStones(4));
});

test('번갈아 튕기고, 상대 돌을 모두 떨어뜨리면 이긴다', () => {
  const match = new AlkkagiMatch({ stones: 3, starter: 0 });
  assert.equal(match.current, 0);
  let result = match.finishShot([]);
  assert.deepEqual(result, { knocked: 0, lost: 0, winner: null, over: false, next: 1 });
  assert.equal(match.current, 1);
  // 백이 흑 하나를 떨어뜨린다
  const black = match.board.stonesOf(0)[0];
  black.inPlay = false;
  result = match.finishShot([black]);
  assert.equal(result.knocked, 1);
  assert.equal(match.knocked[1], 1);
  assert.equal(match.current, 0);
  // 흑이 백을 모두 떨어뜨린다
  const whites = match.board.stonesOf(1);
  for (const s of whites) s.inPlay = false;
  result = match.finishShot(whites);
  assert.equal(result.over, true);
  assert.equal(match.winner, 0);
  assert.equal(match.reason, 'all');
  assert.equal(match.turns, 3);
  assert.throws(() => match.finishShot([]));
});

test('자기 돌이 모두 떨어지면 지고, 한 수에 양쪽이 모두 떨어지면 튕긴 쪽이 진다', () => {
  const self = new AlkkagiMatch({ stones: 3, starter: 1 });
  const whites = self.board.stonesOf(1);
  for (const s of whites) s.inPlay = false;
  const r = self.finishShot(whites);
  assert.equal(r.lost, 3);
  assert.equal(self.winner, 0);
  assert.equal(self.reason, 'self');

  const both = new AlkkagiMatch({ stones: 3, starter: 0 });
  const all = both.board.inPlay;
  for (const s of all) s.inPlay = false;
  both.finishShot(all);
  assert.equal(both.winner, 1);
  assert.equal(both.reason, 'both');
});

test('canFlick: 지금 차례인 편의 판 위 돌만', () => {
  const match = new AlkkagiMatch({ stones: 3, starter: 0 });
  const [b] = match.board.stonesOf(0);
  const [w] = match.board.stonesOf(1);
  assert.equal(match.canFlick(0, b.id), true);
  assert.equal(match.canFlick(0, w.id), false);
  assert.equal(match.canFlick(1, w.id), false);
  b.inPlay = false;
  assert.equal(match.canFlick(0, b.id), false);
  assert.equal(match.isHuman(1), false);
  assert.equal(new AlkkagiMatch({ mode: 'versus' }).isHuman(1), true);
});

// ---------- 컴퓨터 ----------

test('평가: 떨어뜨린 상대 돌은 좋고 잃은 내 돌은 나쁘며, 이기고 지는 수는 끝값', () => {
  const before = [stone(0, 0, 0.1), stone(0, 0.1, 0.1), stone(1, 0, -0.1), stone(1, 0.1, -0.1)];
  const knock = before.map((s) => ({ ...s }));
  knock[2].inPlay = false;
  const lose = before.map((s) => ({ ...s }));
  lose[0].inPlay = false;
  assert.ok(evaluate(before, knock, 0) > evaluate(before, before, 0));
  assert.ok(evaluate(before, lose, 0) < evaluate(before, before, 0));
  const win = before.map((s) => ({ ...s, inPlay: s.team === 0 }));
  assert.equal(evaluate(before, win, 0), 1000);
  const both = before.map((s) => ({ ...s, inPlay: false }));
  assert.equal(evaluate(before, both, 0), -1000);
});

test('컴퓨터는 쉬운 상대 돌을 떨어뜨리는 수를 고른다', () => {
  // 백 돌 바로 앞에 가장자리에 붙은 흑 돌 하나
  const stones = [stone(1, 0, -0.1), stone(0, 0.03, 0.15), stone(0, -0.12, -HALF_Z + 0.03)];
  for (const level of ['normal', 'hard']) {
    const choice = chooseShot(stones, 1, level, createRng(3));
    const after = simulate(stones, choice.stoneId, choice.plan);
    assert.ok(evaluate(stones, after, 1) > 5, `${level}: ${choice.value}`);
  }
});

test('컴퓨터는 이기는 수가 있으면 반드시 그것을 노린다 (쉬움도)', () => {
  const stones = [stone(1, 0, -0.05), stone(0, 0, 0.02), stone(1, 0.15, -0.15)];
  const choice = chooseShot(stones, 1, 'easy', createRng(9));
  assert.equal(choice.value, 1000);
  const after = simulate(stones, choice.stoneId, choice.plan);
  assert.equal(after.filter((s) => s.inPlay && s.team === 0).length, 0);
});

test('후보는 자기 돌로만 만들고, 실력이 높으면 비껴 맞히는 수도 본다', () => {
  const stones = initialStones(5);
  const easy = candidates(stones, 1, LEVELS.easy);
  const hard = candidates(stones, 1, LEVELS.hard);
  const own = new Set(stones.filter((s) => s.team === 1).map((s) => s.id));
  for (const c of [...easy, ...hard]) {
    assert.ok(own.has(c.stoneId));
    assert.ok(c.shot.speed > 0 && c.shot.speed <= SPEED_MAX);
  }
  assert.ok(hard.length > easy.length);
});

test('같은 판·같은 난수면 같은 수, 실력마다 결과가 나온다', () => {
  const stones = initialStones(5);
  for (const level of LEVEL_IDS) {
    const a = chooseShot(stones, 0, level, createRng(5));
    const b = chooseShot(stones, 0, level, createRng(5));
    assert.deepEqual(a, b);
    assert.ok(stones.some((s) => s.id === a.stoneId && s.team === 0));
  }
  assert.throws(() => chooseShot(stones, 0, 'genius'));
});

test('컴퓨터끼리 두면 판이 끝나고, 어려움이 쉬움보다 자주 이긴다', () => {
  const rng = createRng(11);
  let hardWins = 0;
  const games = 10;
  for (let g = 0; g < games; g++) {
    const match = new AlkkagiMatch({ stones: 5, starter: g % 2 });
    const levels = g % 4 < 2 ? ['hard', 'easy'] : ['easy', 'hard'];
    let turns = 0;
    while (!match.over && turns < 80) {
      const team = match.current;
      const choice = chooseShot(match.board.stones, team, levels[team], rng);
      match.board.flick(choice.stoneId, choice.shot);
      match.board.run();
      match.finishShot(outsOf(match.board.drain()));
      turns++;
    }
    assert.ok(match.over, '판이 끝난다');
    if (levels[match.winner] === 'hard') hardWins++;
  }
  assert.ok(hardWins >= games * 0.6, `어려움 ${hardWins}/${games} 승`);
});

// ---------- 저장 ----------

test('설정: 저장하고 읽으며, 잘못된 값은 기본값으로', () => {
  const storage = memoryStorage();
  const store = new SaveStore(storage);
  assert.deepEqual(store.loadSettings(), DEFAULT_SETTINGS);
  store.saveSettings({ opponent: 'versus', level: 'hard', stones: 7, sound: false });
  assert.deepEqual(store.loadSettings(), { opponent: 'versus', level: 'hard', stones: 7, sound: false });
  storage.setItem(SETTINGS_KEY, JSON.stringify({ opponent: 'alien', level: 'x', stones: 4, sound: 'yes' }));
  assert.deepEqual(store.loadSettings(), DEFAULT_SETTINGS);
  storage.setItem(SETTINGS_KEY, '{broken');
  assert.deepEqual(store.loadSettings(), DEFAULT_SETTINGS);
});

test('전적: 실력마다 더하고, 깨진 기록은 버린다', () => {
  const storage = memoryStorage();
  const store = new SaveStore(storage);
  assert.equal(store.loadRecord('normal'), null);
  store.recordResult('normal', true);
  store.recordResult('normal', false);
  store.recordResult('hard', true);
  assert.deepEqual(store.loadRecord('normal'), { wins: 1, losses: 1 });
  assert.deepEqual(store.loadRecord('hard'), { wins: 1, losses: 0 });
  assert.equal(store.recordResult('genius', true), null);
  storage.setItem(RECORD_KEY, JSON.stringify({ easy: { wins: -1, losses: 2 }, normal: { wins: 3, losses: 0 } }));
  assert.deepEqual(store.loadAllRecords(), { normal: { wins: 3, losses: 0 } });
  // 저장소가 없어도 게임은 계속된다
  const none = new SaveStore(null);
  assert.equal(none.saveSettings(DEFAULT_SETTINGS), false);
  assert.deepEqual(none.loadSettings(), DEFAULT_SETTINGS);
});
