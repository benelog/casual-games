import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Green,
  Putt,
  simulate,
  BALL_R,
  CUP_R,
  DECEL,
  SAND_DECEL,
  SLOPE_K,
  WALL_E,
  WALL_KEEP,
  WALL_HALF,
  SPEED_MAX,
  STEP,
  speedOfPower,
  powerOfSpeed,
  rollDistance,
  direction,
  angleOf,
  inPolygon,
  inRegion,
  terrainAt,
  blockAt,
  bladeBox,
  MILL,
} from '../js/physics.js';

const near = (a, b, eps) => Math.abs(a - b) <= eps;

/** 넓은 네모 코스. 컵은 멀리 두어 방해하지 않게 한다 */
function field(extra = {}) {
  return new Green({
    par: 3,
    outline: [
      [-2, 6],
      [2, 6],
      [2, -6],
      [-2, -6],
    ],
    tee: [0, 5],
    cup: [1.7, -5.7],
    ...extra,
  });
}

/** 첫 번째 사건 type 이 일어날 때까지 굴린다 */
function runUntil(putt, type) {
  for (let i = 0; i < 600 * 30 && putt.moving; i++) {
    putt.substep(STEP);
    const event = putt.events.find((e) => e.type === type);
    if (event) return event;
  }
  return null;
}

// ---------- 기본 ----------

test('방향 각도: 0 은 화면 위(-z), + 는 오른쪽', () => {
  assert.ok(near(direction(0).z, -1, 1e-12));
  assert.ok(near(direction(Math.PI / 2).x, 1, 1e-12));
  for (const a of [-2.5, -1, 0, 0.3, 1.7, 3]) {
    const d = direction(a);
    assert.ok(near(angleOf(d.x, d.z), a, 1e-12));
  }
});

test('세기와 속도는 서로 바뀌고, 평지에서 구르는 거리는 세기에 비례한다', () => {
  assert.equal(speedOfPower(0), 0);
  assert.equal(speedOfPower(1), SPEED_MAX);
  for (const p of [0.1, 0.35, 0.8]) assert.ok(near(powerOfSpeed(speedOfPower(p)), p, 1e-12));
  assert.ok(near(rollDistance(speedOfPower(0.5)) / rollDistance(speedOfPower(0.25)), 2, 1e-9));
});

test('다각형·영역 안팎 판정', () => {
  const L = [
    [0, 0],
    [2, 0],
    [2, 1],
    [1, 1],
    [1, 2],
    [0, 2],
  ];
  assert.ok(inPolygon(L, 0.5, 1.5));
  assert.ok(inPolygon(L, 1.5, 0.5));
  assert.ok(!inPolygon(L, 1.5, 1.5));
  assert.ok(inRegion({ rect: [1, 1, -1, -1] }, 0.5, -0.5));
  assert.ok(!inRegion({ rect: [-1, -1, 1, 1] }, 1.2, 0));
  assert.ok(inRegion({ circle: [0, 0, 1, 0.5] }, 0.9, 0));
  assert.ok(!inRegion({ circle: [0, 0, 1, 0.5] }, 0, 0.6));
});

test('지형: 언덕 꼭대기는 평평하고, 비탈은 끝에서 평평해지며, 기울기는 높이의 변화와 맞는다', () => {
  const hill = { type: 'hill', x: 0, z: 0, r: 1, h: 0.1 };
  assert.ok(near(terrainAt(hill, 0, 0).h, 0.1, 1e-12));
  assert.equal(terrainAt(hill, 1.2, 0).h, 0);
  const ramp = { type: 'ramp', axis: 'z', from: 0, to: -1, h: 0.1 };
  assert.equal(terrainAt(ramp, 0, 0.5).h, 0);
  assert.ok(near(terrainAt(ramp, 0, -2).h, 0.1, 1e-12));
  assert.equal(terrainAt(ramp, 0, -2).gz, 0);
  // 수치 미분과 비교
  for (const f of [hill, ramp, { type: 'tilt', gx: 0.02, gz: -0.01 }]) {
    for (const [x, z] of [
      [0.3, -0.4],
      [-0.5, -0.2],
      [0.1, -0.7],
    ]) {
      const e = 1e-6;
      const t = terrainAt(f, x, z);
      const gx = (terrainAt(f, x + e, z).h - terrainAt(f, x - e, z).h) / (2 * e);
      const gz = (terrainAt(f, x, z + e).h - terrainAt(f, x, z - e).h) / (2 * e);
      assert.ok(near(t.gx, gx, 1e-6) && near(t.gz, gz, 1e-6), `${f.type} ${x},${z}`);
    }
  }
});

// ---------- 굴림 ----------

test('평지에서 공은 구름 저항으로 일정하게 느려져 v²/2a 만큼 가서 멈춘다', () => {
  const green = field();
  const speed = 2;
  const putt = simulate(green, { x: 0, z: 4 }, { angle: 0, speed });
  assert.equal(putt.result, 'stopped');
  assert.ok(near(4 - putt.ball.z, rollDistance(speed), 0.01), `${4 - putt.ball.z}`);
  assert.ok(near(putt.ball.x, 0, 1e-12));
  assert.ok(near(putt.elapsed, speed / DECEL, 0.03)); // STOP_SPEED 아래에서 조금 일찍 멈춘다
  assert.deepEqual(
    putt.events.map((e) => e.type),
    ['strike', 'stop'],
  );
});

test('모래에서는 훨씬 빨리 멈춘다', () => {
  const sandy = field({ sand: [{ rect: [-2, -6, 2, 6] }] });
  const speed = 2;
  const putt = simulate(sandy, { x: 0, z: 4 }, { angle: 0, speed });
  assert.ok(near(4 - putt.ball.z, rollDistance(speed, SAND_DECEL), 0.01));
  assert.ok(SAND_DECEL > DECEL * 4);
  // 모래 띠를 지나가면 그 앞에서보다 짧게 간다
  const band = field({ sand: [{ rect: [-2, 1, 2, 2] }] });
  const plain = simulate(field(), { x: 0, z: 4 }, { angle: 0, speed: 3 });
  const through = simulate(band, { x: 0, z: 4 }, { angle: 0, speed: 3 });
  assert.ok(through.events.some((e) => e.type === 'sand'));
  assert.ok(through.ball.z > plain.ball.z + 1, `${through.ball.z} vs ${plain.ball.z}`);
});

test('경사: 가파른 비탈에서는 (5/7)g·기울기 에서 구름 저항을 뺀 만큼 내리막으로 가속하고, 완만하면 멈춰 있다', () => {
  const g = 0.2; // 오른쪽이 높다
  const steep = field({ terrain: [{ type: 'tilt', gx: g }] });
  const putt = new Putt(steep, { x: 0, z: 0 });
  putt.strike({ angle: 0, speed: 0.001 });
  for (let i = 0; i < 300; i++) putt.substep(STEP); // 0.5초
  const expected = (SLOPE_K * g - DECEL) * 0.5;
  assert.ok(putt.ball.vx < 0, '왼쪽(내리막)으로 구른다');
  assert.ok(near(-putt.ball.vx, expected, 0.02), `${putt.ball.vx} vs ${expected}`);

  const gentle = field({ terrain: [{ type: 'tilt', gx: 0.03 }] });
  assert.ok(SLOPE_K * 0.03 < DECEL);
  const still = simulate(gentle, { x: 0, z: 0 }, { angle: 0, speed: 0.001 });
  assert.equal(still.result, 'stopped');
  assert.ok(near(still.ball.x, 0, 1e-3));
});

test('경사: 비탈 위로 친 공은 약하면 굴러 내려오고 세면 올라간다', () => {
  const green = field({ terrain: [{ type: 'ramp', axis: 'z', from: 0, to: -0.8, h: 0.1 }] });
  const weak = simulate(green, { x: 0, z: 2 }, { angle: 0, speed: 1.4 });
  assert.ok(weak.ball.z > 0, `약하게 친 공이 비탈 아래에 머문다 (${weak.ball.z})`);
  const strong = simulate(green, { x: 0, z: 2 }, { angle: 0, speed: 2.5 });
  assert.ok(strong.ball.z < -0.8, `세게 친 공은 비탈 위에 올라간다 (${strong.ball.z})`);
});

test('언덕은 옆을 지나는 공을 내리막 쪽으로 휜다', () => {
  const green = field({ terrain: [{ type: 'hill', x: 0.25, z: 0, r: 0.8, h: 0.08 }] });
  const putt = simulate(green, { x: 0, z: 3 }, { angle: 0, speed: 3 });
  assert.ok(putt.ball.x < -0.05, `${putt.ball.x}`);
});

// ---------- 벽 ----------

test('벽 반사: 수직으로 부딪치면 WALL_E 배 속도로 되튀고, 비스듬하면 벽을 따라가는 속도는 WALL_KEEP 배 남는다', () => {
  const green = field();
  // 위쪽 벽(z = -6)을 향해 곧게
  const putt = new Putt(green, { x: 0, z: -5 }).strike({ angle: 0, speed: 2 });
  let before = null;
  let event = null;
  for (let i = 0; i < 6000 && !event; i++) {
    before = { ...putt.ball };
    putt.substep(STEP);
    event = putt.events.find((e) => e.type === 'wall');
  }
  assert.ok(event, '벽에 닿는다');
  assert.equal(event.kind, 'wall');
  assert.ok(before.vz < 0 && putt.ball.vz > 0);
  assert.ok(near(putt.ball.vz, -before.vz * WALL_E, 0.01), `${putt.ball.vz} vs ${-before.vz * WALL_E}`);
  assert.ok(near(putt.ball.x, 0, 1e-9));
  // 공은 벽 안쪽에 머문다
  assert.ok(putt.ball.z >= -6 + WALL_HALF + BALL_R - 1e-9);

  // 45° 로 오른쪽 벽(x = 2)에
  const slant = new Putt(green, { x: 1.5, z: 0 }).strike({ angle: Math.PI / 4, speed: 2 });
  let prev = null;
  let hit = null;
  for (let i = 0; i < 6000 && !hit; i++) {
    prev = { ...slant.ball };
    slant.substep(STEP);
    hit = slant.events.find((e) => e.type === 'wall');
  }
  assert.ok(hit);
  assert.ok(near(slant.ball.vx, -prev.vx * WALL_E, 0.01));
  assert.ok(near(slant.ball.vz, prev.vz * WALL_KEEP, 0.01));
});

test('기둥에 정면으로 맞으면 되튄다', () => {
  const green = field({ posts: [[0, 2, 0.06]] });
  const putt = new Putt(green, { x: 0, z: 3 }).strike({ angle: 0, speed: 1.5 });
  const event = runUntil(putt, 'wall');
  assert.equal(event?.kind, 'post');
  assert.ok(putt.ball.vz > 0);
});

test('벽에 여러 번 부딪쳐도 코스 밖으로 나가지 않는다', () => {
  const green = field({ walls: [[-1, 0, 1, 0.3]], posts: [[0.5, 2, 0.05]] });
  for (let a = 0; a < 24; a++) {
    const putt = simulate(green, { x: 0.2, z: 3 }, { angle: (a / 24) * Math.PI * 2, speed: SPEED_MAX });
    assert.notEqual(putt.result, 'out', `angle ${a}`);
    assert.ok(green.inside(putt.ball.x, putt.ball.z));
  }
});

// ---------- 컵 ----------

/** 컵 중심에서 dist 앞, 옆으로 offset 떨어진 곳에서 컵에 도착할 때 arrive 속도가 되게 친다 */
function puttAtCup(arrive, { offset = 0, dist = 0.6 } = {}) {
  const green = field({ cup: [0, 0] });
  const speed = Math.sqrt(arrive * arrive + 2 * DECEL * (dist - CUP_R));
  return simulate(green, { x: offset, z: dist }, { angle: 0, speed });
}

test('컵: 느리게 굴러오면 들어간다', () => {
  for (const arrive of [0.2, 0.6, 1.2]) {
    const putt = puttAtCup(arrive);
    assert.equal(putt.result, 'holed', `${arrive} m/s`);
    assert.ok(putt.events.some((e) => e.type === 'cup'));
  }
});

test('컵: 너무 빠르면 튕겨 나가고, 가장자리를 스치면 같은 속도로도 튕겨 나간다', () => {
  const fast = puttAtCup(2.4);
  assert.notEqual(fast.result, 'holed');
  assert.ok(fast.events.some((e) => e.type === 'lip'));
  assert.ok(fast.ball.z < -CUP_R, '컵을 지나쳐 간다');

  assert.equal(puttAtCup(0.9).result, 'holed');
  const edge = puttAtCup(0.9, { offset: CUP_R * 0.85 });
  assert.notEqual(edge.result, 'holed');
  assert.ok(edge.events.some((e) => e.type === 'lip'));
});

test('컵: 들어가는 가장 빠른 속도는 한가운데가 약 1.6 m/s', () => {
  let fastest = 0;
  for (let v = 0.5; v < 2.5; v += 0.05) if (puttAtCup(v).result === 'holed') fastest = v;
  assert.ok(fastest > 1.4 && fastest < 1.8, `${fastest}`);
});

test('컵: 컵 밖을 지나는 공은 영향을 받지 않는다', () => {
  const putt = puttAtCup(1, { offset: CUP_R + 0.005 });
  assert.equal(putt.result, 'stopped');
  assert.ok(!putt.events.some((e) => e.type === 'lip' || e.type === 'cup'));
  assert.ok(near(putt.ball.x, CUP_R + 0.005, 1e-9));
});

// ---------- 물 ----------

test('물: 공 중심이 물 위에 오면 빠진다', () => {
  const green = field({ water: [{ circle: [0, 0, 0.3, 0.3] }] });
  const putt = simulate(green, { x: 0, z: 2 }, { angle: 0, speed: 2 });
  assert.equal(putt.result, 'water');
  const event = putt.events.find((e) => e.type === 'water');
  assert.ok(event && Math.hypot(event.x, event.z) <= 0.3);
  // 옆으로 지나가면 괜찮다
  const miss = simulate(green, { x: 0.4, z: 2 }, { angle: 0, speed: 2 });
  assert.equal(miss.result, 'stopped');
});

// ---------- 움직이는 장애물 ----------

test('블록은 sin 으로 좌우를 오가고, 속도는 그 미분이다', () => {
  const block = { x: 0, z: 0, w: 0.3, d: 0.1, move: { axis: 'x', amp: 0.4, period: 2 } };
  assert.ok(near(blockAt(block, 0).x, 0, 1e-12));
  assert.ok(near(blockAt(block, 0.5).x, 0.4, 1e-12));
  assert.ok(near(blockAt(block, 0).vx, (0.4 * 2 * Math.PI) / 2, 1e-12));
  const e = 1e-6;
  assert.ok(near(blockAt(block, 0.3).vx, (blockAt(block, 0.3 + e).x - blockAt(block, 0.3 - e).x) / (2 * e), 1e-5));
});

test('움직이는 블록: 치는 시각에 따라 막히기도 지나가기도 하고, 같은 시각이면 언제나 같은 결과다', () => {
  const green = field({ blocks: [{ x: 0, z: 0, w: 0.4, d: 0.1, move: { axis: 'x', amp: 0.6, period: 2 } }] });
  const shot = { angle: 0, speed: 2.2 };
  const results = [];
  for (let t = 0; t < 2; t += 0.1) {
    const putt = simulate(green, { x: 0, z: 1.5 }, shot, t);
    results.push({ t, blocked: putt.events.some((e) => e.kind === 'block'), z: putt.ball.z });
  }
  assert.ok(results.some((r) => r.blocked));
  assert.ok(results.some((r) => !r.blocked));
  const a = simulate(green, { x: 0, z: 1.5 }, shot, 0.7);
  const b = simulate(green, { x: 0, z: 1.5 }, shot, 0.7);
  assert.deepEqual(a.ball, b.ball);
  assert.deepEqual(
    a.events.map((e) => e.type),
    b.events.map((e) => e.type),
  );
});

test('프레임 길이와 상관없이 같은 결과', () => {
  const green = field({ blocks: [{ x: 0, z: 0, w: 0.4, d: 0.1, move: { axis: 'x', amp: 0.6, period: 2 } }], posts: [[0.3, -1, 0.05]] });
  const shoot = (frame) => {
    const putt = new Putt(green, { x: 0.1, z: 2 }, 0.3).strike({ angle: 0.05, speed: 3 });
    for (let i = 0; i < 10000 && putt.moving; i++) putt.advance(frame(i));
    return putt.ball;
  };
  const a = shoot(() => 1 / 60);
  const b = shoot((i) => (i % 3 === 0 ? 1 / 30 : 1 / 144));
  assert.ok(near(a.x, b.x, 1e-9) && near(a.z, b.z, 1e-9), `${a.x},${a.z} vs ${b.x},${b.z}`);
});

test('풍차: 날개가 아래로 내려온 동안만 굴 입구를 가린다', () => {
  const mill = { x: 0, z: 0, width: 1.6, depth: 0.6, gap: 0.24, period: 4 };
  // 날개 0 이 아래를 가리키는 순간 한가운데를 가린다
  const down = bladeBox(mill, 0, 0);
  assert.ok(down && near(down.x, 0, 1e-12));
  // 45° 돌면 날개 4장 모두 땅에 닿지 않는다
  for (let k = 0; k < 4; k++) assert.equal(bladeBox(mill, k, mill.period / 8), null);
  assert.ok(MILL.blade > MILL.hub - BALL_R);

  const green = field({ windmills: [mill] });
  const shot = { angle: 0, speed: 2.5 };
  let through = 0;
  let blocked = 0;
  for (let t = 0; t < mill.period; t += 0.1) {
    const putt = simulate(green, { x: 0, z: 1.2 }, shot, t);
    if (putt.ball.z < -0.3) through++;
    if (putt.events.some((e) => e.kind === 'blade')) blocked++;
  }
  assert.ok(through > 0 && blocked > 0, `${through} / ${blocked}`);
});

test('풍차 건물은 굴 말고는 지나갈 수 없다', () => {
  const green = field({ windmills: [{ x: 0, z: 0, width: 4, depth: 0.6, gap: 0.24, period: 4 }] });
  const putt = simulate(green, { x: 0.8, z: 1.2 }, { angle: 0, speed: 3 });
  assert.ok(putt.ball.z > 0.3);
  assert.ok(putt.events.some((e) => e.type === 'wall' && e.kind === 'block'));
});

test('움직이는 장애물이 지나는 자리에 멈춘 공은 옆으로 옮긴다', () => {
  const green = field({ blocks: [{ x: 0, z: 0, w: 0.3, d: 0.1, move: { axis: 'x', amp: 0.5, period: 2 } }] });
  const spot = green.clearSpot(0.2, 0.02);
  assert.equal(spot.moved, true);
  assert.ok(Math.abs(spot.z) > 0.05 + BALL_R);
  assert.ok(green.playable(spot.x, spot.z));
  assert.deepEqual(green.clearSpot(0.2, 1), { x: 0.2, z: 1, moved: false });
});
