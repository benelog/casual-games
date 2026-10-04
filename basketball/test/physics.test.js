import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BALL_RADIUS,
  RIM_Y,
  RIM_RADIUS,
  RIM_TUBE,
  BOARD_Z,
  ENTRY,
  G,
  Court,
  HoopMotion,
  makeBall,
  launch,
  launchElevation,
  idealSpeed,
  releasePoint,
  rimContact,
  simulate,
  swipeToShot,
  SWIPE_FULL,
  YAW_LIMIT,
} from '../js/physics.js';
import { STAGES } from '../js/game.js';

const at = (x, y, z, v = {}, w = {}) => makeBall({ x, y, z }, { x: 0, y: 0, z: 0, ...v }, { x: 0, y: 0, z: 0, ...w });
const types = (events) => events.map((e) => e.type);

// ---------- 슛 ----------

test('알맞은 속력으로 던지면 림 중심을 ENTRY 각도로 지난다', () => {
  const d = 4.62;
  const h = 1.55;
  const elevation = launchElevation(d, h);
  const v = idealSpeed(d, h, elevation);
  const vx = v * Math.cos(elevation);
  const time = d / vx;
  const y = v * Math.sin(elevation) * time - (G * time * time) / 2;
  assert.ok(Math.abs(y - h) < 1e-9);
  const vy = v * Math.sin(elevation) - G * time;
  assert.ok(Math.abs(Math.atan2(-vy, vx) - ENTRY) < 1e-9);
  assert.ok(Number.isNaN(idealSpeed(1, 2, 0.1)), '그 각으로 닿을 수 없으면 NaN');
});

test('모든 자리에서 세기 50%·정면으로 던지면 클린슛이 된다', () => {
  for (const stage of STAGES) {
    const { result, events } = simulate(launch(stage.distance, stage.angle, { power: 0.5 }));
    assert.equal(result, 'make', stage.id);
    const score = events.find((e) => e.type === 'score');
    assert.equal(score.clean, true, stage.id);
    assert.ok(!types(events).includes('rim'), stage.id);
  }
});

test('너무 약하면 림에 못 미치고 바닥에 떨어져 실패한다 (에어볼)', () => {
  const { result, ball, events } = simulate(launch(4.22, 0, { power: 0 }));
  assert.equal(result, 'miss');
  assert.equal(ball.touchedRim, false);
  assert.equal(ball.touchedBoard, false);
  assert.ok(types(events).includes('miss'));
});

test('조금 짧으면 앞 림을 맞고, 방향이 틀어지면 들어가지 않는다', () => {
  const short = simulate(launch(4.22, 0, { power: 0.35 }));
  assert.equal(short.ball.touchedRim, true);
  const wide = simulate(launch(4.22, 0, { power: 0.5, yaw: 0.08 }));
  assert.equal(wide.result, 'miss');
});

test('세게 던지면 백보드를 맞는다', () => {
  const { ball, events } = simulate(launch(4.22, 0, { power: 1 }), { after: 1 });
  assert.equal(ball.touchedBoard, true);
  assert.ok(types(events).includes('board'));
});

test('같은 슛은 언제나 같은 결과다', () => {
  const a = simulate(launch(4.88, 0.526, { power: 0.43, yaw: 0.01 }), { after: 2 });
  const b = simulate(launch(4.88, 0.526, { power: 0.43, yaw: 0.01 }), { after: 2 });
  assert.deepEqual([a.ball.x, a.ball.y, a.ball.z], [b.ball.x, b.ball.y, b.ball.z]);
  assert.deepEqual(types(a.events), types(b.events));
});

test('공을 놓는 자리는 서 있는 자리 뒤쪽, 골대를 향하는 방향이다', () => {
  const p = releasePoint(4.22, 0.5);
  assert.ok(Math.hypot(p.x, p.z) > 4.22);
  const ball = launch(4.22, 0.5, { power: 0.5 });
  // 수평 속도는 림 중심(원점) 쪽을 향한다
  const toward = -(ball.x * ball.vx + ball.z * ball.vz) / (Math.hypot(ball.x, ball.z) * Math.hypot(ball.vx, ball.vz));
  assert.ok(toward > 0.9999);
});

test('던진 공에는 역회전이 걸린다 (윗면이 진행 반대 방향)', () => {
  const ball = launch(4.22, 0, { power: 0.5 });
  // 위쪽 점의 회전 속도 ω × (0, R, 0) 의 z 성분: 진행 방향(-z)의 반대(+z)여야 한다
  const topVz = ball.wx * BALL_RADIUS;
  assert.ok(ball.vz < 0);
  assert.ok(topVz > 0);
});

// ---------- 스와이프 ----------

test('스와이프: 위로 길게 밀수록 세고, 기울이면 그쪽으로', () => {
  const h = 800;
  assert.equal(swipeToShot(0, -20, h), null, '너무 짧다');
  assert.equal(swipeToShot(0, 200, h), null, '아래로 밀었다');
  assert.equal(swipeToShot(0, -100, 0), null);
  const half = swipeToShot(0, -SWIPE_FULL * h * 0.5, h);
  assert.ok(Math.abs(half.power - 0.5) < 1e-9);
  assert.equal(half.yaw, 0);
  assert.equal(swipeToShot(0, -h, h).power, 1);
  assert.ok(swipeToShot(60, -300, h).yaw > 0);
  assert.ok(swipeToShot(-60, -300, h).yaw < 0);
  assert.equal(swipeToShot(-2000, -100, h).yaw, -YAW_LIMIT);
});

// ---------- 충돌 ----------

test('림 위에 떨어진 공은 위로 튄다', () => {
  const ball = at(RIM_RADIUS, RIM_Y + BALL_RADIUS + RIM_TUBE + 0.3, 0);
  const court = new Court();
  court.add(ball);
  let hit = null;
  for (let i = 0; i < 60 && !hit; i++) {
    court.step(1 / 60);
    hit = court.drain().find((e) => e.type === 'rim');
  }
  assert.ok(hit, '림에 맞는다');
  assert.ok(ball.vy > 0, '위로 튄다');
  assert.equal(ball.touchedRim, true);
});

test('림 바깥쪽 위를 맞으면 밖으로, 안쪽 위를 맞으면 안으로 튄다', () => {
  const contact = (dx) => rimContact(at(RIM_RADIUS + dx, RIM_Y + BALL_RADIUS + RIM_TUBE - 0.01, 0));
  assert.ok(contact(0.03).n.x > 0);
  assert.ok(contact(-0.03).n.x < 0);
  assert.equal(rimContact(at(0, RIM_Y, 0)), null, '림 한가운데는 닿지 않는다');
});

test('림 안으로 곧게 떨어지면 클린슛으로 득점하고 그물이 흔들린다', () => {
  const { result, events } = simulate(at(0, RIM_Y + 1, 0, { y: -1 }));
  assert.equal(result, 'make');
  const score = events.find((e) => e.type === 'score');
  assert.equal(score.clean, true);
  assert.ok(types(events).includes('net'));
});

test('그물을 지나며 공이 느려진다', () => {
  const free = at(3, RIM_Y + 1, 3, { y: -1 });
  const netted = at(0, RIM_Y + 1, 0, { y: -1 });
  const court = new Court();
  court.add(free);
  court.add(netted);
  for (let i = 0; i < 36; i++) court.step(1 / 60);
  assert.ok(Math.abs(netted.vy) < Math.abs(free.vy));
});

test('림 아래에서 위로 올라갔다 내려오는 공은 득점이 아니다', () => {
  const { events } = simulate(at(0, RIM_Y - 0.6, 0, { y: 4 }), { limit: 3 });
  assert.ok(!types(events).includes('score'));
});

test('백보드에 맞으면 튕겨 나온다', () => {
  const ball = at(0.5, 3.4, BOARD_Z + 0.5, { z: -6, y: 0 });
  const court = new Court();
  court.add(ball);
  for (let i = 0; i < 12; i++) court.step(1 / 60);
  assert.ok(ball.vz > 0);
  assert.equal(ball.touchedBoard, true);
  assert.ok(ball.z - BALL_RADIUS >= BOARD_Z - 1e-6);
});

test('바닥에서는 튀어 오르고, 높이가 줄며, 결국 멈춘다', () => {
  const ball = at(3, 2, 3);
  ball.live = false; // 결과 판정 없이 튀기기만
  const court = new Court();
  court.add(ball);
  const peaks = [];
  let rising = false;
  let last = ball.y;
  for (let i = 0; i < 60 * 30 && !ball.resting; i++) {
    court.step(1 / 60);
    if (rising && ball.y < last) peaks.push(last);
    rising = ball.y > last;
    last = ball.y;
  }
  assert.ok(peaks.length >= 3);
  assert.ok(peaks[0] < 2 && peaks[0] > 0.9, `첫 반동 ${peaks[0]}`);
  for (let i = 1; i < peaks.length; i++) assert.ok(peaks[i] < peaks[i - 1]);
  assert.ok(ball.resting, '멈춘다');
  assert.ok(Math.abs(ball.y - BALL_RADIUS) < 0.01);
});

test('미끄러지며 바닥에 닿으면 회전이 붙는다', () => {
  const ball = at(0, 1, 5, { x: 3, y: -2 });
  ball.live = false;
  const court = new Court();
  court.add(ball);
  for (let i = 0; i < 30; i++) court.step(1 / 60);
  // +x 로 굴러가면 축은 -z (ω = n × v / R 꼴)
  assert.ok(ball.wz < -1);
});

test('결과가 안 나는 공은 시간이 지나면 실패로 친다', () => {
  // 백보드 위에 얹힌 공
  const ball = at(0, 3.95 + BALL_RADIUS, BOARD_Z - 0.025);
  const { result } = simulate(ball, { limit: 8 });
  assert.equal(result, 'miss');
});

// ---------- 움직이는 골대 ----------

test('골대는 좌우로 오가고, 폭은 서서히 바뀐다', () => {
  const hoop = new HoopMotion({ amplitude: 0, period: 4 });
  hoop.setAmplitude(0.4);
  hoop.step(0.05);
  assert.ok(hoop.amplitude > 0 && hoop.amplitude < 0.4);
  for (let i = 0; i < 800; i++) hoop.step(0.01);
  assert.ok(Math.abs(hoop.amplitude - 0.4) < 1e-3);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < 400; i++) {
    hoop.step(0.01);
    min = Math.min(min, hoop.x);
    max = Math.max(max, hoop.x);
  }
  assert.ok(max > 0.39 && min < -0.39);
});

test('움직이는 골대: 가운데를 노리면 빗나가기도 하고, 골대가 올 자리를 노리면 들어간다', () => {
  const stage = STAGES.find((s) => s.move > 0);
  const results = [];
  for (const time of [0, 1, 2, 3]) {
    const hoop = new HoopMotion({ amplitude: stage.move, period: 4.5 });
    hoop.time = time;
    hoop.step(1e-3);
    const ball = launch(stage.distance, stage.angle, { power: 0.5 });
    // 골대가 공이 닿을 때 있을 자리 쪽으로 방향을 튼다
    const flight = 0.95;
    const future = stage.move * Math.sin((2 * Math.PI * (hoop.time + flight)) / hoop.period);
    const lead = launch(stage.distance, stage.angle, { power: 0.5, yaw: -Math.atan2(future, stage.distance + 0.4) });
    const straight = simulate(ball, { hoop: Object.assign(new HoopMotion({ amplitude: stage.move, period: 4.5 }), { time: hoop.time }) });
    const aimed = simulate(lead, { hoop: Object.assign(new HoopMotion({ amplitude: stage.move, period: 4.5 }), { time: hoop.time }) });
    results.push({ straight: straight.result, aimed: aimed.result });
  }
  assert.ok(results.some((r) => r.straight === 'miss'), JSON.stringify(results));
  assert.ok(results.filter((r) => r.aimed === 'make').length >= 3, JSON.stringify(results));
});
