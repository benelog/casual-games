// 주차 게임의 차량 운동과 충돌. 화면(Three.js)과 상관없는 순수 계산이라 node 에서 그대로 테스트한다.
//
// 길이 단위는 미터, 바닥은 x·z 평면이다 (three.js 처럼 y 가 위쪽). 위에서 내려다보면 x 는 오른쪽, z 는 아래쪽(화면 앞쪽)이다.
// 차의 방향 heading 은 앞쪽이 (sin h, cos h) 가 되는 각도다. 0 이 +z(남쪽), π 가 -z(북쪽), π/2 가 +x(동쪽).
// three.js 모델은 앞이 +z 이므로 rotation.y = heading 이면 그대로 맞는다.
//
// 차는 자전거 모델로 움직인다: 뒤축 가운데가 앞쪽으로 나아가고, 앞바퀴를 꺾은 각도 δ 만큼
// 뒤축이 반지름 R = 축간거리 / tan δ 인 원을 그린다. 조향은 +1 이 오른쪽, -1 이 왼쪽이다.
// 충돌은 차체와 장애물을 모두 방향 있는 사각형(OBB)으로 보고 분리축 정리로 판정한다.

/** 내 차 (Kenney Car Kit 의 sedan 모델을 이 크기로 늘여 그린다) */
export const CAR = {
  length: 4.3,
  width: 1.85,
  wheelbase: 2.23, // 앞뒤 바퀴 축 사이
  rearAxle: 1.07, // 차 가운데에서 뒤축까지
  maxSteer: 0.55, // 앞바퀴를 꺾을 수 있는 가장 큰 각도 (라디안, 약 31.5°)
};

/** 주차된 차의 모델별 크기 (m). 화면에서도 모델을 이 크기로 맞춰 그리므로 보이는 대로 부딪힌다 */
export const VEHICLES = {
  sedan: { length: 4.3, width: 1.85 },
  suv: { length: 4.35, width: 1.9 },
  taxi: { length: 4.6, width: 1.85 },
  van: { length: 4.7, width: 1.9 },
  'hatchback-sports': { length: 4.5, width: 1.75 },
};

export const STEP = 1 / 120; // 고정 시간 간격 (초)
export const ACCEL = 2.4; // 가속 페달을 끝까지 밟았을 때의 가속도 (m/s²)
export const MAX_FORWARD = 4.5; // 전진 최고 속도 (m/s, 약 16 km/h) — 주차장 안이라 느리게
export const MAX_REVERSE = 2.5; // 후진 최고 속도 (m/s, 9 km/h)
export const BRAKE = 7; // 브레이크를 끝까지 밟았을 때의 감속도
export const COAST = 1.1; // 페달에서 발을 떼면 엔진 브레이크로 이만큼 느려진다
export const STEER_RATE = 4; // 앞바퀴가 핸들을 따라가는 빠르기 (조향 값/초, -1~1 을 반 초에)
export const STOPPED = 0.05; // 이보다 느리면 멈춘 것으로 본다 (m/s)

const TAU = Math.PI * 2;

/** 각도를 -π ~ π 로 */
export function wrapAngle(a) {
  return a - TAU * Math.floor((a + Math.PI) / TAU);
}

/** 앞쪽 단위 벡터 */
export const forward = (heading) => ({ x: Math.sin(heading), z: Math.cos(heading) });

const toward = (value, target, step) => (value < target ? Math.min(target, value + step) : Math.max(target, value - step));

/** 출발 자리에서 멈춰 있는 차 */
export function makeCar({ x, z, heading }) {
  return { x, z, heading, speed: 0, steer: 0, gear: 'D' };
}

/** 조향 값(-1~1) → 앞바퀴 각도(라디안) */
export const steerAngle = (steer) => steer * CAR.maxSteer;

/** 조향 값으로 뒤축이 그리는 원의 반지름 (직진이면 Infinity) */
export function turnRadius(steer) {
  const t = Math.tan(Math.abs(steerAngle(steer)));
  return t < 1e-9 ? Infinity : CAR.wheelbase / t;
}

/**
 * 차를 앞쪽으로 ds 미터(음수면 뒤로) 옮긴다. 조향 값 steer 로 뒤축이 원호를 그린다. 새 { x, z, heading } 를 돌려준다.
 * 게임의 운동과 경로 탐색(solver.js)이 같이 쓴다.
 */
export function advance(pose, ds, steer) {
  const { rearAxle, wheelbase } = CAR;
  const f = forward(pose.heading);
  const rx = pose.x - f.x * rearAxle;
  const rz = pose.z - f.z * rearAxle;
  // 오른쪽으로 꺾으면 (위에서 보아) 시계 방향으로 돈다
  const turn = (-ds * Math.tan(steerAngle(steer))) / wheelbase;
  const mid = pose.heading + turn / 2;
  // 원호의 현: 길이 2R sin(θ/2), 방향은 중간 각도
  const chord = Math.abs(turn) > 1e-9 ? (ds * Math.sin(turn / 2)) / (turn / 2) : ds;
  const heading = wrapAngle(pose.heading + turn);
  const g = forward(heading);
  const nx = rx + Math.sin(mid) * chord;
  const nz = rz + Math.cos(mid) * chord;
  return { x: nx + g.x * rearAxle, z: nz + g.z * rearAxle, heading };
}

/**
 * 속도를 페달에 맞춘다. input: { throttle 0~1, brake 0~1 }, 기어는 car.gear ('D' | 'R').
 * 가속 페달을 밟은 깊이가 낼 속도를 정한다 (끝까지 밟으면 최고 속도, 살짝 밟으면 기어가듯 천천히).
 * 기어 방향으로 밀고, 반대 방향으로 굴러가는 중이면 먼저 멈춰 세운다.
 */
export function updateSpeed(car, { throttle = 0, brake = 0 }, dt) {
  const dir = car.gear === 'R' ? -1 : 1;
  const max = dir > 0 ? MAX_FORWARD : MAX_REVERSE;
  let v = car.speed;
  if (throttle > 0 && v * dir >= -STOPPED) {
    const along = Math.max(0, v * dir);
    const target = max * Math.min(1, throttle);
    // 낼 속도보다 느리면 붙이고, 빠르면(페달을 덜 밟았으면) 엔진 브레이크로 줄인다
    const next = along < target ? Math.min(target, along + ACCEL * dt) : Math.max(target, along - COAST * dt);
    v = dir * next;
  } else if (throttle > 0) {
    v = toward(v, 0, BRAKE * 0.6 * throttle * dt);
  } else {
    v = toward(v, 0, COAST * dt);
  }
  if (brake > 0) v = toward(v, 0, BRAKE * brake * dt);
  car.speed = v;
}

// ---------- 방향 있는 사각형 (OBB) ----------

/**
 * 가운데 (x, z), 방향 heading, 길이(앞뒤)·너비(좌우)의 사각형.
 * u 는 길이 방향, v 는 너비 방향 단위 벡터다.
 */
export function makeBox(x, z, heading, length, width) {
  const s = Math.sin(heading);
  const c = Math.cos(heading);
  return { x, z, heading, hl: length / 2, hw: width / 2, u: { x: s, z: c }, v: { x: c, z: -s }, r: Math.hypot(length, width) / 2 };
}

/** 차의 차체 사각형 */
export const carBox = (car, margin = 0) => makeBox(car.x, car.z, car.heading, CAR.length + margin * 2, CAR.width + margin * 2);

/** 네 꼭짓점 (앞오른쪽부터 돌아가며) */
export function corners(box) {
  const { x, z, u, v, hl, hw } = box;
  return [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ].map(([a, b]) => ({ x: x + u.x * hl * a + v.x * hw * b, z: z + u.z * hl * a + v.z * hw * b }));
}

/** 사각형을 축 axis 에 투영한 반지름 */
const radiusOn = (box, axis) =>
  box.hl * Math.abs(box.u.x * axis.x + box.u.z * axis.z) + box.hw * Math.abs(box.v.x * axis.x + box.v.z * axis.z);

/**
 * 두 사각형이 겹치는지 분리축 정리로 본다. 겹치면 가장 얕게 겹친 축의 { depth, normal } 을,
 * 아니면 null 을 돌려준다. normal 은 b 에서 a 쪽을 향한다.
 */
export function overlap(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  if (dx * dx + dz * dz > (a.r + b.r) ** 2) return null;
  let best = null;
  for (const axis of [a.u, a.v, b.u, b.v]) {
    const distance = dx * axis.x + dz * axis.z;
    const depth = radiusOn(a, axis) + radiusOn(b, axis) - Math.abs(distance);
    if (depth <= 0) return null;
    if (!best || depth < best.depth) {
      const sign = distance < 0 ? -1 : 1;
      best = { depth, normal: { x: axis.x * sign, z: axis.z * sign } };
    }
  }
  return best;
}

/** 점 p 가 사각형 안에 있는지 (가장자리에서 tolerance 만큼 밖까지 봐준다) */
export function containsPoint(box, p, tolerance = 0) {
  const dx = p.x - box.x;
  const dz = p.z - box.z;
  return (
    Math.abs(dx * box.u.x + dz * box.u.z) <= box.hl + tolerance && Math.abs(dx * box.v.x + dz * box.v.z) <= box.hw + tolerance
  );
}

function segmentDistance(p, a, b) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / (abx * abx + abz * abz)));
  return Math.hypot(p.x - a.x - abx * t, p.z - a.z - abz * t);
}

/** 겹치지 않은 두 사각형 사이의 가장 가까운 거리 (겹치면 0) */
export function gap(a, b) {
  if (overlap(a, b)) return 0;
  const ca = corners(a);
  const cb = corners(b);
  let best = Infinity;
  for (const [points, poly] of [
    [ca, cb],
    [cb, ca],
  ]) {
    for (const p of points) {
      for (let i = 0; i < 4; i++) best = Math.min(best, segmentDistance(p, poly[i], poly[(i + 1) % 4]));
    }
  }
  return best;
}

/** 사각형 box 와 겹치는 첫 장애물 (없으면 null). 장애물마다 { box } 를 가진다 */
export function firstHit(box, obstacles) {
  for (const obstacle of obstacles) {
    const hit = overlap(box, obstacle.box);
    if (hit) return { obstacle, ...hit };
  }
  return null;
}

/**
 * 차를 dt 초 움직인다. input: { throttle, brake, steer(-1~1) }.
 * 장애물에 부딪히면 닿기 직전 자리에 세우고 { obstacle, speed, normal } 을, 아니면 null 을 돌려준다.
 */
export function stepCar(car, input, obstacles, dt = STEP) {
  car.steer = toward(car.steer, Math.max(-1, Math.min(1, input.steer ?? 0)), STEER_RATE * dt);
  updateSpeed(car, input, dt);
  const ds = car.speed * dt;
  if (ds === 0) return null;
  const next = advance(car, ds, car.steer);
  const hit = firstHit(carBox(next), obstacles);
  if (!hit) {
    Object.assign(car, next);
    return null;
  }
  // 닿기 직전까지 반씩 줄여 가며 다가간다
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) / 2;
    if (firstHit(carBox(advance(car, ds * mid, car.steer)), obstacles)) hi = mid;
    else lo = mid;
  }
  if (lo > 0) Object.assign(car, advance(car, ds * lo, car.steer));
  const speed = Math.abs(car.speed);
  car.speed = 0;
  return { obstacle: hit.obstacle, speed, normal: hit.normal };
}
