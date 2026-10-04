import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeFourBall, judgeThreeCushion, judgeEightBall, groupOf, legalFirst } from '../js/rules.js';
import { BilliardsGame, caromLayout, poolRack, createRng } from '../js/game.js';
import { VARIANTS } from '../js/variants.js';

const hit = (t, a, b) => ({ t, type: 'hit', a, b, speed: 1 });
const cushion = (t, ball, rail) => ({ t, type: 'cushion', ball, rail, speed: 1 });
const pocket = (t, ball) => ({ t, type: 'pocket', ball, pocket: 0, speed: 1 });

/** 판정만 시험하도록 공 배치는 그대로 두고 사건만 넘긴다 */
const shot = (game, events) => game.applyShot({ events, balls: game.layout() });

// ---------- 4구 ----------

test('4구: 빨간 공 둘을 맞히면 득점, 상대 수구에 닿으면 파울', () => {
  assert.deepEqual(judgeFourBall([hit(0.1, 0, 2), hit(0.5, 3, 0)], 0), { scored: true, foul: false, reds: 2 });
  assert.equal(judgeFourBall([hit(0.1, 0, 2)], 0).scored, false);
  assert.equal(judgeFourBall([], 0).scored, false);
  // 득점한 뒤라도 상대 수구에 닿으면 파울
  const foul = judgeFourBall([hit(0.1, 0, 2), hit(0.3, 0, 3), hit(0.6, 0, 1)], 0);
  assert.equal(foul.scored, false);
  assert.equal(foul.foul, true);
  // 목적구끼리 상대 수구를 맞힌 것은 파울이 아니다
  assert.equal(judgeFourBall([hit(0.1, 1, 2), hit(0.2, 1, 3), hit(0.3, 2, 0)], 1).foul, false);
  assert.equal(judgeFourBall([hit(0.1, 1, 2), hit(0.2, 1, 3), hit(0.3, 2, 0)], 1).scored, true);
});

test('4구 경기: 득점하면 계속, 놓치면 넘기고, 파울은 1점을 잃는다', () => {
  const game = new BilliardsGame({ variant: 'fourball', target: 2 });
  assert.equal(game.current, 0);
  let out = shot(game, [hit(0.1, 0, 2), hit(0.2, 0, 3)]);
  assert.equal(out.scored, true);
  assert.equal(out.next, 0);
  assert.deepEqual(game.scores, [1, 0]);
  out = shot(game, [hit(0.1, 0, 2)]);
  assert.equal(out.reason, 'miss');
  assert.equal(game.current, 1);
  assert.equal(game.cue, 1);
  // 0점에서 파울하면 그대로 0점
  out = shot(game, [hit(0.1, 1, 0)]);
  assert.equal(out.reason, 'foulTouch');
  assert.equal(out.points, 0);
  assert.equal(game.current, 0);
  out = shot(game, [hit(0.1, 0, 1)]);
  assert.equal(out.points, -1);
  assert.deepEqual(game.scores, [0, 0]);
  shot(game, []); // 1P 차례로
  shot(game, [hit(0.1, 0, 2), hit(0.2, 0, 3)]);
  out = shot(game, [hit(0.1, 0, 3), hit(0.2, 0, 2)]);
  assert.equal(out.over, true);
  assert.equal(out.winner, 0);
  assert.equal(game.bestRuns[0], 2);
  assert.throws(() => shot(game, []));
});

// ---------- 3쿠션 ----------

test('3쿠션: 두 번째 공 전에 쿠션 3번이면 득점', () => {
  // 공 먼저 맞히고 쿠션 셋, 그다음 두 번째 공
  assert.equal(judgeThreeCushion([hit(0.1, 0, 2), cushion(0.3, 0, 1), cushion(0.6, 0, 2), cushion(0.9, 0, 3), hit(1.2, 0, 1)], 0).scored, true);
  // 쿠션 먼저 셋 (빈 쿠션 치기)
  assert.equal(judgeThreeCushion([cushion(0.1, 0, 0), cushion(0.3, 0, 1), cushion(0.5, 0, 2), hit(0.8, 0, 1), hit(1.2, 0, 2)], 0).scored, true);
  // 두 번째 공에 닿은 뒤의 쿠션은 세지 않는다
  const late = judgeThreeCushion([hit(0.1, 0, 2), cushion(0.3, 0, 1), cushion(0.6, 0, 2), hit(0.8, 0, 1), cushion(1, 0, 3)], 0);
  assert.equal(late.scored, false);
  assert.equal(late.cushions, 2);
  // 목적구가 쿠션에 닿은 것은 세지 않는다
  assert.equal(judgeThreeCushion([hit(0.1, 0, 2), cushion(0.2, 2, 1), cushion(0.3, 2, 2), cushion(0.4, 0, 3), hit(0.6, 0, 1)], 0).scored, false);
  // 같은 쿠션을 타고 구르며 거듭 닿은 것은 한 번
  const slide = judgeThreeCushion([hit(0.1, 0, 2), cushion(0.3, 0, 1), cushion(0.32, 0, 1), cushion(0.34, 0, 1), cushion(0.7, 0, 2), hit(1, 0, 1)], 0);
  assert.equal(slide.cushions, 2);
  // 같은 쿠션이라도 떨어져서 다시 닿으면 따로 센다
  assert.equal(judgeThreeCushion([cushion(0.1, 0, 1), cushion(0.6, 0, 3), cushion(1.1, 0, 1), hit(1.4, 0, 2), hit(1.6, 0, 1)], 0).scored, true);
  // 2P 의 수구는 노란 공
  assert.equal(judgeThreeCushion([hit(0.1, 1, 2), cushion(0.2, 1, 0), cushion(0.4, 1, 1), cushion(0.6, 1, 2), hit(0.8, 1, 0)], 1).scored, true);
});

test('3쿠션 경기: 감점 없이 차례만 넘어가고 목표 점수에 먼저 닿으면 이긴다', () => {
  const game = new BilliardsGame({ variant: 'threecushion', target: 1, first: 1 });
  assert.equal(game.current, 1);
  let out = shot(game, [hit(0.1, 1, 0)]);
  assert.equal(out.points, 0);
  assert.equal(game.current, 0);
  out = shot(game, [cushion(0.1, 0, 0), cushion(0.3, 0, 1), cushion(0.5, 0, 2), hit(0.8, 0, 1), hit(1.2, 0, 2)]);
  assert.equal(out.over, true);
  assert.equal(game.winner, 0);
});

test('캐롬 첫 배치: 공이 겹치지 않고 먼저 치는 사람의 수구가 헤드 쪽에 있다', () => {
  for (const id of ['fourball', 'threecushion']) {
    const variant = VARIANTS[id];
    for (const shooter of [0, 1]) {
      const balls = caromLayout(variant, shooter);
      assert.equal(balls.length, variant.balls);
      const R = variant.table.ballRadius;
      for (const a of balls) for (const b of balls) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 2 * R);
      assert.ok(balls[shooter].x < 0);
    }
  }
  // 3쿠션 표준 배치
  const balls = caromLayout(VARIANTS.threecushion, 0);
  assert.equal(balls[2].x, VARIANTS.threecushion.table.length / 4);
  assert.ok(Math.abs(Math.abs(balls[0].y - balls[1].y) - 0.1524) < 1e-9);
});

// ---------- 8볼 ----------

const open = (player = 0, onTable = [1, 2, 3, 8, 9, 10, 11]) => ({ player, groups: [null, null], isBreak: false, onTable });

test('8볼 랙: 15개, 8번은 가운데, 뒷줄 양 끝은 단색과 줄무늬', () => {
  for (let seed = 1; seed < 6; seed++) {
    const balls = poolRack(VARIANTS.eightball, createRng(seed));
    assert.equal(balls.length, 16);
    const R = VARIANTS.eightball.table.ballRadius;
    for (const a of balls) for (const b of balls) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 2 * R);
    const L = VARIANTS.eightball.table.length;
    const dx = 2 * R * Math.cos(Math.PI / 6);
    const nearest = (x, y) => balls.slice(1).reduce((a, b) => (Math.hypot(b.x - x, b.y - y) < Math.hypot(a.x - x, a.y - y) ? b : a));
    assert.equal(nearest(L / 4 + 2 * dx, 0).id, 8); // 셋째 줄 가운데
    const corners = [nearest(L / 4 + 4 * dx, -4 * R), nearest(L / 4 + 4 * dx, 4 * R)].map((b) => groupOf(b.id)).sort();
    assert.deepEqual(corners, ['solid', 'stripe']);
  }
});

test('8볼 판정: 오픈 테이블에서 처음 넣은 공으로 무리가 정해진다', () => {
  const j = judgeEightBall(open(), [hit(0.1, 0, 10), cushion(0.3, 10, 2), pocket(0.6, 10), pocket(0.9, 2)]);
  assert.equal(j.foul, null);
  assert.equal(j.assigned, 'stripe');
  assert.deepEqual(j.groups, ['stripe', 'solid']);
  assert.equal(j.keepTurn, true);
  // 브레이크에서는 넣어도 오픈 테이블
  const brk = judgeEightBall({ ...open(), isBreak: true }, [hit(0.1, 0, 1), pocket(0.5, 3)]);
  assert.equal(brk.assigned, null);
  assert.equal(brk.keepTurn, true);
});

test('8볼 판정: 파울 네 가지', () => {
  const mine = { player: 0, groups: ['solid', 'stripe'], isBreak: false, onTable: [1, 2, 8, 9] };
  assert.equal(judgeEightBall(mine, [hit(0.1, 0, 1), pocket(0.4, 0)]).foul, 'scratch');
  assert.equal(judgeEightBall(mine, [cushion(0.2, 0, 1)]).foul, 'noHit');
  assert.equal(judgeEightBall(mine, [hit(0.1, 0, 9), cushion(0.2, 9, 1)]).foul, 'wrongBall');
  assert.equal(judgeEightBall(mine, [hit(0.1, 0, 8), cushion(0.2, 8, 1)]).foul, 'wrongBall');
  assert.equal(judgeEightBall(mine, [hit(0.1, 0, 1)]).foul, 'noRail');
  // 맞힌 뒤에 수구가 쿠션에 닿아도 된다
  assert.equal(judgeEightBall(mine, [hit(0.1, 0, 1), cushion(0.3, 0, 2)]).foul, null);
  // 맞히기 전의 쿠션은 세지 않는다
  assert.equal(judgeEightBall(mine, [cushion(0.05, 0, 2), hit(0.1, 0, 1)]).foul, 'noRail');
  // 오픈 테이블에서 8번을 먼저 맞히면 파울
  assert.equal(judgeEightBall(open(), [hit(0.1, 0, 8), cushion(0.3, 8, 1)]).foul, 'wrongBall');
  // 상대 공만 넣으면 파울은 아니지만 차례가 넘어간다
  const theirs = judgeEightBall(mine, [hit(0.1, 0, 1), hit(0.2, 1, 9), pocket(0.5, 9)]);
  assert.equal(theirs.foul, null);
  assert.equal(theirs.keepTurn, false);
});

test('8볼 판정: 8번을 넣으면 이기거나 진다, 브레이크에서는 다시 놓는다', () => {
  const cleared = { player: 1, groups: ['solid', 'stripe'], isBreak: false, onTable: [1, 8] };
  assert.equal(legalFirst(8, { group: 'stripe', isBreak: false, onTable: [1, 8] }), true);
  assert.equal(judgeEightBall(cleared, [hit(0.1, 0, 8), pocket(0.5, 8)]).winner, 1);
  // 8번과 함께 스크래치하면 진다
  const scratch = judgeEightBall(cleared, [hit(0.1, 0, 8), pocket(0.5, 8), pocket(0.7, 0)]);
  assert.equal(scratch.winner, 0);
  assert.equal(scratch.lostOnEight, true);
  // 아직 내 공이 남았는데 8번을 넣으면 진다
  const early = judgeEightBall({ player: 0, groups: ['solid', 'stripe'], isBreak: false, onTable: [1, 8, 9] }, [hit(0.1, 0, 1), hit(0.2, 1, 8), pocket(0.6, 8)]);
  assert.equal(early.winner, 1);
  const brk = judgeEightBall({ ...open(), isBreak: true }, [hit(0.1, 0, 1), pocket(0.5, 8)]);
  assert.equal(brk.respotEight, true);
  assert.equal(brk.winner, null);
});

test('8볼 경기: 파울 뒤에는 상대가 수구를 옮겨 놓고, 판을 이기면 브레이크를 바꾼다', () => {
  const game = new BilliardsGame({ variant: 'eightball', target: 2, rng: createRng(4) });
  assert.equal(game.isBreak, true);
  assert.equal(game.ballInHand, true);
  const L = game.table.length;
  // 브레이크는 헤드 스트링 뒤에만 놓는다
  assert.equal(game.canPlace(0, 0), false);
  assert.equal(game.placeCue(-L / 4 - 0.2, 0.1), true);
  // 브레이크 스크래치
  let balls = game.layout();
  balls[0].on = false;
  let out = game.applyShot({ events: [hit(0.1, 0, 1), pocket(1, 0)], balls });
  assert.equal(out.foul, 'scratch');
  assert.equal(game.current, 1);
  assert.equal(game.ballInHand, true);
  assert.equal(game.balls[0].on, true);
  assert.equal(game.isBreak, false);
  assert.equal(game.canPlace(0.5, 0.3), true); // 이제는 어디든

  // 2P 가 3번을 넣어 단색을 갖는다
  balls = game.layout();
  balls[3].on = false;
  out = game.applyShot({ events: [hit(0.1, 0, 3), pocket(0.5, 3)], balls });
  assert.equal(out.assigned, 'solid');
  assert.deepEqual(game.groups, ['stripe', 'solid']);
  assert.equal(game.current, 1);
  assert.equal(game.ballInHand, false);
  assert.equal(game.remaining(1).length, 6);

  // 남은 단색을 모두 치웠다고 치고 8번을 넣는다
  for (const n of [1, 2, 4, 5, 6, 7]) game.balls[n].on = false;
  assert.equal(game.onEight(1), true);
  balls = game.layout();
  balls[8].on = false;
  out = game.applyShot({ events: [hit(0.1, 0, 8), pocket(0.5, 8)], balls });
  assert.equal(out.rackOver, true);
  assert.equal(out.rackWinner, 1);
  assert.equal(out.over, false);
  assert.deepEqual(game.scores, [0, 1]);
  game.nextRack();
  assert.equal(game.current, 1); // 브레이크를 번갈아
  assert.equal(game.onTable().length, 15);
  assert.equal(game.isBreak, true);
});

test('8볼: 브레이크에서 들어간 8번은 풋 스폿에 돌아온다', () => {
  const game = new BilliardsGame({ variant: 'eightball', rng: createRng(9) });
  const balls = game.layout();
  balls[8].on = false;
  game.applyShot({ events: [hit(0.1, 0, 1), pocket(0.4, 8)], balls });
  const eight = game.balls[8];
  assert.equal(eight.on, true);
  assert.ok(eight.x >= game.table.length / 4 - 1e-9);
  assert.equal(eight.y, 0);
  const R = game.table.ballRadius;
  for (const b of game.balls) if (b.id !== 8 && b.on) assert.ok(Math.hypot(b.x - eight.x, b.y - eight.y) >= 2 * R);
});

test('알 수 없는 종목은 만들지 않는다', () => {
  assert.throws(() => new BilliardsGame({ variant: 'snooker' }));
});
