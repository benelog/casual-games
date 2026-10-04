import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, simulate, DT } from '../js/physics.js';
import { caromTable, poolTable, diamonds } from '../js/table.js';
import { VARIANTS } from '../js/variants.js';

const carom = VARIANTS.threecushion.table;
const pool = VARIANTS.eightball.table;
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const ball = (id, x, y, on = true) => ({ id, x, y, on });

/** 첫 쿠션에서 튕겨 나간 직후의 방향(도) */
function reboundAngle(table, shot) {
  const sim = new Simulation(table, [ball(0, 0, 0)]);
  sim.strike(0, shot);
  sim.run({ until: (s) => s.events.some((e) => e.type === 'cushion') });
  const b = sim.balls[0];
  return (Math.atan2(b.vy, b.vx) * 180) / Math.PI;
}

test('공은 미끄러지다 구르기로 넘어가 결국 멈춘다', () => {
  const sim = new Simulation(pool, [ball(0, -1, 0)]);
  sim.strike(0, { angle: 0, speed: 1 });
  const b = sim.balls[0];
  for (let i = 0; i < 300; i++) sim.step();
  // 0.3초 뒤에는 닿은 점이 미끄러지지 않는다: v = R·w
  assert.ok(near(b.vx, b.wy * pool.ballRadius, 1e-6));
  // 미끄러지는 동안 운동 에너지의 2/7 를 잃으므로 구르는 속도는 처음의 5/7. 그 뒤로는 구름 저항만 받는다
  const { slide, roll } = pool.cloth;
  const sliding = 1 / (3.5 * slide * 9.81);
  assert.ok(near(b.vx, 5 / 7 - roll * 9.81 * (0.3 - sliding), 0.002), `${b.vx}`);
  sim.run();
  assert.equal(sim.done, true);
  assert.equal(b.moving, false);
  assert.ok(b.x > 0 && b.x < 1.2);
});

test('같은 샷은 언제나 같은 결과 (고정 간격)', () => {
  const balls = [ball(0, -0.8, 0.1), ball(1, 0.3, -0.2), ball(2, 0.7, 0.3)];
  const shot = { angle: 0.15, speed: 3.2, side: 0.6, vert: -0.3 };
  const a = simulate(carom, balls, 0, shot);
  const b = simulate(carom, balls, 0, shot);
  assert.deepEqual(a.balls, b.balls);
  assert.deepEqual(a.events, b.events);
  // 실시간으로 잘게 나눠 돌려도 결과가 같다
  const sim = new Simulation(carom, balls);
  sim.strike(0, shot);
  while (!sim.done) sim.advance(1 / 60);
  assert.deepEqual(sim.snapshot(), a.balls);
});

test('정면 충돌: 운동량이 보존되고 끌림 없는 수구는 거의 멈춘다', () => {
  const sim = new Simulation(pool, [ball(0, -0.3, 0), ball(1, 0, 0)]);
  sim.strike(0, { angle: 0, speed: 2, vert: -0.4 }); // 맞는 순간 미끄러지는 정도로 끌어서
  let before = null;
  while (!sim.events.some((e) => e.type === 'hit')) {
    before = sim.balls.map((b) => b.vx);
    sim.step();
  }
  const [cue, obj] = sim.balls;
  const total = cue.vx + obj.vx;
  assert.ok(near(total, before[0] + before[1], 0.02), `운동량 ${total} vs ${before[0]}`);
  // 반발 계수 0.94: 목적구가 대부분을 가져간다
  assert.ok(obj.vx > 0.9 * before[0]);
  assert.ok(Math.abs(cue.vx) < 0.06 * before[0]);
  assert.ok(Math.abs(obj.vy) < 1e-9);
});

test('비스듬히 맞으면 두 공이 거의 직각으로 갈라진다 (회전 없는 수구)', () => {
  const R = pool.ballRadius;
  // 반 두께로 맞힌다: 목적구는 중심선 방향(30°)으로 간다
  const angle = Math.asin(R / 0.5);
  const sim = new Simulation(pool, [ball(0, -0.5, 0), ball(1, 0, 0)]);
  sim.strike(0, { angle, speed: 2 });
  sim.run({ until: (s) => s.events.some((e) => e.type === 'hit') });
  const [cue, obj] = sim.balls;
  const a = Math.atan2(cue.vy, cue.vx);
  const b = Math.atan2(obj.vy, obj.vx);
  const between = (Math.abs(a - b) * 180) / Math.PI;
  assert.ok(between > 80 && between < 100, `갈라진 각 ${between}`);
});

test('충돌 시각을 되돌려 처리하므로 간격이 커도 겹치지 않는다', () => {
  for (const dt of [DT, 1 / 400]) {
    const sim = new Simulation(pool, [ball(0, -0.8, 0), ball(1, 0, 0.01)], { dt });
    sim.strike(0, { angle: 0, speed: 7 });
    sim.run({ until: (s) => s.events.some((e) => e.type === 'hit') });
    const [p, q] = sim.balls;
    assert.ok(Math.hypot(p.x - q.x, p.y - q.y) >= 2 * pool.ballRadius - 1e-9);
  }
});

test('쿠션: 수직으로 들어가면 반발 계수만큼 느려져 되돌아온다', () => {
  const sim = new Simulation(carom, [ball(0, 1.2, 0)]);
  sim.strike(0, { angle: 0, speed: 2, vert: 0 });
  let vin = 0;
  while (!sim.events.some((e) => e.type === 'cushion')) {
    vin = sim.balls[0].vx;
    sim.step();
  }
  const b = sim.balls[0];
  assert.ok(b.vx < 0);
  assert.ok(near(-b.vx / vin, carom.cloth.cushion, 0.03), `${-b.vx / vin}`);
  assert.ok(Math.abs(b.vy) < 1e-9);
  assert.ok(b.x <= carom.length / 2 - carom.ballRadius + 1e-9);
});

test('쿠션: 회전 없이는 들어간 각과 비슷하게, 옆 회전은 반사각을 바꾼다', () => {
  const plain = reboundAngle(carom, { angle: Math.PI / 4, speed: 2 });
  const right = reboundAngle(carom, { angle: Math.PI / 4, speed: 2, side: 1 });
  const left = reboundAngle(carom, { angle: Math.PI / 4, speed: 2, side: -1 });
  assert.ok(plain < -40 && plain > -60, `${plain}`);
  // 오른쪽 회전(위에서 보아 반시계)은 이 방향에서 따라가는 회전이라 쿠션을 따라 길게 빠진다
  assert.ok(right > plain + 8, `${right} vs ${plain}`);
  assert.ok(left < plain - 8, `${left} vs ${plain}`);
  // 정면으로 쳐도 옆 회전을 주면 옆으로 빠진다 (치는 사람 기준 오른쪽 회전 → 오른쪽)
  const sim = new Simulation(carom, [ball(0, 0, 0)]);
  sim.strike(0, { angle: Math.PI / 2, speed: 2, side: 1 });
  sim.run({ until: (s) => s.events.some((e) => e.type === 'cushion') });
  assert.ok(sim.balls[0].vx > 0.2); // +y 로 칠 때 오른쪽은 +x
});

test('밀어치기는 따라가고 끌어치기는 되돌아온다', () => {
  // 맞힌 뒤 0.8초 동안 수구가 간 거리
  const run = (vert) => {
    const sim = new Simulation(pool, [ball(0, -0.9, 0), ball(1, 0, 0)]);
    sim.strike(0, { angle: 0, speed: 3, vert });
    sim.run({ until: (s) => s.events.some((e) => e.type === 'hit') });
    const x = sim.balls[0].x;
    for (let i = 0; i < 800; i++) sim.step();
    return sim.balls[0].x - x;
  };
  const follow = run(1);
  const stun = run(-0.35);
  const draw = run(-1);
  assert.ok(follow > 0.3, `밀어치기 ${follow}`);
  assert.ok(draw < -0.25, `끌어치기 ${draw}`);
  assert.ok(Math.abs(stun) < 0.15, `멈춰치기 ${stun}`);
});

test('포켓: 코너와 사이드로 곧게 굴리면 빠진다', () => {
  const { length: L, width: W } = pool;
  const corner = simulate(pool, [ball(0, 0, 0)], 0, { angle: Math.atan2(W / 2, L / 2), speed: 2 });
  const pocketEvent = corner.events.find((e) => e.type === 'pocket');
  assert.ok(pocketEvent, '코너에 빠진다');
  assert.equal(pool.pockets[pocketEvent.pocket].corner, true);
  assert.equal(corner.balls[0].on, false);

  const side = simulate(pool, [ball(0, 0, -0.3)], 0, { angle: Math.PI / 2, speed: 1.5 });
  const sideEvent = side.events.find((e) => e.type === 'pocket');
  assert.ok(sideEvent, '사이드에 빠진다');
  assert.equal(pool.pockets[sideEvent.pocket].corner, false);
});

test('포켓: 레일을 따라 굴러도 코너에 빠지고, 쿠션 코를 맞히면 튕겨 나온다', () => {
  const { width: W } = pool;
  const R = pool.ballRadius;
  const along = simulate(pool, [ball(0, 0.3, W / 2 - R - 0.002)], 0, { angle: 0, speed: 1.2 });
  assert.ok(along.events.some((e) => e.type === 'pocket'));
  // 사이드 포켓을 아주 비스듬히 지나가면 빠지지 않는다
  const glance = simulate(pool, [ball(0, -0.6, -W / 2 + R + 0.004)], 0, { angle: 0, speed: 0.8 });
  assert.ok(!glance.events.some((e) => e.type === 'pocket' && !pool.pockets[e.pocket].corner));
});

test('캐롬 대에는 포켓이 없어 공이 대 밖으로 나가지 않는다', () => {
  const t = caromTable({ length: 2.84, width: 1.42, ballRadius: 0.03075 });
  for (let i = 0; i < 12; i++) {
    const r = simulate(t, [ball(0, 0.1, -0.2)], 0, { angle: i * 0.53, speed: 6, side: 1 - i / 6 });
    const b = r.balls[0];
    assert.ok(b.on);
    assert.ok(Math.abs(b.x) <= t.length / 2 - t.ballRadius + 1e-6);
    assert.ok(Math.abs(b.y) <= t.width / 2 - t.ballRadius + 1e-6);
  }
});

test('포켓볼 대의 쿠션 사슬은 6개, 포켓은 6개, 다이아몬드는 사이드 포켓 자리를 비운다', () => {
  const t = poolTable({ length: 2.54, width: 1.27, ballRadius: 0.028575 });
  assert.equal(t.chains.length, 6);
  assert.equal(t.pockets.length, 6);
  assert.equal(t.segments.length, 18);
  assert.equal(diamonds(t).length, 18);
  assert.equal(diamonds(carom).length, 20);
  // 사슬을 따라가면 왼쪽이 대 안쪽이다: 쿠션 코 선분의 왼쪽 법선은 원점을 향한다
  for (const chain of t.chains) {
    const [a, b] = [chain[1], chain[2]];
    const nx = -(b[1] - a[1]);
    const ny = b[0] - a[0];
    assert.ok(nx * -a[0] + ny * -a[1] > 0);
  }
});
