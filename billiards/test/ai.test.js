import test from 'node:test';
import assert from 'node:assert/strict';
import { choose, perturb, potLine, LEVELS, think } from '../js/ai.js';
import { BilliardsGame, createRng } from '../js/game.js';
import { simulate } from '../js/physics.js';
import { judgeFourBall, judgeThreeCushion, judgeEightBall } from '../js/rules.js';

/** 공 배치를 직접 정한 경기 */
function setup(variant, positions, options = {}) {
  const game = new BilliardsGame({ variant, rng: createRng(1), ...options });
  for (const [id, [x, y]] of Object.entries(positions)) Object.assign(game.balls[id], { x, y, on: true });
  return game;
}

test('컴퓨터(4구): 쉬운 배치에서 고른 샷을 그대로 치면 득점한다', () => {
  // 빨간 공 둘이 수구 앞에 비스듬히 놓여 있다
  const game = setup('fourball', { 0: [-0.6, -0.1], 1: [-0.9, 0.45], 2: [-0.1, 0], 3: [0.5, 0.25] });
  const plan = choose(game, LEVELS.normal, createRng(2));
  assert.equal(plan.place, null);
  const r = simulate(game.table, game.layout(), 0, plan.shot);
  assert.equal(judgeFourBall(r.events, 0).scored, true);
});

test('컴퓨터(3쿠션): 표준 첫 배치에서 득점하는 샷을 찾는다', () => {
  const game = new BilliardsGame({ variant: 'threecushion', rng: createRng(1) });
  const plan = choose(game, LEVELS.hard, createRng(3));
  const r = simulate(game.table, game.layout(), game.cue, plan.shot);
  assert.equal(judgeThreeCushion(r.events, game.cue).scored, true);
});

test('컴퓨터(8볼): 곧은 공은 넣고, 파울하지 않는다', () => {
  const game = new BilliardsGame({ variant: 'eightball', rng: createRng(5) });
  // 브레이크가 끝난 것으로 치고 3번만 코너 앞에 남긴다
  game.isBreak = false;
  game.ballInHand = false;
  game.groups = ['solid', 'stripe'];
  for (const b of game.balls) if (b.id !== 0 && b.id !== 3 && b.id !== 8 && b.id !== 10) b.on = false;
  const { length: L, width: W } = game.table;
  Object.assign(game.balls[3], { x: L / 2 - 0.25, y: W / 2 - 0.2 });
  Object.assign(game.balls[0], { x: 0, y: -0.1 });
  Object.assign(game.balls[8], { x: -0.8, y: -0.4 });
  Object.assign(game.balls[10], { x: -0.6, y: 0.4 });
  assert.ok(game.table.pockets.some((p) => potLine(game.balls, 0, 3, p, game.table.ballRadius)));
  const plan = choose(game, LEVELS.normal, createRng(7));
  const r = simulate(game.table, game.layout(), 0, plan.shot);
  const j = judgeEightBall({ player: 0, groups: game.groups, isBreak: false, onTable: game.onTable() }, r.events);
  assert.equal(j.foul, null);
  assert.ok(j.pocketed.includes(3));
});

test('컴퓨터(8볼): 브레이크는 헤드 스트링 뒤에서 세게, 볼 인 핸드면 놓을 자리를 고른다', () => {
  const game = new BilliardsGame({ variant: 'eightball', rng: createRng(5) });
  const plan = choose(game, LEVELS.easy, createRng(1));
  assert.ok(plan.place.x <= -game.table.length / 4);
  assert.ok(game.canPlace(plan.place.x, plan.place.y));
  assert.ok(plan.shot.speed > 6);

  game.isBreak = false;
  game.groups = ['solid', 'stripe'];
  const hand = choose(game, LEVELS.easy, createRng(2));
  assert.ok(hand.place);
  assert.ok(game.canPlace(hand.place.x, hand.place.y));
});

test('컴퓨터의 생각은 여러 번에 나눠 진행된다', () => {
  const game = new BilliardsGame({ variant: 'fourball', rng: createRng(1) });
  const thinking = think(game, LEVELS.easy, createRng(1));
  let steps = 0;
  let result;
  for (;;) {
    const { done, value } = thinking.next();
    if (done) {
      result = value;
      break;
    }
    steps++;
  }
  assert.ok(steps > 5);
  assert.ok(Number.isFinite(result.shot.angle));
});

test('실력이 낮을수록 손이 많이 흔들린다', () => {
  const shot = { angle: 0, speed: 3, side: 0, vert: 0 };
  const spread = (level) => {
    const rng = createRng(11);
    let sum = 0;
    for (let i = 0; i < 400; i++) sum += Math.abs(perturb(shot, LEVELS[level], rng).angle);
    return sum / 400;
  };
  assert.ok(spread('easy') > spread('normal'));
  assert.ok(spread('normal') > spread('hard'));
  const p = perturb({ angle: 0, speed: 30, side: 3, vert: -3 }, LEVELS.easy, createRng(1), 8);
  assert.ok(p.speed <= 8 && p.side <= 1 && p.vert >= -1);
});
