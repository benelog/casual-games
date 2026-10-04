import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAR,
  STEP,
  MAX_FORWARD,
  MAX_REVERSE,
  makeCar,
  advance,
  forward,
  turnRadius,
  updateSpeed,
  makeBox,
  carBox,
  corners,
  overlap,
  gap,
  stepCar,
  wrapAngle,
} from '../js/physics.js';
import { ParkingRun, parkStatus, evaluate, starsOf, spotBox, PARK_HOLD, ANGLE_TOLERANCE, CRASH_SPEED } from '../js/game.js';
import { LEVELS, buildObstacles } from '../js/levels.js';
import { solve } from '../js/solver.js';
import { SaveStore, PROGRESS_KEY, SETTINGS_KEY, DEFAULT_SETTINGS, better, validateSettings } from '../js/save.js';
import { Driver, KEYS, WHEEL_TURN, GAS_START, wheelDelta } from '../js/controls.js';

const near = (a, b, eps) => Math.abs(a - b) <= eps;
const N = Math.PI;
const E = Math.PI / 2;

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

/** 장애물 없는 빈 단계 */
function emptyLevel(overrides = {}) {
  return {
    id: 'test',
    bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
    start: { x: 0, z: 0, heading: N },
    spot: { x: 0, z: -10, heading: N, width: 2.6, length: 5.2, bothWays: false },
    cars: [],
    pillars: [],
    walls: [],
    curbs: [],
    cones: [],
    lines: [],
    par: { time: 20, switches: 1 },
    maxContacts: null,
    ...overrides,
  };
}

/** 판을 seconds 초 동안 같은 입력으로 몬다 */
function drive(run, input, seconds) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) run.update(STEP, input);
}

// ---------- 차량 운동 ----------

test('방향 0 은 +z, π 는 -z, π/2 는 +x 를 본다', () => {
  assert.ok(near(forward(0).z, 1, 1e-12));
  assert.ok(near(forward(N).z, -1, 1e-12));
  assert.ok(near(forward(E).x, 1, 1e-12));
  assert.ok(near(wrapAngle(3 * Math.PI), Math.PI, 1e-12) || near(wrapAngle(3 * Math.PI), -Math.PI, 1e-12));
  assert.ok(near(wrapAngle(-0.5 - 4 * Math.PI), -0.5, 1e-12));
});

test('핸들이 가운데면 곧게 나아가고, 후진하면 그대로 되돌아온다', () => {
  const start = { x: 1, z: 2, heading: 0.7 };
  const ahead = advance(start, 5, 0);
  assert.ok(near(Math.hypot(ahead.x - 1, ahead.z - 2), 5, 1e-9));
  assert.ok(near(ahead.heading, 0.7, 1e-12));
  const back = advance(ahead, -5, 0);
  assert.ok(near(back.x, 1, 1e-9) && near(back.z, 2, 1e-9));
});

test('핸들을 끝까지 꺾으면 뒤축이 반지름 축간거리/tan(최대 조향각) 의 원을 그린다', () => {
  const R = turnRadius(1);
  assert.ok(near(R, CAR.wheelbase / Math.tan(CAR.maxSteer), 1e-12));
  assert.ok(R > 3 && R < 4.5, `회전 반지름 ${R}`); // 승용차답게
  assert.equal(turnRadius(0), Infinity);
  // 한 바퀴를 작은 걸음으로 돌면 제자리로 돌아오고, 그동안 뒤축은 중심에서 R 만큼 떨어져 있다
  let pose = { x: 0, z: 0, heading: N };
  const rear = (p) => ({ x: p.x - forward(p.heading).x * CAR.rearAxle, z: p.z - forward(p.heading).z * CAR.rearAxle });
  const r0 = rear(pose);
  // 북쪽을 보고 오른쪽으로 돌면 회전 중심은 뒤축의 동쪽(+x)
  const center = { x: r0.x + R, z: r0.z };
  const steps = 400;
  for (let i = 0; i < steps; i++) {
    pose = advance(pose, (2 * Math.PI * R) / steps, 1);
    const r = rear(pose);
    assert.ok(near(Math.hypot(r.x - center.x, r.z - center.z), R, 1e-6));
  }
  assert.ok(near(pose.x, 0, 1e-6) && near(pose.z, 0, 1e-6));
  assert.ok(near(wrapAngle(pose.heading - N), 0, 1e-9));
});

test('오른쪽으로 꺾고 전진하면 오른쪽으로, 후진하면 차 뒤가 오른쪽으로 간다', () => {
  // 북쪽(-z)을 보는 차의 오른쪽은 +x
  const ahead = advance({ x: 0, z: 0, heading: N }, 3, 1);
  assert.ok(ahead.x > 0.5 && ahead.z < -1);
  assert.ok(ahead.heading < N); // 시계 방향
  const back = advance({ x: 0, z: 0, heading: N }, -3, 1);
  assert.ok(back.x > 0.2 && back.z > 1);
  assert.ok(back.heading > N || back.heading < 0); // 반시계 방향 (π 를 넘으면 -π 쪽으로 감긴다)
});

test('가속하면 최고 속도에 다가가고, 브레이크·엔진 브레이크로 멈춘다', () => {
  const car = makeCar({ x: 0, z: 0, heading: 0 });
  for (let i = 0; i < 120 * 20; i++) updateSpeed(car, { throttle: 1 }, STEP);
  assert.ok(car.speed > MAX_FORWARD * 0.95 && car.speed <= MAX_FORWARD);
  for (let i = 0; i < 120; i++) updateSpeed(car, { brake: 1 }, STEP);
  assert.equal(car.speed, 0);
  car.gear = 'R';
  for (let i = 0; i < 120 * 20; i++) updateSpeed(car, { throttle: 1 }, STEP);
  assert.ok(car.speed < -MAX_REVERSE * 0.95 && car.speed >= -MAX_REVERSE);
  for (let i = 0; i < 120 * 5; i++) updateSpeed(car, {}, STEP);
  assert.equal(car.speed, 0); // 페달을 놓으면 서서히 선다
});

test('뒤로 구르는 중에 D 기어로 가속하면 먼저 멈춘 뒤 앞으로 간다', () => {
  const car = makeCar({ x: 0, z: 0, heading: 0 });
  car.speed = -2;
  car.gear = 'D';
  let stoppedAt = -1;
  for (let i = 0; i < 240; i++) {
    updateSpeed(car, { throttle: 1 }, STEP);
    if (stoppedAt < 0 && car.speed >= 0) stoppedAt = i;
  }
  assert.ok(stoppedAt > 0);
  assert.ok(car.speed > 0.5);
});

// ---------- OBB 충돌 ----------

test('나란한 사각형: 겹치면 깊이와 b → a 방향을, 떨어지면 null 과 거리를', () => {
  const a = makeBox(0, 0, 0, 4, 2); // 길이 4 는 z, 너비 2 는 x
  const b = makeBox(1.9, 0, 0, 4, 2);
  const hit = overlap(a, b);
  assert.ok(hit);
  assert.ok(near(hit.depth, 0.1, 1e-9));
  assert.ok(near(Math.abs(hit.normal.x), 1, 1e-9) && hit.normal.x < 0);
  const c = makeBox(2.5, 0, 0, 4, 2);
  assert.equal(overlap(a, c), null);
  assert.ok(near(gap(a, c), 0.5, 1e-9));
  assert.equal(gap(a, b), 0);
});

test('돌린 사각형은 경계 상자가 겹쳐도 분리축으로 떨어져 있음을 안다', () => {
  // 45° 돌린 정사각형의 꼭짓점이 다른 정사각형 모서리 근처까지만 온다
  const a = makeBox(0, 0, 0, 2, 2);
  const d = 1 + Math.SQRT2 + 0.05; // 꼭짓점 사이가 0.05 떨어진다
  const b = makeBox(d, 0, Math.PI / 4, 2, 2);
  assert.equal(overlap(a, b), null);
  assert.ok(near(gap(a, b), 0.05, 1e-9));
  const c = makeBox(d - 0.1, 0, Math.PI / 4, 2, 2);
  assert.ok(overlap(a, c));
  // 대각선 방향으로 놓여 축 정렬 상자로는 겹쳐 보이지만 실제로는 떨어진 경우
  const e = makeBox(2.1, 2.1, Math.PI / 4, 2, 2);
  assert.equal(overlap(a, e), null);
});

test('차가 장애물에 부딪히면 닿기 직전에 멈추고 겹치지 않는다', () => {
  const car = makeCar({ x: 0, z: 0, heading: N });
  car.speed = 3;
  const wall = { kind: 'wall', box: makeBox(0, -4, E, 6, 0.4) };
  let hit = null;
  for (let i = 0; i < 240 && !hit; i++) hit = stepCar(car, { throttle: 1, steer: 0 }, [wall], STEP);
  assert.ok(hit);
  assert.equal(hit.obstacle, wall);
  assert.ok(hit.speed > 2.5);
  assert.equal(car.speed, 0);
  assert.equal(overlap(carBox(car), wall.box), null);
  assert.ok(gap(carBox(car), wall.box) < 0.05); // 벽에 바짝
  // 벽 쪽으로 계속 밀어도 들어가지 않는다
  for (let i = 0; i < 120; i++) stepCar(car, { throttle: 1, steer: 0 }, [wall], STEP);
  assert.equal(overlap(carBox(car), wall.box), null);
  // 후진하면 떨어진다
  car.gear = 'R';
  for (let i = 0; i < 120; i++) stepCar(car, { throttle: 1, steer: 0 }, [wall], STEP);
  assert.ok(gap(carBox(car), wall.box) > 0.5);
});

// ---------- 주차 판정 ----------

test('칸 안·각도 맞음이면 aligned, 칸 밖이거나 비뚤면 아니다', () => {
  const spot = { x: 0, z: 0, heading: N, width: 2.6, length: 5.2, bothWays: false };
  assert.deepEqual(
    (({ inside, aligned }) => ({ inside, aligned }))(parkStatus({ x: 0, z: 0, heading: N }, spot)),
    { inside: true, aligned: true },
  );
  // 옆으로 빠짐
  assert.equal(parkStatus({ x: 0.6, z: 0, heading: N }, spot).inside, false);
  // 앞으로 빠짐
  assert.equal(parkStatus({ x: 0, z: -0.6, heading: N }, spot).inside, false);
  // 조금 비뚤어도 칸 안이면 각도 차이를 잰다
  const slight = parkStatus({ x: 0, z: 0, heading: N + 0.05 }, spot);
  assert.ok(slight.inside && slight.aligned && near(slight.angle, 0.05, 1e-9));
  // 각도 허용 범위 밖: 넓은 칸이라 차는 칸 안에 들어가도 aligned 가 아니다
  const wide = { ...spot, width: 4, length: 6 };
  const crooked = parkStatus({ x: 0, z: 0, heading: N + ANGLE_TOLERANCE + 0.03 }, wide);
  assert.ok(crooked.inside && !crooked.aligned);
  // 거꾸로 세움: 방향이 정해진 칸은 안 되고, 양쪽을 허용하는 칸은 된다
  assert.equal(parkStatus({ x: 0, z: 0, heading: 0 }, spot).aligned, false);
  assert.equal(parkStatus({ x: 0, z: 0, heading: 0 }, { ...spot, bothWays: true }).aligned, true);
});

test('칸 안에 멈춘 채 PARK_HOLD 초가 지나야 주차 완료다', () => {
  const run = new ParkingRun(emptyLevel({ start: { x: 0, z: -10, heading: N } }));
  drive(run, { throttle: 0, brake: 1, steer: 0 }, PARK_HOLD * 0.5);
  assert.equal(run.status, 'driving');
  assert.ok(run.holdProgress > 0.4 && run.holdProgress < 0.6);
  drive(run, { throttle: 0, brake: 1, steer: 0 }, PARK_HOLD * 0.6);
  assert.equal(run.status, 'parked');
  const events = run.drain().map((e) => e.type);
  assert.ok(events.includes('settling') && events.includes('parked'));
  assert.equal(run.result.contacts, 0);
  assert.equal(run.result.stars, 3);
});

test('움직이는 중이거나 칸을 벗어나면 기다리던 시간이 처음부터', () => {
  const run = new ParkingRun(emptyLevel({ start: { x: 0, z: -8.2, heading: N } }));
  drive(run, { throttle: 0.4, steer: 0 }, 0.6); // 칸 안으로 굴러 들어가는 중
  assert.equal(run.hold, 0);
  drive(run, { brake: 1, steer: 0 }, 0.5);
  assert.equal(run.status, 'driving');
  // 다시 굴러가 칸을 벗어나면 0 으로
  drive(run, { throttle: 1, steer: 0 }, 2);
  drive(run, { brake: 1, steer: 0 }, 0.3);
  assert.equal(parkStatus(run.car, run.spot).inside, false);
  assert.equal(run.hold, 0);
  assert.equal(run.status, 'driving');
});

test('곧게 몰아 칸에 넣으면 주차되고, 처음 방향은 전환으로 세지 않는다', () => {
  const run = new ParkingRun(emptyLevel());
  // 앞으로 가다 칸 가운데 근처에서 브레이크
  for (let i = 0; i < 120 * 20 && run.status === 'driving'; i++) {
    const left = run.spot.z - run.car.z; // 남은 거리 (음수 쪽으로 간다)
    run.update(STEP, left < -0.35 * Math.abs(run.car.speed) - 0.3 ? { throttle: 0.5, steer: 0 } : { brake: 1, steer: 0 });
  }
  assert.equal(run.status, 'parked');
  assert.equal(run.result.switches, 0);
  assert.ok(run.result.offset < 0.5);
});

test('전진하다 후진하면 전환 1번, 같은 장애물에 붙어 밀면 접촉은 1번', () => {
  const run = new ParkingRun(emptyLevel({ walls: [{ x: 0, z: -6, heading: E, length: 6, width: 0.4 }], spot: { x: 20, z: 20, heading: 0, width: 2.6, length: 5.2 } }));
  drive(run, { throttle: 0.5, steer: 0 }, 3); // 벽까지
  assert.equal(run.contacts, 1);
  drive(run, { throttle: 1, steer: 0 }, 1); // 계속 밀기
  assert.equal(run.contacts, 1);
  run.setGear('R');
  drive(run, { throttle: 0.6, steer: 0 }, 1.5);
  assert.equal(run.switches, 1);
  // 떨어졌다가 다시 부딪히면 2번
  run.setGear('D');
  drive(run, { throttle: 0.5, steer: 0 }, 3);
  assert.equal(run.contacts, 2);
  assert.equal(run.switches, 2);
  const types = run.drain().map((e) => e.type);
  assert.equal(types.filter((type) => type === 'contact').length, 2);
  assert.equal(types.filter((type) => type === 'gear').length, 2);
});

test('너무 빠르게 부딪히면 사고로 실패, 접촉 한도를 넘어도 실패', () => {
  const wall = { x: 0, z: -14, heading: E, length: 6, width: 0.4 };
  const fast = new ParkingRun(emptyLevel({ walls: [wall], spot: { x: 20, z: 20, heading: 0, width: 2.6, length: 5.2 } }));
  drive(fast, { throttle: 1, steer: 0 }, 6);
  assert.equal(fast.status, 'failed');
  assert.equal(fast.failReason, 'crash');
  assert.ok(fast.drain().find((e) => e.type === 'contact').speed >= CRASH_SPEED);

  const strict = new ParkingRun(emptyLevel({ walls: [{ ...wall, z: -5 }], maxContacts: 1, spot: { x: 20, z: 20, heading: 0, width: 2.6, length: 5.2 } }));
  const bump = () => {
    strict.setGear('D');
    drive(strict, { throttle: 0.4, steer: 0 }, 2.5);
    strict.setGear('R');
    drive(strict, { throttle: 0.4, steer: 0 }, 1.2);
  };
  bump();
  assert.equal(strict.contacts, 1);
  assert.equal(strict.status, 'driving');
  bump();
  assert.equal(strict.status, 'failed');
  assert.equal(strict.failReason, 'contacts');
});

test('주차 감지기는 가는 쪽 장애물까지의 거리를 잰다', () => {
  const run = new ParkingRun(emptyLevel({ walls: [{ x: 0, z: -3.15 - 0.2, heading: E, length: 6, width: 0.4 }] }));
  // 차 앞 끝은 z = -2.15, 벽은 z = -3.15 부터
  assert.ok(near(run.sensorGap(), 1, 1e-9));
  run.setGear('R');
  assert.equal(run.sensorGap(), Infinity); // 뒤쪽은 비었다
});

// ---------- 평가 ----------

test('평가: 완벽하면 100점 별 3개, 감점마다 줄고 한도가 있다', () => {
  const par = { time: 20, switches: 1 };
  const perfect = evaluate({ time: 12, switches: 0, contacts: 0, offset: 0.05, angle: 0.01 }, par);
  assert.equal(perfect.score, 100);
  assert.equal(perfect.stars, 3);
  const bumped = evaluate({ time: 12, switches: 1, contacts: 2, offset: 0.05, angle: 0 }, par);
  assert.equal(bumped.deductions.contacts, 20);
  assert.equal(bumped.score, 80);
  assert.equal(bumped.stars, 2);
  const slow = evaluate({ time: 200, switches: 9, contacts: 0, offset: 0.9, angle: 0.2 }, par);
  assert.equal(slow.deductions.time, 20);
  assert.equal(slow.deductions.switches, 20);
  assert.equal(slow.deductions.accuracy, 20);
  assert.equal(slow.score, 40);
  assert.equal(slow.stars, 1);
  const late = evaluate({ time: 25, switches: 2, contacts: 0, offset: 0.3, angle: (3 * Math.PI) / 180 }, par);
  assert.equal(late.deductions.time, 2);
  assert.equal(late.deductions.switches, 5);
  assert.equal(late.deductions.accuracy, 8); // 0.2m × 25 + 2° × 1.5
  assert.equal(late.score, 85);
  assert.deepEqual([starsOf(100), starsOf(90), starsOf(89), starsOf(70), starsOf(69), starsOf(0)], [3, 3, 2, 2, 1, 1]);
});

// ---------- 단계 데이터 ----------

test('단계가 12개 이상이고 id 가 겹치지 않으며 필요한 값이 있다', () => {
  assert.ok(LEVELS.length >= 12);
  assert.equal(new Set(LEVELS.map((l) => l.id)).size, LEVELS.length);
  for (const level of LEVELS) {
    assert.ok(level.name.ko && level.name.en && level.tip.ko && level.tip.en, level.id);
    const { spot, par } = level;
    for (const key of ['x', 'z', 'heading', 'width', 'length']) assert.ok(Number.isFinite(spot[key]), `${level.id} spot.${key}`);
    assert.ok(spot.width >= CAR.width + 0.2 && spot.length >= CAR.length + 0.4, level.id);
    assert.ok(par.time > 0 && par.switches >= 0, level.id);
    assert.ok(level.maxContacts === null || Number.isInteger(level.maxContacts), level.id);
  }
  // 운전면허 기능시험 모티브 단계가 들어 있다
  assert.ok(LEVELS.some((l) => l.id === 'test-t') && LEVELS.some((l) => l.id === 'test-parallel'));
});

test('출발 자리는 장애물과 겹치지 않고, 목표 칸은 비어 있으며 경계 안에 있다', () => {
  for (const level of LEVELS) {
    const obstacles = buildObstacles(level);
    for (const o of obstacles) assert.equal(overlap(carBox(level.start), o.box), null, `${level.id}: 출발 자리가 ${o.kind} 와 겹침`);
    // 칸 가장자리가 연석·기둥에 딱 맞닿은 곳이 있어 아주 조금 줄여 본다
    const inner = { ...level.spot, width: level.spot.width - 0.02, length: level.spot.length - 0.02 };
    for (const o of obstacles) assert.equal(overlap(spotBox(inner), o.box), null, `${level.id}: 목표 칸에 ${o.kind}`);
    const { minX, maxX, minZ, maxZ } = level.bounds;
    for (const p of corners(spotBox(level.spot))) assert.ok(p.x > minX && p.x < maxX && p.z > minZ && p.z < maxZ, level.id);
    // 처음부터 주차된 상태는 아니다
    assert.equal(parkStatus(level.start, level.spot).inside, false, level.id);
  }
});

test('세워 둔 차끼리, 차와 기둥·벽이 서로 겹치지 않는다', () => {
  for (const level of LEVELS) {
    const solid = buildObstacles(level).filter((o) => o.kind === 'car' || o.kind === 'pillar' || o.kind === 'cone');
    for (let i = 0; i < solid.length; i++) {
      for (let j = i + 1; j < solid.length; j++) {
        assert.equal(overlap(solid[i].box, solid[j].box), null, `${level.id}: ${solid[i].kind} ${i} 와 ${solid[j].kind} ${j}`);
      }
    }
  }
});

test('모든 단계를 경로 탐색으로 풀 수 있다', () => {
  for (const level of LEVELS) {
    const result = solve(level);
    assert.ok(result, `${level.id} 를 풀지 못함`);
    // 찾은 길의 모든 자리가 장애물과 겹치지 않는다
    const obstacles = buildObstacles(level);
    for (const pose of result.path) {
      for (const o of obstacles) assert.equal(overlap(carBox(pose), o.box), null, level.id);
    }
    assert.ok(parkStatus(result.path.at(-1), level.spot).aligned, level.id);
  }
});

// ---------- 저장 ----------

test('저장: 더 좋은 기록만 남기고, 앞 단계를 깨야 다음 단계가 열린다', () => {
  const ids = LEVELS.map((l) => l.id);
  const store = new SaveStore(memoryStorage(), ids);
  assert.equal(store.unlocked(ids[0]), true);
  assert.equal(store.unlocked(ids[1]), false);
  const a = { score: 80, stars: 2, time: 30.04, switches: 2, contacts: 1 };
  const first = store.record(ids[0], a);
  assert.deepEqual([first.first, first.improved], [true, true]);
  assert.equal(store.loadBest(ids[0]).time, 30);
  assert.equal(store.unlocked(ids[1]), true);
  const worse = store.record(ids[0], { ...a, score: 70 });
  assert.equal(worse.improved, false);
  assert.equal(store.loadBest(ids[0]).score, 80);
  const faster = store.record(ids[0], { ...a, time: 20 });
  assert.equal(faster.improved, true);
  assert.equal(store.totalStars(), 2);
  assert.equal(store.nextUnsolved(), ids[1]);
  assert.equal(better({ score: 90, time: 50 }, { score: 80, time: 10 }), true);
  assert.equal(better({ score: 80, time: 50 }, { score: 80, time: 10 }), false);
});

test('저장: 깨진 데이터와 모르는 단계는 버리고, 설정은 검증한다', () => {
  const ids = LEVELS.map((l) => l.id);
  const storage = memoryStorage({
    [PROGRESS_KEY]: JSON.stringify({
      best: { [ids[0]]: { score: 101, stars: 3, time: 1, switches: 0, contacts: 0 }, [ids[1]]: { score: 90, stars: 3, time: 12, switches: 0, contacts: 0 }, gone: {} },
      last: 'gone',
    }),
    [SETTINGS_KEY]: JSON.stringify({ camera: 'drone', guide: false, sound: 'yes' }),
  });
  const store = new SaveStore(storage, ids);
  const data = store.load();
  assert.deepEqual(Object.keys(data.best), [ids[1]]);
  assert.equal(data.last, null);
  assert.deepEqual(store.loadSettings(), { camera: DEFAULT_SETTINGS.camera, guide: false, sound: true });
  assert.deepEqual(validateSettings(null), DEFAULT_SETTINGS);
  const broken = new SaveStore(memoryStorage({ [PROGRESS_KEY]: '{oops' }), ids);
  assert.deepEqual(broken.load(), { best: {}, last: null });
  const blocked = new SaveStore(
    {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {},
    },
    ids,
  );
  assert.equal(blocked.record(ids[0], { score: 90, stars: 3, time: 10, switches: 0, contacts: 0 }).first, true);
});

// ---------- 조작 ----------

test('핸들 각도 차이는 가까운 쪽으로 잰다', () => {
  assert.ok(near(wheelDelta(3, -3), 2 * Math.PI - 6, 1e-12));
  assert.ok(near(wheelDelta(-3, 3), -(2 * Math.PI - 6), 1e-12));
  assert.ok(near(wheelDelta(0.2, 0.5), 0.3, 1e-12));
});

test('화면 핸들: 돌린 만큼 꺾이고, 끝에서 멈추며, 놓아도 그대로다', () => {
  const driver = new Driver();
  // 핸들 위쪽(12시)을 잡고 시계 방향으로 3시까지 = 90°
  driver.grabWheel(1, 0, -60);
  driver.turnWheel(1, 42, -42);
  driver.turnWheel(1, 60, 0);
  assert.ok(near(driver.steer, Math.PI / 2 / WHEEL_TURN, 1e-9));
  driver.dropWheel(1);
  for (let i = 0; i < 60; i++) driver.update(1 / 60);
  assert.ok(near(driver.steer, Math.PI / 2 / WHEEL_TURN, 1e-9)); // 그대로
  // 계속 돌려 한 바퀴 넘게 감아도 1 에서 멈추고, 되돌리면 바로 풀린다
  driver.grabWheel(2, 60, 0);
  const around = [
    [0, 60],
    [-60, 0],
    [0, -60],
    [60, 0],
    [0, 60],
    [-60, 0],
  ];
  for (const [x, y] of around) driver.turnWheel(2, x, y);
  assert.equal(driver.steer, 1);
  driver.turnWheel(2, 0, 60); // 반시계로 90°
  assert.ok(near(driver.steer, 1 - Math.PI / 2 / WHEEL_TURN, 1e-9));
  driver.dropWheel(2);
});

test('화면 핸들을 두 번 톡 치면 가운데로 돌아온다', () => {
  const driver = new Driver();
  driver.steer = 0.8;
  driver.grabWheel(1, 0, -60);
  driver.dropWheel(1);
  driver.update(0.1);
  driver.grabWheel(2, 0, -60);
  driver.dropWheel(2);
  for (let i = 0; i < 60; i++) driver.update(1 / 60);
  assert.equal(driver.steer, 0);
});

test('키보드: 누르는 동안 꺾이고 놓으면 가운데로, 가속은 점점 깊게, ↑↓ 는 기어를 고른다', () => {
  const driver = new Driver();
  assert.equal(KEYS.ArrowRight, 'right');
  driver.key('right', true);
  for (let i = 0; i < 120; i++) driver.update(1 / 60);
  assert.equal(driver.steer, 1);
  driver.key('right', false);
  for (let i = 0; i < 60; i++) driver.update(1 / 60);
  assert.equal(driver.steer, 0);
  assert.equal(driver.key('gas', true), 'D');
  const firstInput = driver.update(1 / 60);
  assert.ok(firstInput.throttle >= GAS_START && firstInput.throttle < 0.4);
  for (let i = 0; i < 120; i++) driver.update(1 / 60);
  assert.equal(driver.update(1 / 60).throttle, 1);
  driver.gentle = true;
  assert.ok(driver.update(1 / 60).throttle <= 0.4);
  driver.key('gas', false);
  assert.equal(driver.key('reverse', true), 'R');
  driver.key('reverse', false);
  driver.key('brake', true);
  assert.equal(driver.update(1 / 60).brake, 1);
  driver.release();
  assert.equal(driver.update(1 / 60).brake, 0);
});
