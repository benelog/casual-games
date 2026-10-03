import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreAt, targetPoint, SEGMENTS } from '../js/board.js';
import { DartsGame } from '../js/game.js';
import { chooseTarget, computerThrow } from '../js/ai.js';

const hit = (score) => ({ score });

test('구역별 점수', () => {
  assert.equal(scoreAt(0, 0).score, 50);
  assert.equal(scoreAt(0, 10).score, 25);
  assert.deepEqual(scoreAt(0, 60), { score: 20, number: 20, multiplier: 1, label: '20' });
  assert.equal(scoreAt(0, 103).label, 'T20');
  assert.equal(scoreAt(0, 166).label, 'D20');
  assert.equal(scoreAt(0, 171).score, 0);
  assert.equal(scoreAt(60, 0).number, 6); // 오른쪽
  assert.equal(scoreAt(0, -60).number, 3); // 아래
  assert.equal(scoreAt(-60, 0).number, 11); // 왼쪽
  assert.equal(scoreAt(20, 60).number, 1); // 20 의 시계 방향 옆
  assert.equal(scoreAt(-20, 60).number, 5);
});

test('모든 구역의 겨냥점이 그 구역에 떨어진다', () => {
  for (const number of SEGMENTS) {
    for (const multiplier of [1, 2, 3]) {
      const p = targetPoint(number, multiplier);
      assert.equal(scoreAt(p.x, p.y).score, number * multiplier);
    }
  }
  assert.equal(scoreAt(...Object.values(targetPoint(25, 2))).score, 50);
  assert.equal(scoreAt(...Object.values(targetPoint(25, 1))).score, 25);
});

test('세 번 던지면 차례가 끝난다', () => {
  const game = new DartsGame();
  assert.equal(game.throwDart(hit(60)).turnOver, false);
  assert.equal(game.throwDart(hit(20)).turnOver, false);
  assert.equal(game.throwDart(hit(1)).turnOver, true);
  assert.equal(game.players[0].remaining, 220);
  assert.throws(() => game.throwDart(hit(1)));
  game.nextTurn();
  assert.equal(game.current, 1);
});

test('버스트하면 그 턴의 점수는 무효', () => {
  const game = new DartsGame({ start: 50 });
  game.throwDart(hit(20));
  const result = game.throwDart(hit(40));
  assert.equal(result.bust, true);
  assert.equal(result.turnOver, true);
  assert.equal(game.players[0].remaining, 50);
});

test('정확히 0 이면 승리', () => {
  const game = new DartsGame({ start: 40 });
  const result = game.throwDart(hit(40));
  assert.equal(result.win, true);
  assert.equal(game.winner, 0);
  assert.throws(() => game.nextTurn());
});

test('컴퓨터의 겨냥', () => {
  assert.deepEqual(chooseTarget(301), { number: 20, multiplier: 3 });
  assert.deepEqual(chooseTarget(50), { number: 25, multiplier: 2 });
  assert.deepEqual(chooseTarget(17), { number: 17, multiplier: 1 });
  assert.deepEqual(chooseTarget(36), { number: 18, multiplier: 2 });
  assert.deepEqual(chooseTarget(57), { number: 19, multiplier: 3 });
  assert.deepEqual(chooseTarget(43), { number: 20, multiplier: 1 });
  // 60 이하에서는 겨냥한 곳을 맞혀도 버스트하지 않는다
  for (let remaining = 1; remaining <= 60; remaining++) {
    const { number, multiplier } = chooseTarget(remaining);
    const score = number === 25 ? 25 * multiplier : number * multiplier;
    assert.ok(score <= remaining, `remaining ${remaining}`);
  }
  const exact = computerThrow(301, () => 0.5, 0);
  assert.equal(scoreAt(exact.x, exact.y).label, 'T20');
});
