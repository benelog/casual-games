import test from 'node:test';
import assert from 'node:assert/strict';
import {
  G,
  ENTRY,
  MOUTH_Y,
  MOUTH_INNER,
  EAR_X,
  EAR_R,
  EAR_TOP,
  ARROW_TIP,
  ARROW_RADIUS,
  HALF_WALL,
  SHAPES,
  TARGETS,
  YAW_LIMIT,
  SWIPE_FULL,
  Yard,
  makeArrow,
  launch,
  launchElevation,
  idealSpeed,
  aimFor,
  simulate,
  shapeDistance,
  holeOf,
  judge,
  tipOf,
  swipeToShot,
  swayAmplitude,
  applySway,
} from '../js/physics.js';
import { LINES } from '../js/game.js';

const types = (events) => events.map((e) => e.type);
/** 촉을 tip 에 두고 방향 u 로 놓은 화살 */
const arrowAt = (tip, u, v = { x: 0, y: 0, z: 0 }) => {
  const len = Math.hypot(u.x, u.y, u.z);
  const d = { x: u.x / len, y: u.y / len, z: u.z / len };
  return makeArrow({ x: tip.x - d.x * ARROW_TIP, y: tip.y - d.y * ARROW_TIP, z: tip.z - d.z * ARROW_TIP }, v, d);
};

// ---------- 던지기 ----------

test('알맞은 속력으로 던지면 겨눈 곳을 ENTRY 각도로 지난다', () => {
  const d = 2.7;
  const h = -0.58;
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

test('모든 줄에서 세기 50%·정면으로 던지면 입에 들어간다', () => {
  for (const line of LINES) {
    const { result, events, arrow } = simulate(launch(line.distance, { power: 0.5 }), { rest: true });
    assert.equal(result, 'mouth', line.id);
    assert.ok(events.some((e) => e.type === 'enter' && e.hole === 'mouth'), line.id);
    // 촉이 몸통 안 바닥 가까이까지 내려가 멈춘다
    assert.ok(tipOf(arrow).y < 0.2, line.id);
    assert.equal(arrow.resting, true);
  }
});

test('입 둘레 조금 빗나가도 나팔처럼 벌어진 입이 받아 준다', () => {
  for (const x of [-0.04, 0.04]) {
    const { result } = simulate(launch(3, { power: 0.5, yaw: Math.atan2(x, 3) }));
    assert.equal(result, 'mouth', String(x));
  }
});

test('귀를 겨누면 귀에 들어간다', () => {
  for (const line of LINES) {
    for (const side of ['earLeft', 'earRight']) {
      const shot = aimFor(line.distance, TARGETS[side]);
      const { result, events, arrow } = simulate(launch(line.distance, shot), { rest: true });
      assert.equal(result, 'ear', `${line.id} ${side}`);
      assert.ok(events.some((e) => e.type === 'enter' && e.hole === 'ear'));
      assert.equal(Math.sign(tipOf(arrow).x), side === 'earLeft' ? -1 : 1);
    }
  }
});

test('너무 약하면 입에 못 미치고 항아리 몸통에 맞아 앞에 떨어진다', () => {
  const { result, arrow, events } = simulate(launch(3, { power: 0 }), { rest: true });
  assert.equal(result, 'miss');
  assert.ok(!types(events).includes('enter'));
  assert.ok(types(events).includes('ground'));
  assert.ok(tipOf(arrow).z > 0.1, '항아리 앞에 떨어진다');
});

test('너무 세면 항아리를 넘어간다', () => {
  const { result, arrow } = simulate(launch(3, { power: 1 }));
  assert.equal(result, 'miss');
  assert.ok(tipOf(arrow).z < -0.1, '항아리 뒤에 떨어진다');
});

test('옆으로 크게 빗나가면 항아리에 닿지 않는다', () => {
  const { result, arrow } = simulate(launch(3, { power: 0.5, yaw: YAW_LIMIT }));
  assert.equal(result, 'miss');
  assert.equal(arrow.touchedPot, false);
});

test('조금 짧으면 입 앞 테두리를 맞고 튕겨 나간다', () => {
  // 들어가는 세기 범위 바로 아래: 항아리에 맞고(소리) 결국 빗나간다
  let bounced = null;
  for (let power = 0.45; power >= 0.3; power -= 0.01) {
    const { result, arrow, events } = simulate(launch(3, { power }));
    if (result === 'miss' && arrow.touchedPot) {
      bounced = { power, events };
      break;
    }
  }
  assert.ok(bounced, '테두리에 맞고 튕겨 나가는 세기가 있다');
  const kinds = types(bounced.events);
  assert.ok(kinds.indexOf('pot') < kinds.indexOf('result'), '부딪힌 뒤에 빗나감이 정해진다');
});

test('테두리 위로 떨어진 화살: 안쪽을 맞으면 미끄러져 들어가고 바깥쪽을 맞으면 튕겨 나간다', () => {
  const lip = 0.072; // 입술(벽 중심선 끝)의 반지름
  const inside = simulate(arrowAt({ x: 0, y: 0.7, z: lip - 0.01 }, { x: 0, y: -1, z: 0 }, { x: 0, y: -3, z: 0 }), { rest: true });
  assert.equal(inside.result, 'mouth');
  assert.equal(inside.arrow.touchedPot, true);
  const outside = simulate(arrowAt({ x: 0, y: 0.7, z: lip + 0.008 }, { x: 0, y: -1, z: 0.02 }, { x: 0, y: -3, z: 0.1 }), { rest: true });
  assert.equal(outside.result, 'miss');
  assert.equal(outside.arrow.touchedPot, true);
  assert.ok(types(outside.events).includes('pot'));
});

test('비스듬히 목에 걸친 화살은 의간(걸침)이다', () => {
  // 촉을 목 안쪽 먼 벽에 대고 50° 기울여 놓으면 가까운 테두리에 걸쳐 멈춘다
  const a = (50 * Math.PI) / 180;
  const tip = { x: MOUTH_INNER - 0.008, y: MOUTH_Y - 0.03, z: 0 };
  const arrow = arrowAt({ ...tip, y: tip.y + 0.01 }, { x: Math.cos(a), y: -Math.sin(a), z: 0 });
  const { result } = simulate(arrow, { rest: true });
  assert.equal(result, 'lean');
  assert.equal(holeOf(tipOf(arrow)), 'lean');
});

test('같은 던지기는 언제나 같은 결과다', () => {
  const shot = { power: 0.43, yaw: 0.012, pitch: 0.02 };
  const a = simulate(launch(3.5, shot), { rest: true }).arrow;
  const b = simulate(launch(3.5, shot), { rest: true }).arrow;
  assert.deepEqual([a.x, a.y, a.z, a.ux, a.uy, a.uz, a.result], [b.x, b.y, b.z, b.ux, b.uy, b.uz, b.result]);
});

test('여러 화살을 한 마당에서 함께 날린다', () => {
  const yard = new Yard();
  const first = yard.add(launch(2.5, { power: 0.5 }));
  const second = yard.add(launch(2.5, { power: 0 }));
  for (let i = 0; i < 400 && !(first.resting && second.resting); i++) yard.step(1 / 60);
  const results = yard.drain().filter((e) => e.type === 'result');
  assert.equal(results.length, 2);
  assert.equal(first.result, 'mouth');
  assert.equal(second.result, 'miss');
});

// ---------- 항아리 모양과 판정 ----------

test('벽까지의 거리: 입 가운데는 비어 있고 벽 안에서는 음수다', () => {
  const pot = SHAPES[0];
  assert.ok(shapeDistance(pot, 0, MOUTH_Y - 0.05, 0) > MOUTH_INNER - 0.01);
  assert.ok(shapeDistance(pot, 0.165, 0.18, 0) < 0, '몸통 벽 속');
  const n = { x: 0, y: 0, z: 0 };
  const d = shapeDistance(pot, 0, 0.18, 0.2, n);
  assert.ok(Math.abs(d - (0.2 - 0.165 - HALF_WALL)) < 0.003);
  assert.ok(n.z > 0.99, '바깥쪽을 향하는 법선');
  const ear = SHAPES[2];
  assert.ok(Math.abs(shapeDistance(ear, EAR_X, EAR_TOP - 0.03, 0) - (EAR_R - HALF_WALL)) < 1e-9, '귀 통 가운데');
});

test('촉의 자리로 입·귀·걸침·빗나감을 가른다', () => {
  assert.equal(holeOf({ x: 0, y: 0.1, z: 0.05 }), 'mouth');
  assert.equal(holeOf({ x: 0.02, y: 0.48, z: 0 }), 'lean');
  assert.equal(holeOf({ x: EAR_X, y: EAR_TOP - 0.06, z: 0 }), 'ear');
  assert.equal(holeOf({ x: -EAR_X, y: EAR_TOP - 0.01, z: 0 }), 'lean');
  assert.equal(holeOf({ x: 0, y: 0.7, z: 0 }), null);
  assert.equal(holeOf({ x: 0.3, y: 0.005, z: 0 }), null);
  assert.equal(judge(makeArrow({ x: 0.5, y: ARROW_RADIUS, z: 0 }, undefined, { x: 1, y: 0, z: 0 })), 'miss');
});

// ---------- 조작 ----------

test('스와이프: 위로 민 길이가 세기, 기울기가 방향', () => {
  const h = 800;
  assert.equal(swipeToShot(0, -10, h), null, '너무 짧으면 던지지 않는다');
  assert.equal(swipeToShot(0, 200, h), null, '아래로 밀면 던지지 않는다');
  const full = swipeToShot(0, -SWIPE_FULL * h, h);
  assert.equal(full.power, 1);
  assert.equal(full.yaw, 0);
  const half = swipeToShot(0, -SWIPE_FULL * h * 0.5, h);
  assert.ok(Math.abs(half.power - 0.5) < 1e-9);
  assert.ok(swipeToShot(60, -200, h).yaw > 0, '오른쪽으로 기울이면 오른쪽');
  assert.ok(swipeToShot(-60, -200, h).yaw < 0);
  assert.equal(swipeToShot(5000, -200, h).yaw, YAW_LIMIT);
});

test('손 흔들림: 누르고 기다리면 차분해지고, 오래 버티면 지치며, 먼 줄일수록 크다', () => {
  const idle = swayAmplitude(null, 3);
  assert.ok(swayAmplitude(0, 3) >= idle - 1e-9);
  assert.ok(swayAmplitude(1.5, 3) < idle * 0.5);
  assert.ok(swayAmplitude(9, 3) > swayAmplitude(2, 3));
  assert.ok(swayAmplitude(2, 3.5) > swayAmplitude(2, 2.5));
  const swayed = applySway({ power: 0.5, yaw: 0 }, { x: 1, y: -1 });
  assert.ok(swayed.yaw > 0);
  assert.ok(swayed.power < 0.5);
  assert.ok(swayed.pitch < 0);
  assert.equal(applySway({ power: 1, yaw: 0 }, { x: 0, y: 10 }).power, 1);
});
