import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Sheet,
  makeStone,
  STONE_RADIUS,
  HOUSE_RADIUS,
  HALF_WIDTH,
  HOG_Z,
  BACK_Z,
  RELEASE_Z,
  SPEED_MAX,
  WEIGHT_KNOTS,
  restingPoint,
  solveDraw,
  solveHit,
  pathXAt,
  speedOfPower,
  powerOfSpeed,
  broomX,
  angleToward,
  inHouse,
} from '../js/physics.js';
import { CurlingMatch, scoreEnd } from '../js/game.js';
import { chooseShot, candidates, evaluate, LEVEL_IDS } from '../js/ai.js';
import { SaveStore, SETTINGS_KEY, RECORD_KEY, DEFAULT_SETTINGS } from '../js/save.js';
import { createRng } from '../../shared/util.js';

const stone = (team, x, z) => makeStone(team, x, z);

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

// ---------- 점수 ----------

test('버튼에 가장 가까운 팀만, 상대 1번 스톤보다 안쪽 스톤 수만큼 점수를 얻는다', () => {
  const result = scoreEnd([stone(0, 0, 0.1), stone(0, 0.3, 0), stone(1, 0, 0.6), stone(0, 0, -1.0)]);
  assert.equal(result.team, 0);
  assert.equal(result.points, 2);
  assert.equal(result.counting.length, 2);
});

test('상대 스톤이 하우스에 없으면 하우스 안의 자기 스톤을 모두 센다', () => {
  const result = scoreEnd([stone(1, 0.5, 0.5), stone(1, -1.2, 0.2), stone(0, 0, 4), stone(1, 0, 3)]);
  assert.equal(result.team, 1);
  assert.equal(result.points, 2);
});

test('하우스에 걸치기만 해도 세고, 밖이면 세지 않는다', () => {
  const edge = HOUSE_RADIUS + STONE_RADIUS - 0.01;
  assert.equal(inHouse(stone(0, edge, 0)), true);
  assert.equal(inHouse(stone(0, edge + 0.02, 0)), false);
  assert.deepEqual(scoreEnd([stone(0, 0, edge + 0.02)]).points, 0);
});

test('하우스에 스톤이 없으면 블랭크, 빠진 스톤은 세지 않는다', () => {
  assert.equal(scoreEnd([]).team, -1);
  const out = stone(0, 0, 0);
  out.inPlay = false;
  assert.equal(scoreEnd([out, stone(0, 0, 5)]).team, -1);
});

test('두 팀의 1번 스톤이 똑같이 가까우면 블랭크', () => {
  const result = scoreEnd([stone(0, 0.4, 0), stone(1, -0.4, 0)]);
  assert.equal(result.team, -1);
  assert.equal(result.points, 0);
});

// ---------- 경기 진행 ----------

test('해머가 없는 팀부터 번갈아 던지고 해머 팀이 마지막에 던진다', () => {
  const match = new CurlingMatch({ ends: 2, stones: 3, hammer: 1 });
  const order = [];
  while (!match.endComplete) {
    order.push(match.current);
    if (match.lastStone) assert.equal(match.current, 1);
    match.thrown();
  }
  assert.deepEqual(order, [0, 1, 0, 1, 0, 1]);
  assert.throws(() => match.thrown());
});

test('남은 스톤 수를 팀마다 센다', () => {
  const match = new CurlingMatch({ stones: 4, hammer: 0 });
  assert.equal(match.stonesLeft(0), 4);
  assert.equal(match.stonesLeft(1), 4);
  match.thrown(); // 팀 1 이 먼저
  assert.equal(match.stonesLeft(1), 3);
  assert.equal(match.stonesLeft(0), 4);
  match.thrown();
  assert.equal(match.stonesLeft(0), 3);
});

test('점수를 낸 팀의 상대가 해머를 갖고, 블랭크면 해머가 그대로다', () => {
  const match = new CurlingMatch({ ends: 4, stones: 1, hammer: 1 });
  const throwAll = () => {
    while (!match.endComplete) match.thrown();
  };
  throwAll();
  let r = match.finishEnd({ team: 1, points: 2 });
  assert.equal(r.hammer, 0);
  assert.equal(match.hammer, 0);
  throwAll();
  r = match.finishEnd({ team: -1, points: 0 });
  assert.equal(r.blank, true);
  assert.equal(match.hammer, 0);
  throwAll();
  r = match.finishEnd({ team: 1, points: 1 }); // 해머 없는 팀이 스틸
  assert.equal(match.hammer, 0);
  assert.deepEqual(match.scores[1], [2, 0, 1]);
  assert.deepEqual(match.scores[0], [0, 0, 0]);
  assert.equal(match.total(1), 3);
});

test('정한 엔드를 마치면 끝나고, 같으면 엑스트라 엔드를 한다', () => {
  const match = new CurlingMatch({ ends: 2, stones: 1, hammer: 1 });
  match.finishEnd({ team: 0, points: 1 });
  match.finishEnd({ team: 1, points: 1 });
  assert.equal(match.over, false);
  assert.equal(match.extra, true);
  match.finishEnd({ team: -1, points: 0 });
  assert.equal(match.over, false);
  const r = match.finishEnd({ team: 1, points: 2 });
  assert.equal(r.gameOver, true);
  assert.equal(match.winner, 1);
  assert.throws(() => match.finishEnd({ team: 0, points: 1 }));
});

test('컴퓨터 대전에서는 팀 0 만 사람이다', () => {
  assert.equal(new CurlingMatch({ mode: 'computer' }).isHuman(1), false);
  assert.equal(new CurlingMatch({ mode: 'versus' }).isHuman(1), true);
});

// ---------- 물리 ----------

test('던진 스톤은 느려지다 멈추고, 시계 방향이면 오른쪽으로 휜다', () => {
  const right = restingPoint({ angle: 0, speed: 2.1, spin: 1 });
  const left = restingPoint({ angle: 0, speed: 2.1, spin: -1 });
  assert.ok(right.x > 0.5, `오른쪽으로 휘어야 한다: ${right.x}`);
  assert.ok(Math.abs(right.x + left.x) < 1e-6, '반대로 돌리면 반대로 같은 만큼 휜다');
  assert.ok(Math.abs(right.z - left.z) < 1e-6);
  assert.ok(right.z < HOG_Z && right.z > BACK_Z);
});

test('드로는 테이크아웃보다 많이 휜다', () => {
  const draw = restingPoint({ angle: 0, speed: 2.1, spin: 1 }).x;
  const hit = pathXAt({ angle: 0, speed: 3.2, spin: 1 }, 0);
  assert.ok(draw > hit * 3, `${draw} vs ${hit}`);
});

test('스위핑하면 더 멀리, 덜 휘게 간다', () => {
  const shot = { angle: 0, speed: 2.0, spin: 1 };
  const plain = restingPoint(shot);
  const swept = restingPoint(shot, { sweep: 1 });
  assert.ok(swept.z < plain.z - 1, `더 멀리: ${plain.z} → ${swept.z}`);
  // 같은 거리에서 비교: 스위핑한 스톤이 같은 z 를 지날 때 덜 휘어 있다
  const sheet = new Sheet();
  const s = sheet.deliver(0, shot);
  sheet.sweeping = 1;
  while (sheet.moving && s.z > plain.z) sheet.substep(1 / 240);
  assert.ok(s.x < plain.x, `덜 휜다: ${plain.x} vs ${s.x}`);
});

test('solveDraw 는 빈 시트에서 노린 자리에 멈추게 한다', () => {
  for (const [x, z, spin] of [
    [0, 0, 1],
    [0.6, 0.4, -1],
    [-0.8, 3.2, 1],
  ]) {
    const shot = solveDraw(x, z, spin);
    const end = restingPoint(shot);
    assert.ok(Math.hypot(end.x - x, end.z - z) < 0.05, `(${x}, ${z}) → (${end.x}, ${end.z})`);
  }
});

test('solveHit 은 노린 점을 지나가게 한다', () => {
  const shot = solveHit(0.5, 0.2, -1, 3.0);
  assert.ok(Math.abs(pathXAt(shot, 0.2) - 0.5) < 0.01);
});

test('정면으로 맞히면 맞은 스톤이 대부분의 속도를 받아 나간다', () => {
  const sheet = new Sheet([stone(1, 0, 0)]);
  const target = sheet.stones[0];
  const shooter = sheet.deliver(0, solveHit(0, 0, 1, 3.0));
  shooter.spin = 0; // 곧게
  shooter.vx = 0;
  const hits = [];
  while (sheet.moving) {
    sheet.step(1 / 60);
    for (const e of sheet.drain()) if (e.type === 'hit') hits.push(e);
  }
  assert.ok(hits.length >= 1);
  assert.equal(target.inPlay, false, '맞은 스톤은 백 라인 밖으로');
  assert.equal(shooter.inPlay, true, '던진 스톤은 하우스 근처에 남는다 (히트 앤 스테이)');
  assert.ok(Math.abs(shooter.z) < 1.5, `${shooter.z}`);
});

test('충돌은 운동량을 보존하고 운동 에너지를 늘리지 않는다', () => {
  const sheet = new Sheet([stone(1, 0.1, 0)]);
  const shooter = sheet.deliver(0, { angle: 0, speed: 3, spin: 0 });
  shooter.z = 2 * STONE_RADIUS + 0.004;
  shooter.vx = 0;
  shooter.vz = -2;
  const target = sheet.stones[0];
  const before = { px: shooter.vx + target.vx, pz: shooter.vz + target.vz, e: shooter.vz ** 2 };
  sheet.collide(shooter); // 겹치지 않으면 아무 일도 없다
  shooter.z = 0.25;
  sheet.collide(shooter);
  assert.ok(Math.abs(shooter.vx + target.vx - before.px) < 1e-9);
  assert.ok(Math.abs(shooter.vz + target.vz - before.pz) < 1e-9);
  const after = shooter.vx ** 2 + shooter.vz ** 2 + target.vx ** 2 + target.vz ** 2;
  assert.ok(after <= before.e + 1e-9);
  assert.ok(target.vz < 0 && target.vx > 0, '맞은 쪽 반대로 밀려난다');
});

test('호그 라인을 넘지 못한 스톤은 빠지지만, 다른 스톤을 맞혔으면 남는다', () => {
  const sheet = new Sheet();
  const short = sheet.deliver(0, { angle: 0, speed: 1.6, spin: 0 });
  sheet.run();
  assert.equal(short.inPlay, false);
  assert.ok(sheet.drain().some((e) => e.type === 'out' && e.reason === 'hog'));

  // 호그 라인 바로 앞의 스톤을 살짝 맞히고 멈춘 경우
  const z = HOG_Z + 0.5;
  const sheet2 = new Sheet([stone(1, 0, z - 0.25)]);
  const shooter = sheet2.deliver(0, { angle: 0, speed: Math.sqrt(2 * 0.074 * (RELEASE_Z - z)), spin: 0 });
  sheet2.run();
  assert.equal(shooter.hit, true);
  assert.equal(shooter.inPlay, true);
});

test('백 라인을 넘거나 옆 선에 닿으면 빠진다', () => {
  const back = new Sheet();
  const far = back.deliver(0, { angle: 0, speed: 3.2, spin: 0 });
  back.run();
  assert.equal(far.inPlay, false);
  assert.ok(back.drain().some((e) => e.reason === 'back'));

  const side = new Sheet();
  const wide = side.deliver(0, { angle: 0.08, speed: 2.4, spin: 1 });
  side.run();
  assert.equal(wide.inPlay, false);
  assert.ok(side.drain().some((e) => e.reason === 'side'));
  assert.ok(Math.abs(wide.x) >= HALF_WIDTH - STONE_RADIUS - 0.05);
});

test('세기 게이지는 단조롭게 속도로 바뀌고 되돌릴 수 있다', () => {
  let last = 0;
  for (let p = 0; p <= 1.0001; p += 0.05) {
    const v = speedOfPower(p);
    assert.ok(v > last);
    assert.ok(Math.abs(powerOfSpeed(v) - Math.min(1, p)) < 1e-9);
    last = v;
  }
  assert.equal(speedOfPower(1), SPEED_MAX);
  // 하우스 구간에서 던지면 하우스 안에 멈춘다
  const [, [, hog], [pFront], [pBack]] = WEIGHT_KNOTS;
  assert.ok(hog > speedOfPower(0));
  const mid = restingPoint({ angle: 0, speed: speedOfPower((pFront + pBack) / 2), spin: 0 });
  assert.ok(inHouse(mid), `${mid.z}`);
});

test('브룸 자리와 조준 각도는 서로 맞는다', () => {
  for (const x of [-1.5, 0, 0.7]) assert.ok(Math.abs(broomX(angleToward(x, 0)) - x) < 1e-9);
});

// ---------- 컴퓨터 ----------

test('빈 시트에서 컴퓨터는 하우스로 드로하거나 가드를 놓는다', () => {
  for (const level of LEVEL_IDS) {
    const choice = chooseShot([], { team: 1 }, level, createRng(5));
    assert.ok(['draw', 'guard'].includes(choice.type), `${level}: ${choice.type}`);
    assert.ok(Number.isFinite(choice.shot.angle) && Number.isFinite(choice.shot.speed));
  }
});

test('어려움 컴퓨터는 버튼 위의 상대 스톤을 쳐 내거나 더 안쪽으로 붙인다', () => {
  const stones = [stone(0, 0.05, 0.05)];
  const choice = chooseShot(stones, { team: 1, last: true }, 'hard', createRng(2));
  assert.ok(['takeout', 'tap', 'draw'].includes(choice.type));
  // 떨림 없이 던진 결과로는 상대가 점수를 내지 못한다
  const sheet = new Sheet(stones);
  sheet.deliver(1, choice.plan);
  sheet.run();
  const result = scoreEnd(sheet.inPlay);
  assert.notEqual(result.team, 0, `${choice.type} → ${JSON.stringify(result.team)}`);
});

test('쉬움 컴퓨터는 테이크아웃을 생각하지 않는다', () => {
  const list = candidates([stone(0, 0, 0)], 1, { hits: false });
  assert.ok(list.every((c) => c.type === 'draw' || c.type === 'guard'));
  assert.ok(candidates([stone(0, 0, 0)], 1, { hits: true }).some((c) => c.type === 'takeout'));
});

test('평가는 내가 점수를 내는 판을 더 좋게 본다', () => {
  const mine = [stone(1, 0, 0), stone(0, 0, 1)];
  const theirs = [stone(0, 0, 0), stone(1, 0, 1)];
  assert.ok(evaluate(mine, 1) > evaluate(theirs, 1));
  assert.equal(evaluate(mine, 1, { last: true }), 1);
});

test('컴퓨터의 떨림은 실력이 높을수록 작다', () => {
  const spread = (level) => {
    const rng = createRng(11);
    const xs = [];
    for (let i = 0; i < 40; i++) xs.push(chooseShot([], { team: 1 }, level, rng).shot.angle);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    return xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  };
  assert.ok(spread('hard') < spread('easy'));
});

// ---------- 저장 ----------

test('설정을 검증해 저장하고 읽는다', () => {
  const store = new SaveStore(memoryStorage());
  assert.deepEqual(store.loadSettings(), DEFAULT_SETTINGS);
  store.saveSettings({ opponent: 'versus', level: 'hard', ends: 6, stones: 8, sound: false });
  assert.deepEqual(store.loadSettings(), { opponent: 'versus', level: 'hard', ends: 6, stones: 8, sound: false });
  const broken = new SaveStore(memoryStorage({ [SETTINGS_KEY]: '{"ends":5,"stones":"8","level":"pro"}' }));
  assert.deepEqual(broken.loadSettings(), DEFAULT_SETTINGS);
});

test('컴퓨터 상대 전적을 실력마다 센다', () => {
  const store = new SaveStore(memoryStorage({ [RECORD_KEY]: '{"easy":{"wins":-1,"losses":0}}' }));
  assert.equal(store.loadRecord('easy'), null);
  store.recordResult('normal', true);
  store.recordResult('normal', false);
  store.recordResult('normal', true);
  assert.deepEqual(store.loadRecord('normal'), { wins: 2, losses: 1 });
  assert.equal(store.recordResult('pro', true), null);
});

test('저장소가 없거나 예외를 던져도 게임은 계속된다', () => {
  const throwing = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  const store = new SaveStore(throwing);
  assert.deepEqual(store.loadSettings(), DEFAULT_SETTINGS);
  assert.equal(store.saveSettings(DEFAULT_SETTINGS), false);
  assert.deepEqual(new SaveStore(null).loadSettings(), DEFAULT_SETTINGS);
});
