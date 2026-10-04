// 농구공의 움직임. Three.js 없이 계산하는 순수 로직이라 node 에서 그대로 테스트한다.
//
// 좌표: 길이 단위는 미터. 원점은 림 한가운데 바로 아래 바닥, y 는 위(+), z 는 던지는 사람 쪽(+),
// x 는 던지는 사람이 골대를 볼 때 오른쪽(+)이다. 림 높이·지름, 백보드 크기와 자리는 FIBA 규격을 따른다.
//
// 공은 속이 빈 공(관성 모멘트 2/3·m·r²)으로 보고 중력만 받아 날아간다(공기 저항·마그누스 힘은 무시).
// 바닥·백보드·림에 닿으면 같은 충돌 함수가 반발(법선 방향)과 마찰(접선 방향)을 함께 계산해,
// 미끄러지는 만큼 회전이 붙고 회전이 다시 튀는 방향을 바꾼다. 림은 굵기가 있는 원환(토러스)이라
// 앞 림을 맞고 튀거나, 림 위를 구르다 안으로 떨어지기도 한다.

export const G = 9.81;
export const BALL_RADIUS = 0.12; // 7호 공 (둘레 약 75cm)
export const RIM_Y = 3.05;
export const RIM_INNER = 0.2286; // 림 안쪽 반지름 (지름 45.7cm)
export const RIM_TUBE = 0.011; // 림 쇠막대 반지름
export const RIM_RADIUS = RIM_INNER + RIM_TUBE; // 쇠막대 중심선의 반지름
export const BOARD_Z = -(0.151 + RIM_INNER); // 백보드 앞면 (림 안쪽 끝에서 15.1cm 뒤)
export const BOARD_THICK = 0.05;
export const BOARD_HALF_W = 0.915; // 폭 1.83m
export const BOARD_BOTTOM = 2.9;
export const BOARD_TOP = BOARD_BOTTOM + 1.05;
export const NET_DEPTH = 0.4; // 그물 길이
export const NET_BOTTOM = 0.19; // 그물 아래쪽 반지름 (위쪽은 림 안쪽)

export const RELEASE_BACK = 0.4; // 공을 놓는 자리: 서 있는 자리에서 골대 반대쪽으로 이만큼
export const RELEASE_Y = 1.5; // 공을 놓는 높이 (화면 아래 가운데에서 날아오르게)
export const ENTRY = (46 * Math.PI) / 180; // 알맞은 세기로 던졌을 때 림에 들어가는 각도
export const BACKSPIN = 3 * 2 * Math.PI; // 초당 3바퀴 역회전

const RESTITUTION = { floor: 0.78, board: 0.7, rim: 0.55 };
const FRICTION = { floor: 0.5, board: 0.15, rim: 0.3 };
const RESTING = 0.25; // 법선 방향으로 이보다 느리면 튀지 않고 붙어 구른다
const ROLLING = 0.4; // 바닥에서 굴러갈 때의 감속 (m/s²)
const SPIN_INERTIA = (2 / 3) * BALL_RADIUS * BALL_RADIUS; // 질량 1 당 관성 모멘트
const LOUD = 0.35; // 이보다 세게 부딪혀야 소리 사건을 낸다
const SHOT_TIMEOUT = 6; // 이만큼 지나도 결과가 안 나면(림 위에 얹혔다든가) 실패로 친다

export const STEP = 1 / 600; // 물리 한 걸음 (초)

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// ---------- 슛 ----------

/** 서 있는 자리. distance: 림 중심에서 바닥 위 거리, angle: 정면(0)에서 오른쪽(+)으로 돈 각도 */
export function spotPosition(distance, angle) {
  return { x: distance * Math.sin(angle), z: distance * Math.cos(angle) };
}

/** 공을 놓는 점 */
export function releasePoint(distance, angle) {
  const { x, z } = spotPosition(distance + RELEASE_BACK, angle);
  return { x, y: RELEASE_Y, z };
}

/**
 * 수평 거리 d, 높이 차 h 인 곳에 ENTRY 각도로 내려꽂히게 하는 발사각.
 * 포물선에서 tan(들어가는 각) = tan(발사각) - 2h/d 이다.
 */
export function launchElevation(d, h) {
  return Math.atan(Math.tan(ENTRY) + (2 * h) / d);
}

/**
 * 높이 차 h 만큼 위, 수평 거리 d 에 있는 곳에 발사각 elevation 으로 던져 닿게 하는 속력.
 * 그 각으로는 닿을 수 없으면 NaN.
 */
export function idealSpeed(d, h, elevation = launchElevation(d, h)) {
  const c = Math.cos(elevation);
  const lift = d * Math.tan(elevation) - h;
  if (lift <= 0) return NaN;
  return Math.sqrt((G * d * d) / (2 * c * c * lift));
}

export const SWIPE_FULL = 0.45; // 화면 높이의 이만큼 끌어올리면 세기 100%
export const SWIPE_MIN = 0.06; // 이보다 짧게 끌면 던지지 않는다
export const YAW_GAIN = 0.3; // 끈 방향의 기울기 → 좌우 방향
export const YAW_LIMIT = 0.3;
export const SPEED_LOW = 0.9; // 세기 0% 일 때 알맞은 속력의 배수
export const SPEED_SPAN = 0.2; // 세기 0% → 100% 동안 더하는 배수 (50% 가 딱 알맞다)

/**
 * 스와이프(누른 곳 → 뗀 곳, 화면 픽셀) 를 세기·방향으로 바꾼다. 위로 충분히 끌지 않았으면 null.
 * height 는 화면 높이(px). power 는 0~1, yaw 는 라디안(+ 오른쪽).
 */
export function swipeToShot(dx, dy, height) {
  const up = -dy;
  if (!(height > 0) || up < SWIPE_MIN * height) return null;
  return {
    power: clamp(up / (SWIPE_FULL * height), 0, 1),
    yaw: clamp(Math.atan2(dx, up) * YAW_GAIN, -YAW_LIMIT, YAW_LIMIT),
  };
}

/**
 * 서 있는 자리(distance, angle)에서 세기 power(0~1)·방향 yaw 로 던진 공의 처음 상태.
 */
export function launch(distance, angle, { power, yaw = 0 }) {
  const from = releasePoint(distance, angle);
  const d = Math.hypot(from.x, from.z);
  const elevation = launchElevation(d, RIM_Y - from.y);
  const speed = idealSpeed(d, RIM_Y - from.y, elevation) * (SPEED_LOW + SPEED_SPAN * clamp(power, 0, 1));
  const heading = Math.atan2(-from.x, -from.z) + yaw; // 수평으로 향하는 방향 (x = sin, z = cos)
  const h = speed * Math.cos(elevation);
  const vx = h * Math.sin(heading);
  const vz = h * Math.cos(heading);
  // 역회전: 공 윗면이 진행 방향의 반대로 돈다. 회전축 = 진행 방향 × 위쪽
  const ax = -Math.cos(heading);
  const az = Math.sin(heading);
  return makeBall(from, { x: vx, y: speed * Math.sin(elevation), z: vz }, { x: ax * BACKSPIN, y: 0, z: az * BACKSPIN });
}

let nextId = 1;

/** 공 하나. live 인 동안은 득점 판정을 하고, 결과(result: 'make' | 'miss')가 나면 그 뒤로는 굴러다니기만 한다 */
export function makeBall(p, v = { x: 0, y: 0, z: 0 }, w = { x: 0, y: 0, z: 0 }) {
  return {
    id: nextId++,
    x: p.x,
    y: p.y,
    z: p.z,
    vx: v.x,
    vy: v.y,
    vz: v.z,
    wx: w.x,
    wy: w.y,
    wz: w.z,
    // 회전한 자세 (사원수 x, y, z, w). 화면에 그릴 때 쓴다
    q: [0, 0, 0, 1],
    time: 0,
    live: true,
    result: null,
    touchedRim: false,
    touchedBoard: false,
    fromBelow: false, // 림 아래에서 위로 올라간 적이 있으면 그대로 내려와도 득점이 아니다
    inNet: false,
    resting: false,
  };
}

// ---------- 충돌 ----------

/**
 * 공과 면의 충돌. n: 면에서 공 중심 쪽 단위 법선, depth: 겹친 깊이, kind: 재질.
 * 부딪힌 세기(법선 방향 속력)를 돌려준다
 */
function collide(ball, n, depth, kind) {
  // 겹친 만큼 밀어낸다
  ball.x += n.x * depth;
  ball.y += n.y * depth;
  ball.z += n.z * depth;
  const R = BALL_RADIUS;
  // 접점 r = -n·R 에서의 속도 = v + ω × r
  const rx = -n.x * R;
  const ry = -n.y * R;
  const rz = -n.z * R;
  const cx = ball.vx + (ball.wy * rz - ball.wz * ry);
  const cy = ball.vy + (ball.wz * rx - ball.wx * rz);
  const cz = ball.vz + (ball.wx * ry - ball.wy * rx);
  const vn = cx * n.x + cy * n.y + cz * n.z;
  if (vn >= 0) return 0;
  const e = -vn < RESTING ? 0 : RESTITUTION[kind];
  const jn = -(1 + e) * vn;
  // 접선 방향: 미끄러짐을 멈출 만큼 (속이 빈 공은 접선 충격의 2.5 배만큼 접점 속도가 바뀐다), 최대 μ·jn
  let tx = cx - vn * n.x;
  let ty = cy - vn * n.y;
  let tz = cz - vn * n.z;
  const slip = Math.hypot(tx, ty, tz);
  let jt = 0;
  if (slip > 1e-9) {
    jt = Math.min(slip / (1 + (R * R) / SPIN_INERTIA), FRICTION[kind] * jn);
    tx /= slip;
    ty /= slip;
    tz /= slip;
  }
  const jx = n.x * jn - tx * jt;
  const jy = n.y * jn - ty * jt;
  const jz = n.z * jn - tz * jt;
  ball.vx += jx;
  ball.vy += jy;
  ball.vz += jz;
  // ω += (r × J_t) / I
  const ftx = -tx * jt;
  const fty = -ty * jt;
  const ftz = -tz * jt;
  ball.wx += (ry * ftz - rz * fty) / SPIN_INERTIA;
  ball.wy += (rz * ftx - rx * ftz) / SPIN_INERTIA;
  ball.wz += (rx * fty - ry * ftx) / SPIN_INERTIA;
  return -vn;
}

/** 축에 나란한 상자와의 충돌. 겹쳤으면 { n, depth } */
function boxContact(ball, min, max) {
  const px = clamp(ball.x, min.x, max.x);
  const py = clamp(ball.y, min.y, max.y);
  const pz = clamp(ball.z, min.z, max.z);
  let dx = ball.x - px;
  let dy = ball.y - py;
  let dz = ball.z - pz;
  const dist = Math.hypot(dx, dy, dz);
  if (dist >= BALL_RADIUS) return null;
  if (dist < 1e-9) {
    // 중심이 상자 안: 앞면(+z) 으로 밀어낸다
    return { n: { x: 0, y: 0, z: 1 }, depth: BALL_RADIUS + (max.z - ball.z) };
  }
  return { n: { x: dx / dist, y: dy / dist, z: dz / dist }, depth: BALL_RADIUS - dist };
}

/** 림(원환)과의 충돌. 공 중심에서 가장 가까운 쇠막대 중심선 위의 점을 찾는다 */
export function rimContact(ball) {
  const h = Math.hypot(ball.x, ball.z);
  const ux = h > 1e-9 ? ball.x / h : 1;
  const uz = h > 1e-9 ? ball.z / h : 0;
  const qx = ux * RIM_RADIUS;
  const qz = uz * RIM_RADIUS;
  const ex = ball.x - qx;
  const ey = ball.y - RIM_Y;
  const ez = ball.z - qz;
  const dist = Math.hypot(ex, ey, ez);
  const reach = BALL_RADIUS + RIM_TUBE;
  if (dist >= reach || dist < 1e-9) return null;
  return { n: { x: ex / dist, y: ey / dist, z: ez / dist }, depth: reach - dist };
}

/** 그물의 반지름 (림 아래 깊이 depth 에서) */
export const netRadius = (depth) => RIM_INNER + (NET_BOTTOM - RIM_INNER) * clamp(depth / NET_DEPTH, 0, 1);

/** 사원수 q 를 각속도 w 로 dt 만큼 돌린다 */
function spinQuat(q, wx, wy, wz, dt) {
  const angle = Math.hypot(wx, wy, wz) * dt;
  if (angle < 1e-9) return;
  const s = Math.sin(angle / 2) / (angle / dt);
  const ax = wx * s;
  const ay = wy * s;
  const az = wz * s;
  const aw = Math.cos(angle / 2);
  const [bx, by, bz, bw] = q;
  q[0] = aw * bx + ax * bw + ay * bz - az * by;
  q[1] = aw * by - ax * bz + ay * bw + az * bx;
  q[2] = aw * bz + ax * by - ay * bx + az * bw;
  q[3] = aw * bw - ax * bx - ay * by - az * bz;
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  for (let i = 0; i < 4; i++) q[i] /= len;
}

// ---------- 세계 ----------

/**
 * 코트 위의 공들과 골대. step(dt) 로 움직이고, 일어난 일은 events 에 쌓는다:
 *   { type: 'floor' | 'board' | 'rim', ball, speed }  부딪힘 (소리를 낼 만큼 셀 때)
 *   { type: 'score', ball, clean, bank }  림 안을 위에서 아래로 지났다 (clean: 림·백보드에 안 닿음, bank: 백보드 맞고)
 *   { type: 'net', ball, speed }  그물을 지나며 흔든다
 *   { type: 'miss', ball }  바닥에 먼저 닿았거나 시간이 다 되었다
 */
export class Court {
  constructor() {
    this.balls = [];
    this.events = [];
    this.carry = 0;
  }

  add(ball) {
    this.balls.push(ball);
    return ball;
  }

  remove(ball) {
    this.balls = this.balls.filter((b) => b !== ball);
  }

  drain() {
    const events = this.events;
    this.events = [];
    return events;
  }

  /** 실제 시간 dt 만큼 진행한다 (작은 걸음으로 나눠서) */
  step(dt) {
    this.carry += dt;
    while (this.carry >= STEP) {
      this.carry -= STEP;
      for (const ball of this.balls) if (!ball.resting) this.stepBall(ball, STEP);
    }
  }

  stepBall(ball, dt) {
    const prevY = ball.y;
    ball.vy -= G * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.z += ball.vz * dt;
    ball.time += dt;
    spinQuat(ball.q, ball.wx, ball.wy, ball.wz, dt);

    // 득점 판정: 공 중심이 림 높이를 위에서 아래로, 림 안쪽으로 지났다
    const h = Math.hypot(ball.x, ball.z);
    if (h < RIM_RADIUS) {
      if (prevY < RIM_Y && ball.y >= RIM_Y) ball.fromBelow = true;
      if (prevY >= RIM_Y && ball.y < RIM_Y) {
        if (ball.live && !ball.fromBelow && !ball.result) {
          ball.result = 'make';
          const clean = !ball.touchedRim && !ball.touchedBoard;
          this.events.push({ type: 'score', ball, clean, bank: ball.touchedBoard });
        }
        if (!ball.fromBelow) {
          ball.inNet = true;
          this.events.push({ type: 'net', ball, speed: Math.hypot(ball.vx, ball.vy, ball.vz) });
        }
      }
    } else if (h > RIM_RADIUS + BALL_RADIUS) {
      ball.fromBelow = false;
    }

    // 그물: 림을 지난 공을 부드럽게 붙잡아 가운데로 모으고 늦춘다
    if (ball.inNet) {
      const depth = RIM_Y - ball.y;
      if (depth > NET_DEPTH + BALL_RADIUS || depth < -BALL_RADIUS) ball.inNet = false;
      else if (depth > 0) {
        const room = netRadius(depth) - BALL_RADIUS * 0.55;
        const hh = Math.hypot(ball.x, ball.z);
        if (hh > room && hh > 1e-9) {
          // 그물이 늘어난 만큼 안쪽으로 당기는 용수철
          const pull = (hh - room) * 900 * dt;
          ball.vx -= (ball.x / hh) * pull;
          ball.vz -= (ball.z / hh) * pull;
        }
        const k = Math.exp(-3.5 * dt);
        ball.vx *= k;
        ball.vz *= k;
        ball.vy *= Math.exp(-1.6 * dt);
      }
    }

    // 백보드 (두께가 있는 판)
    const board = boxContact(
      ball,
      { x: -BOARD_HALF_W, y: BOARD_BOTTOM, z: BOARD_Z - BOARD_THICK },
      { x: BOARD_HALF_W, y: BOARD_TOP, z: BOARD_Z },
    );
    if (board) {
      const speed = collide(ball, board.n, board.depth, 'board');
      if (speed > 0.05) ball.touchedBoard = true;
      if (speed > LOUD) this.events.push({ type: 'board', ball, speed });
    }

    // 림
    const rim = rimContact(ball);
    if (rim) {
      const speed = collide(ball, rim.n, rim.depth, 'rim');
      if (speed > 0.05) ball.touchedRim = true;
      if (speed > LOUD * 0.6) this.events.push({ type: 'rim', ball, speed });
    }

    // 바닥
    if (ball.y < BALL_RADIUS) {
      const speed = collide(ball, { x: 0, y: 1, z: 0 }, BALL_RADIUS - ball.y, 'floor');
      if (speed > LOUD) this.events.push({ type: 'floor', ball, speed });
      if (ball.live && !ball.result) this.resolveMiss(ball);
      // 구르는 중이면 천천히 멈춘다
      if (Math.abs(ball.vy) < 0.05) {
        const v = Math.hypot(ball.vx, ball.vz);
        if (v > 1e-6) {
          const k = Math.max(0, v - ROLLING * dt) / v;
          ball.vx *= k;
          ball.vz *= k;
          ball.wx *= k;
          ball.wz *= k;
        }
        ball.wy *= Math.exp(-2 * dt);
        if (v < 0.02) ball.resting = true;
      }
    }

    if (ball.live && !ball.result && ball.time > SHOT_TIMEOUT) this.resolveMiss(ball);
  }

  resolveMiss(ball) {
    ball.result = 'miss';
    this.events.push({ type: 'miss', ball });
  }
}

/**
 * 공 하나를 결과가 날 때까지(또는 limit 초) 굴려 본다. 테스트와 디버그용.
 * 결과와 그동안의 사건을 돌려준다.
 */
export function simulate(ball, { limit = 8, after = 0 } = {}) {
  const court = new Court();
  court.add(ball);
  const events = [];
  let t = 0;
  let resolvedAt = Infinity;
  while (t < limit && t < resolvedAt + after) {
    court.step(1 / 60);
    t += 1 / 60;
    for (const event of court.drain()) {
      events.push(event);
      if ((event.type === 'score' || event.type === 'miss') && resolvedAt === Infinity) resolvedAt = t;
    }
  }
  return { result: ball.result, events, ball };
}
