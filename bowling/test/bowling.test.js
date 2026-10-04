import test from 'node:test';
import assert from 'node:assert/strict';
import { BowlingGame, scoreCard } from '../js/game.js';
import { PIN_SPOTS, HEAD_PIN_Z, PIN_SPACING, PIN_COM, PIT_Z, isStanding, predictX, angleToward } from '../js/lane.js';
import { chooseAim, computerThrow, POCKET_X } from '../js/ai.js';

const repeat = (n, rolls) => Array.from({ length: n }, () => rolls).flat();
const totals = (card) => card.frames.map((f) => f.total);

test('퍼펙트 게임은 300', () => {
  const card = scoreCard(repeat(12, [10]));
  assert.equal(card.total, 300);
  assert.equal(card.done, true);
  assert.equal(card.next, null);
  assert.deepEqual(totals(card), [30, 60, 90, 120, 150, 180, 210, 240, 270, 300]);
  assert.deepEqual(card.frames[0].marks, ['', 'X']);
  assert.deepEqual(card.frames[9].marks, ['X', 'X', 'X']);
});

test('거터 게임은 0', () => {
  const card = scoreCard(repeat(20, [0]));
  assert.equal(card.total, 0);
  assert.equal(card.done, true);
  assert.deepEqual(card.frames[0].marks, ['-', '-']);
  assert.deepEqual(card.frames[9].marks, ['-', '-', '']);
});

test('올 스페어 (5/) 에 마지막 5 는 150', () => {
  const card = scoreCard(repeat(21, [5]));
  assert.equal(card.total, 150);
  assert.equal(card.done, true);
  assert.deepEqual(card.frames[3].marks, ['5', '/']);
  assert.deepEqual(card.frames[9].marks, ['5', '/', '5']);
});

test('오픈 프레임은 그냥 더한다', () => {
  const card = scoreCard(repeat(10, [3, 6]));
  assert.equal(card.total, 90);
  assert.equal(card.done, true);
});

test('보너스가 아직 없으면 그 프레임부터 누계를 비워 둔다', () => {
  let card = scoreCard([10, 3]);
  assert.deepEqual(totals(card), [null, null]);
  card = scoreCard([10, 3, 4]);
  assert.deepEqual(totals(card), [17, 24]);
  card = scoreCard([7, 3, 10]);
  assert.deepEqual(totals(card), [20, null]);
  assert.equal(card.total, 20);
  card = scoreCard([10, 10, 10]);
  assert.deepEqual(totals(card), [30, null, null]);
  assert.deepEqual(card.next, { frame: 3, ball: 0, standing: 10 });
});

test('일반적인 게임', () => {
  // 널리 쓰이는 예제: 167 점
  const rolls = [10, 7, 3, 9, 0, 10, 0, 8, 8, 2, 0, 6, 10, 10, 10, 8, 1];
  const card = scoreCard(rolls);
  assert.deepEqual(totals(card), [20, 39, 48, 66, 74, 84, 90, 120, 148, 167]);
  assert.equal(card.done, true);
  assert.deepEqual(card.frames[4].marks, ['-', '8']);
  assert.deepEqual(card.frames[9].marks, ['X', '8', '1']);
});

test('10프레임: 스트라이크 다음 두 공', () => {
  const nine = repeat(18, [0]);
  let card = scoreCard([...nine, 10]);
  assert.deepEqual(card.next, { frame: 9, ball: 1, standing: 10 });
  card = scoreCard([...nine, 10, 7]);
  assert.deepEqual(card.next, { frame: 9, ball: 2, standing: 3 });
  card = scoreCard([...nine, 10, 7, 3]);
  assert.equal(card.done, true);
  assert.equal(card.total, 20);
  assert.deepEqual(card.frames[9].marks, ['X', '7', '/']);
  card = scoreCard([...nine, 10, 10]);
  assert.deepEqual(card.next, { frame: 9, ball: 2, standing: 10 });
  card = scoreCard([...nine, 10, 10, 4]);
  assert.equal(card.total, 24);
  assert.deepEqual(card.frames[9].marks, ['X', 'X', '4']);
});

test('10프레임: 스페어면 한 공 더, 오픈이면 끝', () => {
  const nine = repeat(18, [0]);
  let card = scoreCard([...nine, 6, 4]);
  assert.equal(card.done, false);
  assert.deepEqual(card.next, { frame: 9, ball: 2, standing: 10 });
  card = scoreCard([...nine, 6, 4, 10]);
  assert.equal(card.total, 20);
  assert.deepEqual(card.frames[9].marks, ['6', '/', 'X']);
  card = scoreCard([...nine, 0, 10, 0]);
  assert.deepEqual(card.frames[9].marks, ['-', '/', '-']);
  assert.equal(card.total, 10);
  card = scoreCard([...nine, 6, 3]);
  assert.equal(card.done, true);
  assert.equal(card.total, 9);
});

test('9프레임 스트라이크의 보너스는 10프레임 공에서 가져온다', () => {
  const card = scoreCard([...repeat(16, [0]), 10, 10, 10, 10]);
  assert.deepEqual(totals(card).slice(7), [0, 30, 60]);
});

test('차례 진행: 프레임이 끝나면 상대에게 넘어간다', () => {
  const game = new BowlingGame();
  assert.deepEqual(game.next, { frame: 0, ball: 0, standing: 10 });

  let result = game.roll(7);
  assert.deepEqual(result, { pins: 7, strike: false, spare: false, rerack: false, turnOver: false, gameOver: false });
  assert.deepEqual(game.next, { frame: 0, ball: 1, standing: 3 });
  assert.throws(() => game.roll(4), /쓰러뜨릴 수 없는/);
  assert.throws(() => game.roll(-1));
  assert.throws(() => game.roll(1.5));

  result = game.roll(3);
  assert.equal(result.spare, true);
  assert.equal(result.turnOver, true);
  assert.equal(result.rerack, true);
  game.nextTurn();
  assert.equal(game.current, 1);

  result = game.roll(10);
  assert.equal(result.strike, true);
  assert.equal(result.turnOver, true);
  game.nextTurn();
  assert.equal(game.current, 0);
  assert.deepEqual(game.next, { frame: 1, ball: 0, standing: 10 });
});

test('10프레임 보너스 투구는 차례를 넘기지 않고 핀을 새로 세운다', () => {
  const game = new BowlingGame();
  for (let f = 0; f < 9; f++) {
    for (const player of [0, 1]) {
      assert.equal(game.current, player);
      game.roll(0);
      game.roll(0);
      game.nextTurn();
    }
  }
  let result = game.roll(10);
  assert.deepEqual(result, { pins: 10, strike: true, spare: false, rerack: true, turnOver: false, gameOver: false });
  result = game.roll(4);
  assert.equal(result.rerack, false);
  assert.equal(result.turnOver, false);
  result = game.roll(6);
  assert.equal(result.spare, true);
  assert.equal(result.turnOver, true);
  assert.equal(result.gameOver, false);
  game.nextTurn();

  game.roll(5);
  result = game.roll(5);
  assert.equal(result.spare, true);
  assert.equal(result.rerack, true);
  assert.equal(result.turnOver, false);
  result = game.roll(10);
  assert.equal(result.strike, true);
  assert.equal(result.gameOver, true);
  assert.equal(game.over, true);
  assert.deepEqual(
    game.players.map((_, i) => game.card(i).total),
    [20, 20],
  );
  assert.equal(game.winner, null);
  assert.throws(() => game.roll(0), /끝났습니다/);
  assert.throws(() => game.nextTurn());
});

test('0 다음 10 은 스트라이크가 아니라 스페어', () => {
  const game = new BowlingGame();
  game.roll(0);
  let result = game.roll(10);
  assert.equal(result.strike, false);
  assert.equal(result.spare, true);
  // 10프레임에서도 마찬가지이고, 핀을 새로 세워 한 공 더 던진다
  for (let f = 0; f < 9; f++) {
    if (f > 0) {
      game.roll(0);
      game.roll(0);
    }
    game.nextTurn();
    game.roll(0);
    game.roll(0);
    game.nextTurn();
  }
  assert.deepEqual(game.next, { frame: 9, ball: 0, standing: 10 });
  game.roll(0);
  result = game.roll(10);
  assert.deepEqual([result.strike, result.spare, result.rerack, result.turnOver], [false, true, true, false]);
});

test('승자는 총점이 높은 쪽', () => {
  const game = new BowlingGame();
  while (!game.over) {
    const result = game.roll(game.current === 0 ? 1 : 0);
    if (result.turnOver && !result.gameOver) game.nextTurn();
  }
  assert.equal(game.card(0).total, 20);
  assert.equal(game.card(1).total, 0);
  assert.equal(game.winner, 0);
});

test('핀 배치', () => {
  assert.equal(PIN_SPOTS.length, 10);
  assert.deepEqual(PIN_SPOTS.map((s) => s.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const at = (n) => PIN_SPOTS[n - 1];
  assert.equal(at(1).x, 0);
  assert.equal(at(1).z, HEAD_PIN_Z);
  assert.ok(at(2).x < 0 && at(3).x > 0); // 2번은 왼쪽, 3번은 오른쪽
  assert.ok(Math.abs(at(7).x + 1.5 * PIN_SPACING) < 1e-9);
  assert.ok(Math.abs(at(10).x - 1.5 * PIN_SPACING) < 1e-9);
  assert.ok(at(5).x === 0 && at(5).z < at(1).z);
  // 이웃한 핀 사이는 모두 12인치
  for (const [a, b] of [[1, 2], [1, 3], [2, 3], [2, 4], [5, 9], [9, 10]]) {
    assert.ok(Math.abs(Math.hypot(at(a).x - at(b).x, at(a).z - at(b).z) - PIN_SPACING) < 1e-9);
  }
  assert.ok(at(10).z > PIT_Z);
});

test('선 핀 판정', () => {
  const upright = { x: 0, y: PIN_COM, z: HEAD_PIN_Z, upY: 1 };
  assert.equal(isStanding(upright), true);
  assert.equal(isStanding({ ...upright, x: 0.3, z: HEAD_PIN_Z - 0.4, upY: 0.97 }), true); // 밀려났지만 서 있다
  assert.equal(isStanding({ ...upright, upY: 0.5 }), false); // 기울었다
  assert.equal(isStanding({ ...upright, y: 0.05, upY: 0 }), false); // 누웠다
  assert.equal(isStanding({ ...upright, x: 0.6 }), false); // 거터에 빠졌다
  assert.equal(isStanding({ ...upright, z: PIT_Z - 0.1 }), false); // 핏으로 떨어졌다
  assert.equal(isStanding({ ...upright, y: PIN_COM + 0.1 }), false); // 튀어 올랐다
});

test('궤적 예측과 겨냥', () => {
  const straight = { startX: 0.1, angle: 0, speed: 8, spin: 0 };
  assert.equal(predictX(straight, HEAD_PIN_Z), 0.1);
  // 오른쪽으로 휘는 공은 기름 구간까지는 곧게 간다
  const hook = { ...straight, spin: 1 };
  assert.equal(predictX(hook, -5), 0.1);
  assert.ok(predictX(hook, HEAD_PIN_Z) > 0.25);
  // 느릴수록 많이 휜다
  assert.ok(predictX({ ...hook, speed: 6 }, HEAD_PIN_Z) > predictX(hook, HEAD_PIN_Z));
  for (const spin of [-1, -0.5, 0, 1]) {
    const angle = angleToward(0.3, -0.1, 7, spin);
    assert.ok(Math.abs(predictX({ startX: 0.3, angle, speed: 7, spin }, HEAD_PIN_Z) + 0.1) < 0.005);
  }
});

test('컴퓨터의 겨냥', () => {
  const all = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const aim = chooseAim(all);
  assert.equal(aim.targetX, POCKET_X);
  assert.ok(aim.spin < 0); // 오른쪽에서 왼쪽으로 휘어 들어간다
  // 손 떨림이 없으면 포켓을 지난다
  const exact = computerThrow(all, Math.random, 0);
  assert.ok(Math.abs(predictX(exact, HEAD_PIN_Z) - POCKET_X) < 0.01);

  // 10번 핀만 남으면 오른쪽 끝을 노리고 왼쪽에서 가로질러 던진다
  const ten = chooseAim([10]);
  assert.ok(Math.abs(ten.targetX - PIN_SPOTS[9].x) < 1e-9);
  assert.ok(ten.startX < 0);
  const seven = computerThrow([7], Math.random, 0);
  assert.ok(Math.abs(predictX(seven, HEAD_PIN_Z) - PIN_SPOTS[6].x) < 0.01);
  assert.throws(() => chooseAim([]));

  // 손 떨림이 있어도 대부분 레인 안으로 굴러간다
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 200; i++) {
    const t = computerThrow(all, rng);
    assert.ok(Math.abs(predictX(t, HEAD_PIN_Z)) < 0.4);
  }
});

test('대전 방식: 2인 대전은 두 자리 모두 사람이 던진다', () => {
  const solo = new BowlingGame();
  assert.equal(solo.mode, 'computer');
  assert.equal(solo.isHuman(0), true);
  assert.equal(solo.isHuman(1), false);

  const versus = new BowlingGame('versus');
  assert.equal(versus.isHuman(0), true);
  assert.equal(versus.isHuman(1), true);
  assert.throws(() => new BowlingGame('online'), /대전 방식/);

  // 진행 규칙은 같다: 프레임마다 번갈아 던지고 총점이 높은 쪽이 이긴다
  for (let f = 0; f < 10; f++) {
    assert.equal(versus.current, 0);
    versus.roll(3);
    versus.roll(4);
    versus.nextTurn();
    assert.equal(versus.current, 1);
    assert.equal(versus.isHuman(), true);
    // 마지막 프레임은 스트라이크 뒤 보너스 두 공
    for (const pins of f === 9 ? [10, 2, 1] : [5, 4]) versus.roll(pins);
    if (!versus.over) versus.nextTurn();
  }
  assert.equal(versus.over, true);
  assert.equal(versus.card(0).total, 70);
  assert.equal(versus.card(1).total, 9 * 9 + 13);
  assert.equal(versus.winner, 1);
});
